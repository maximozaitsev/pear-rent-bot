from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.api.v1.bookings as bookings_api
from app.core.auth import create_access_token
from app.core.config import settings
from app.core.db import get_db
from app.main import app
from app.models import (
    Base,
    Booking,
    BookingStatus,
    BookingType,
    Chair,
    NotificationLog,
    PaymentStatus,
    User,
    UserRole,
    WeeklySchedule,
)
from app.notifications import service as notifications_service

# Capture real implementations before conftest autouse monkeypatches module attrs.
_REAL_NOTIFY_CREATED = notifications_service.notify_booking_created
_REAL_NOTIFY_CANCELLED = notifications_service.notify_booking_cancelled
_REAL_NOTIFY_BULK = notifications_service.notify_bulk_bookings_created
_REAL_NOTIFY_REPLACED = notifications_service.notify_bookings_replaced


def _day(offset: int) -> str:
    return (datetime.now(UTC) + timedelta(days=offset)).date().isoformat()


def _at(offset: int, hour: int) -> datetime:
    return datetime.fromisoformat(f"{_day(offset)}T{hour:02d}:00:00+00:00")


def _notify_db():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _pragma(dbapi_connection, _):
        c = dbapi_connection.cursor()
        c.execute("PRAGMA foreign_keys=ON")
        c.close()

    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine, expire_on_commit=False)


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
    admin = User(telegram_id=81001, role=UserRole.admin, is_active=True)
    renter = User(telegram_id=81002, role=UserRole.renter, is_active=True)
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


def _restore_notifiers(monkeypatch):
    # Use real service functions at the API import site (autouse fixture no-ops them).
    monkeypatch.setattr(bookings_api, "notify_booking_created", _REAL_NOTIFY_CREATED)
    monkeypatch.setattr(bookings_api, "notify_booking_cancelled", _REAL_NOTIFY_CANCELLED)


def test_notifications_on_create_and_admin_cancel(monkeypatch):
    engine, SessionLocal = _notify_db()
    monkeypatch.setattr(notifications_service, "SessionLocal", SessionLocal)
    monkeypatch.setattr(settings, "telegram_bot_token", "token")
    bot = AsyncMock()
    bot.send_message = AsyncMock()
    monkeypatch.setattr(notifications_service, "get_bot", lambda: bot)
    _restore_notifiers(monkeypatch)
    db = SessionLocal()
    try:
        admin, renter, chair = _setup(db, monkeypatch)
        client = _client(db)
        try:
            h_renter = {"Authorization": f"Bearer {create_access_token(renter)}"}
            h_admin = {"Authorization": f"Bearer {create_access_token(admin)}"}
            created = client.post(
                "/api/v1/bookings",
                json={
                    "chair_id": str(chair.id),
                    "starts_at": f"{_day(1)}T09:00:00Z",
                    "ends_at": f"{_day(1)}T10:00:00Z",
                    "booking_type": "hourly",
                },
                headers=h_renter,
            )
            assert created.status_code == 201
            booking_id = created.json()["id"]
            cancelled = client.post(f"/api/v1/bookings/{booking_id}/cancel", json={}, headers=h_admin)
            assert cancelled.status_code == 200
        finally:
            app.dependency_overrides.clear()

        logs = list(db.scalars(select(NotificationLog)))
        events = {(log.event_type, str(log.recipient_user_id)) for log in logs}
        assert ("booking_created_renter", str(renter.id)) in events
        assert ("booking_created_admin", str(admin.id)) in events
        assert ("booking_cancelled_by_admin_renter", str(renter.id)) in events
        assert all(log.status == "sent" for log in logs)
        assert bot.send_message.await_count == 3
    finally:
        db.close()
        engine.dispose()


def test_renter_cancel_notifies_admin_and_no_payment_notification(monkeypatch):
    engine, SessionLocal = _notify_db()
    monkeypatch.setattr(notifications_service, "SessionLocal", SessionLocal)
    monkeypatch.setattr(settings, "telegram_bot_token", "token")
    bot = AsyncMock()
    bot.send_message = AsyncMock()
    monkeypatch.setattr(notifications_service, "get_bot", lambda: bot)
    _restore_notifiers(monkeypatch)
    db = SessionLocal()
    try:
        admin, renter, chair = _setup(db, monkeypatch)
        booking = Booking(
            chair_id=chair.id,
            renter_id=renter.id,
            starts_at=_at(2, 9),
            ends_at=_at(2, 10),
            booking_type=BookingType.hourly,
            duration_hours=1,
            price_amount=1000,
            currency="BYN",
            payment_status=PaymentStatus.unpaid,
            status=BookingStatus.active,
            created_by=renter.id,
        )
        db.add(booking)
        db.commit()
        db.refresh(booking)

        client = _client(db)
        try:
            h_renter = {"Authorization": f"Bearer {create_access_token(renter)}"}
            h_admin = {"Authorization": f"Bearer {create_access_token(admin)}"}
            assert (
                client.post(f"/api/v1/bookings/{booking.id}/cancel", json={}, headers=h_renter).status_code
                == 200
            )
            assert (
                client.patch(
                    f"/api/v1/admin/bookings/{booking.id}/payment",
                    json={"payment_status": "paid"},
                    headers=h_admin,
                ).status_code
                == 200
            )
        finally:
            app.dependency_overrides.clear()

        events = list(db.scalars(select(NotificationLog.event_type)))
        assert "booking_cancelled_by_renter_admin" in events
        assert not any("payment" in event for event in events)
        assert bot.send_message.await_count == 1
    finally:
        db.close()
        engine.dispose()


