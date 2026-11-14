from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.auth import create_access_token
from app.core.config import settings
from app.core.db import get_db
from app.main import app
from app.models import (
    BookingStatus,
    BookingType,
    Chair,
    RenterRole,
    User,
    UserRole,
    WeeklySchedule,
)
import app.services.bookings as bookings_module
from app.services.bookings import create_booking


class FixedDateTime(datetime):
    NOW = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)

    @classmethod
    def now(cls, tz=None):
        return cls.NOW.astimezone(tz) if tz else cls.NOW


def _setup(db, monkeypatch):
    monkeypatch.setattr(settings, "timezone", "UTC")
    monkeypatch.setattr(bookings_module, "datetime", FixedDateTime)
    for weekday in range(7):
        db.add(
            WeeklySchedule(
                weekday=weekday,
                is_open=True,
                open_time=datetime.strptime("09:00", "%H:%M").time(),
                close_time=datetime.strptime("22:00", "%H:%M").time(),
            )
        )
    admin = User(telegram_id=72001, role=UserRole.admin, is_active=True)
    perm = User(
        telegram_id=72002,
        role=UserRole.renter,
        is_active=True,
        renter_role=RenterRole.permanent,
    )
    tmp = User(
        telegram_id=72003,
        role=UserRole.renter,
        is_active=True,
        renter_role=RenterRole.temporary,
    )
    chair = Chair(name="Кресло №1")
    db.add_all([admin, perm, tmp, chair])
    db.commit()
    for obj in (admin, perm, tmp, chair):
        db.refresh(obj)
    return admin, perm, tmp, chair


def _client(db):
    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db
    return client


def _hour(day: int, month: int = 11):
    return (
        datetime(2026, month, day, 10, 0, tzinfo=UTC),
        datetime(2026, month, day, 11, 0, tzinfo=UTC),
    )


def test_permanent_can_book_current_and_next_month(db, monkeypatch):
    admin, perm, _tmp, chair = _setup(db, monkeypatch)
    start, end = _hour(20)
    b = create_booking(db, actor=perm, chair_id=chair.id, starts_at=start, ends_at=end, booking_type=BookingType.hourly)
    assert b.status == BookingStatus.active

    start, end = _hour(10, 12)
    b = create_booking(db, actor=perm, chair_id=chair.id, starts_at=start, ends_at=end, booking_type=BookingType.hourly)
    assert b.status == BookingStatus.active

    start, end = _hour(5, 1)
    with pytest.raises(Exception) as exc:
        create_booking(db, actor=perm, chair_id=chair.id, starts_at=start, ends_at=end, booking_type=BookingType.hourly)
    assert exc.value.status_code == 422


def test_temporary_before_15_only_current_month(db, monkeypatch):
    _admin, _perm, tmp, chair = _setup(db, monkeypatch)
    start, end = _hour(20)
    b = create_booking(db, actor=tmp, chair_id=chair.id, starts_at=start, ends_at=end, booking_type=BookingType.hourly)
    assert b.status == BookingStatus.active

    start, end = _hour(1, 12)
    with pytest.raises(Exception) as exc:
        create_booking(db, actor=tmp, chair_id=chair.id, starts_at=start, ends_at=end, booking_type=BookingType.hourly)
    assert exc.value.status_code == 422


def test_role_change_updates_booking_window(db, monkeypatch):
    admin, _perm, tmp, chair = _setup(db, monkeypatch)
    client = _client(db)
    try:
        h = {"Authorization": f"Bearer {create_access_token(admin)}"}
        resp = client.patch(
            f"/api/v1/admin/renters/{tmp.id}/role", json={"renter_role": "permanent"}, headers=h
        )
        assert resp.status_code == 200
        assert resp.json()["renter_role"] == "permanent"
        db.refresh(tmp)

        not_found = client.patch(
            f"/api/v1/admin/renters/{admin.id}/role", json={"renter_role": "temporary"}, headers=h
        )
        assert not_found.status_code == 404

        bad_role = client.patch(
            f"/api/v1/admin/renters/{tmp.id}/role", json={"renter_role": "chief"}, headers=h
        )
        assert bad_role.status_code == 422
    finally:
        app.dependency_overrides.clear()

    start, end = _hour(1, 12)
    b = create_booking(db, actor=tmp, chair_id=chair.id, starts_at=start, ends_at=end, booking_type=BookingType.hourly)
    assert b.status == BookingStatus.active


def test_admin_bulk_with_new_renter_name_creates_technical_renter(db, monkeypatch):
    admin, _perm, _tmp, chair = _setup(db, monkeypatch)
    client = _client(db)
    start, end = _hour(20)
    try:
        resp = client.post(
            "/api/v1/admin/bookings/bulk",
            json={
                "renter_name": "Тестовый мастер",
                "items": [
                    {
                        "chair_id": str(chair.id),
                        "starts_at": start.isoformat(),
                        "ends_at": end.isoformat(),
                        "booking_type": "hourly",
                    }
                ],
            },
            headers={"Authorization": f"Bearer {create_access_token(admin)}"},
        )
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 201, resp.text
    assert resp.json()["created_count"] == 1
    renter = db.scalar(select(User).where(User.first_name == "Тестовый мастер"))
    assert renter.telegram_id < 0
    assert renter.renter_role == RenterRole.temporary


def test_admin_books_next_month_for_temporary_before_15(db, monkeypatch):
    admin, _perm, tmp, chair = _setup(db, monkeypatch)
    start, end = _hour(1, 12)
    b = create_booking(
        db,
        actor=admin,
        chair_id=chair.id,
        starts_at=start,
        ends_at=end,
        booking_type=BookingType.hourly,
        renter_id=tmp.id,
    )
    assert b.status == BookingStatus.active
