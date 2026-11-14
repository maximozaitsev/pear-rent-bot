from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.core.auth import create_access_token
from app.core.config import settings
from app.core.db import get_db
from app.main import app
from app.models import (
    Booking,
    BookingStatus,
    BookingType,
    Chair,
    PaymentStatus,
    User,
    UserRole,
    WeeklySchedule,
)


def _setup(db, monkeypatch):
    monkeypatch.setattr(settings, "timezone", "UTC")
    for weekday in range(7):
        db.add(
            WeeklySchedule(
                weekday=weekday,
                is_open=True,
                open_time=datetime.strptime("09:00", "%H:%M").time(),
                close_time=datetime.strptime("22:00", "%H:%M").time(),
            )
        )
    admin = User(telegram_id=71001, role=UserRole.admin, is_active=True)
    renter = User(telegram_id=71002, role=UserRole.renter, is_active=True)
    chair = Chair(name="Кресло №1")
    db.add_all([admin, renter, chair])
    db.commit()
    for obj in (admin, renter, chair):
        db.refresh(obj)
    return admin, renter, chair


def _client(db):
    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db
    return client


def test_admin_chair_archive_conflict_and_payment_is_per_booking(db, monkeypatch):
    admin, renter, chair = _setup(db, monkeypatch)
    b1 = Booking(
        chair_id=chair.id,
        renter_id=renter.id,
        starts_at=datetime(2026, 12, 1, 9, 0, tzinfo=UTC),
        ends_at=datetime(2026, 12, 1, 10, 0, tzinfo=UTC),
        booking_type=BookingType.hourly,
        duration_hours=1,
        price_amount=1000,
        currency="BYN",
        payment_status=PaymentStatus.unpaid,
        status=BookingStatus.active,
        created_by=renter.id,
    )
    b2 = Booking(
        chair_id=chair.id,
        renter_id=renter.id,
        starts_at=datetime(2026, 12, 1, 11, 0, tzinfo=UTC),
        ends_at=datetime(2026, 12, 1, 12, 0, tzinfo=UTC),
        booking_type=BookingType.hourly,
        duration_hours=1,
        price_amount=1000,
        currency="BYN",
        payment_status=PaymentStatus.unpaid,
        status=BookingStatus.active,
        created_by=renter.id,
    )
    db.add_all([b1, b2])
    db.commit()
    db.refresh(b1)
    db.refresh(b2)
    client = _client(db)
    try:
        h = {"Authorization": f"Bearer {create_access_token(admin)}"}
        archive = client.post(f"/api/v1/admin/chairs/{chair.id}/archive", headers=h)
        assert archive.status_code == 409
        assert archive.json()["detail"]["conflicts"]

        pay = client.patch(
            f"/api/v1/admin/bookings/{b1.id}/payment",
            json={"payment_status": "paid"},
            headers=h,
        )
        assert pay.status_code == 200
        db.refresh(b2)
        assert b1.payment_status == PaymentStatus.paid or pay.json()["payment_status"] == "paid"
        assert b2.payment_status == PaymentStatus.unpaid
    finally:
        app.dependency_overrides.clear()


def test_schedule_override_conflict_and_renter_status(db, monkeypatch):
    admin, renter, chair = _setup(db, monkeypatch)
    db.add(
        Booking(
            chair_id=chair.id,
            renter_id=renter.id,
            starts_at=datetime(2026, 12, 2, 18, 0, tzinfo=UTC),
            ends_at=datetime(2026, 12, 2, 20, 0, tzinfo=UTC),
            booking_type=BookingType.hourly,
            duration_hours=2,
            price_amount=1500,
            currency="BYN",
            payment_status=PaymentStatus.unpaid,
            status=BookingStatus.active,
            created_by=renter.id,
        )
    )
    db.commit()
    client = _client(db)
    try:
        h = {"Authorization": f"Bearer {create_access_token(admin)}"}
        conflict = client.put(
            "/api/v1/admin/schedule/exceptions/2026-12-02",
            json={"is_open": True, "open_time": "09:00:00", "close_time": "19:00:00"},
            headers=h,
        )
        assert conflict.status_code == 409
        assert conflict.json()["detail"]["conflicts"]

        ok = client.put(
            "/api/v1/admin/schedule/exceptions/2026-12-02",
            json={"is_open": True, "open_time": "09:00:00", "close_time": "21:00:00"},
            headers=h,
        )
        assert ok.status_code == 200

        status_resp = client.patch(
            f"/api/v1/admin/renters/{renter.id}/status",
            json={"is_active": False},
            headers=h,
        )
        assert status_resp.status_code == 200
        assert status_resp.json()["is_active"] is False
    finally:
        app.dependency_overrides.clear()


def test_renter_cannot_use_admin_management_endpoints(db, monkeypatch):
    _admin, renter, chair = _setup(db, monkeypatch)
    client = _client(db)
    try:
        h = {"Authorization": f"Bearer {create_access_token(renter)}"}
        assert client.post("/api/v1/admin/chairs", json={"name": "X"}, headers=h).status_code == 403
        assert client.get("/api/v1/admin/renters", headers=h).status_code == 403
        assert client.get("/api/v1/admin/schedule/weekly", headers=h).status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_renter_payment_stats_split_by_day_and_skip_cancelled(db, monkeypatch):
    admin, renter, chair = _setup(db, monkeypatch)
    now = datetime.now(UTC)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    def add(day_offset, hour, price, *, paid=False, cancelled=False):
        starts = today + timedelta(days=day_offset, hours=hour)
        db.add(
            Booking(
                chair_id=chair.id,
                renter_id=renter.id,
                starts_at=starts,
                ends_at=starts + timedelta(hours=1),
                booking_type=BookingType.hourly,
                duration_hours=1,
                price_amount=price,
                currency="BYN",
                payment_status=PaymentStatus.paid if paid else PaymentStatus.unpaid,
                status=BookingStatus.cancelled if cancelled else BookingStatus.active,
                created_by=renter.id,
            )
        )

    add(-2, 10, 100)
    add(-2, 12, 200, cancelled=True)
    add(-1, 10, 300, paid=True)
    add(0, 0, 400)
    add(3, 10, 500)
    add(3, 12, 600, cancelled=True)
    add(4, 10, 700, paid=True)
    add(-1, 10, 800, paid=True, cancelled=True)
    add(5, 10, 900, paid=True, cancelled=True)
    db.commit()

    client = _client(db)
    try:
        h = {"Authorization": f"Bearer {create_access_token(admin)}"}
        resp = client.get(f"/api/v1/admin/renters/{renter.id}", headers=h)
        assert resp.status_code == 200
        assert resp.json()["stats"] == {"debt": 100, "to_pay": 900, "paid_total": 1000}
    finally:
        app.dependency_overrides.clear()