def test_notification_failure_does_not_rollback_booking(monkeypatch):
    engine, SessionLocal = _notify_db()
    monkeypatch.setattr(notifications_service, "SessionLocal", SessionLocal)
    monkeypatch.setattr(settings, "telegram_bot_token", "token")
    bot = AsyncMock()
    bot.send_message = AsyncMock(side_effect=RuntimeError("blocked"))
    monkeypatch.setattr(notifications_service, "get_bot", lambda: bot)
    _restore_notifiers(monkeypatch)
    db = SessionLocal()
    try:
        _admin, renter, chair = _setup(db, monkeypatch)
        client = _client(db)
        try:
            h_renter = {"Authorization": f"Bearer {create_access_token(renter)}"}
            created = client.post(
                "/api/v1/bookings",
                json={
                    "chair_id": str(chair.id),
                    "starts_at": f"{_day(3)}T09:00:00Z",
                    "ends_at": f"{_day(3)}T10:00:00Z",
                    "booking_type": "hourly",
                },
                headers=h_renter,
            )
            assert created.status_code == 201
        finally:
            app.dependency_overrides.clear()

        assert db.scalar(select(func.count()).select_from(Booking)) == 1
        failed = list(db.scalars(select(NotificationLog)))
        assert failed
        assert all(log.status == "failed" for log in failed)
        assert all(log.last_error for log in failed)
    finally:
        db.close()
        engine.dispose()


def test_bulk_notifications_skip_technical_renter(monkeypatch):
    engine, SessionLocal = _notify_db()
    monkeypatch.setattr(notifications_service, "SessionLocal", SessionLocal)
    monkeypatch.setattr(settings, "telegram_bot_token", "token")
    bot = AsyncMock()
    bot.send_message = AsyncMock()
    monkeypatch.setattr(notifications_service, "get_bot", lambda: bot)
    monkeypatch.setattr(bookings_api, "notify_bulk_bookings_created", _REAL_NOTIFY_BULK)
    db = SessionLocal()
    try:
        admin, _renter, chair = _setup(db, monkeypatch)
        client = _client(db)
        try:
            resp = client.post(
                "/api/v1/admin/bookings/bulk",
                json={
                    "renter_name": "Мастер без Telegram",
                    "items": [
                        {
                            "chair_id": str(chair.id),
                            "starts_at": f"{_day(1)}T09:00:00Z",
                            "ends_at": f"{_day(1)}T10:00:00Z",
                            "booking_type": "hourly",
                        }
                    ],
                },
                headers={"Authorization": f"Bearer {create_access_token(admin)}"},
            )
            assert resp.status_code == 201, resp.text
        finally:
            app.dependency_overrides.clear()

        sent_to = {call.kwargs["chat_id"] for call in bot.send_message.await_args_list}
        assert sent_to == {admin.telegram_id}
    finally:
        db.close()
        engine.dispose()


def test_renter_replace_sends_single_changed_notification(monkeypatch):
    engine, SessionLocal = _notify_db()
    monkeypatch.setattr(notifications_service, "SessionLocal", SessionLocal)
    monkeypatch.setattr(settings, "telegram_bot_token", "token")
    bot = AsyncMock()
    bot.send_message = AsyncMock()
    monkeypatch.setattr(notifications_service, "get_bot", lambda: bot)
    _restore_notifiers(monkeypatch)
    monkeypatch.setattr(bookings_api, "notify_bookings_replaced", _REAL_NOTIFY_REPLACED)
    db = SessionLocal()
    try:
        admin, renter, chair = _setup(db, monkeypatch)
        old = Booking(
            chair_id=chair.id,
            renter_id=renter.id,
            starts_at=_at(4, 9),
            ends_at=_at(4, 10),
            booking_type=BookingType.hourly,
            duration_hours=1,
            price_amount=1000,
            currency="BYN",
            payment_status=PaymentStatus.unpaid,
            status=BookingStatus.active,
            created_by=renter.id,
        )
        db.add(old)
        db.commit()
        db.refresh(old)
        client = _client(db)
        try:
            resp = client.post(
                "/api/v1/bookings/bulk",
                json={
                    "items": [
                        {
                            "chair_id": str(chair.id),
                            "starts_at": f"{_day(4)}T12:00:00Z",
                            "ends_at": f"{_day(4)}T14:00:00Z",
                            "booking_type": "hourly",
                        }
                    ],
                    "replace_booking_ids": [str(old.id)],
                },
                headers={"Authorization": f"Bearer {create_access_token(renter)}"},
            )
            assert resp.status_code == 201, resp.text
        finally:
            app.dependency_overrides.clear()

        logs = db.scalars(select(NotificationLog))
        events = {(log.event_type, log.recipient_user_id) for log in logs}
        assert events == {
            ("booking_replaced_renter", renter.id),
            ("booking_replaced_admin", admin.id),
        }
        calls = bot.send_message.await_args_list
        texts = {call.kwargs["chat_id"]: call.kwargs["text"] for call in calls}
        assert "Было" in texts[admin.telegram_id] and "12:00-14:00" in texts[admin.telegram_id]
        assert "09:00-10:00" in texts[admin.telegram_id]
        assert "Бронирование изменено" in texts[renter.telegram_id]
    finally:
        db.close()
        engine.dispose()
