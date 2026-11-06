from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import (
    Booking,
    BookingStatus,
    BookingType,
    Chair,
    DateScheduleOverride,
    Invitation,
    InvitationStatus,
    PaymentStatus,
    User,
    UserRole,
    WeeklySchedule,
)


def test_create_core_entities_and_relationships(db):
    admin = User(telegram_id=1001, role=UserRole.admin)
    renter = User(telegram_id=1002, role=UserRole.renter)
    db.add_all([admin, renter])
    db.flush()

    chair = Chair(name="Кресло №1")
    db.add(chair)
    db.flush()

    db.add(
        WeeklySchedule(
            weekday=0,
            is_open=True,
            open_time=datetime.strptime("09:00", "%H:%M").time(),
            close_time=datetime.strptime("22:00", "%H:%M").time(),
        )
    )

    db.add(
        DateScheduleOverride(
            date=datetime(2026, 1, 1, tzinfo=UTC).date(),
            is_open=False,
            created_by=admin.id,
        )
    )
    db.add(Invitation(code="123456", status=InvitationStatus.pending, created_by=admin.id))
    db.add(
        Booking(
            chair_id=chair.id,
            renter_id=renter.id,
            starts_at=datetime(2026, 1, 2, 9, 0, tzinfo=UTC),
            ends_at=datetime(2026, 1, 2, 10, 0, tzinfo=UTC),
            booking_type=BookingType.hourly,
            duration_hours=1,
            price_amount=1000,
            currency="BYN",
            payment_status=PaymentStatus.unpaid,
            status=BookingStatus.active,
            created_by=renter.id,
        )
    )
    db.flush()

    assert db.scalar(select(User).where(User.telegram_id == 1002)).role == UserRole.renter
    assert db.scalar(select(Chair)).name == "Кресло №1"
    assert len(chair.bookings) == 1
    assert chair.bookings[0].renter.telegram_id == 1002


def test_telegram_id_unique(db):
    db.add(User(telegram_id=2001, role=UserRole.admin))
    db.flush()
    db.add(User(telegram_id=2001, role=UserRole.renter))
    with pytest.raises(IntegrityError):
        db.flush()


def test_overlapping_active_bookings_rejected_on_postgres(db, db_engine):
    if db_engine.dialect.name != "postgresql":
        pytest.skip("Exclusion constraint for overlaps is PostgreSQL-specific")

    admin = User(telegram_id=3001, role=UserRole.admin)
    renter = User(telegram_id=3002, role=UserRole.renter)
    chair = Chair(name="Кресло №1")
    db.add_all([admin, renter, chair])
    db.flush()

    db.add(
        Booking(
            chair_id=chair.id,
            renter_id=renter.id,
            starts_at=datetime(2026, 1, 2, 10, 0, tzinfo=UTC),
            ends_at=datetime(2026, 1, 2, 12, 0, tzinfo=UTC),
            booking_type=BookingType.hourly,
            duration_hours=2,
            price_amount=1500,
            currency="BYN",
            payment_status=PaymentStatus.unpaid,
            status=BookingStatus.active,
            created_by=renter.id,
        )
    )
    db.flush()

    db.add(
        Booking(
            chair_id=chair.id,
            renter_id=renter.id,
            starts_at=datetime(2026, 1, 2, 11, 0, tzinfo=UTC),
            ends_at=datetime(2026, 1, 2, 13, 0, tzinfo=UTC),
            booking_type=BookingType.hourly,
            duration_hours=2,
            price_amount=1500,
            currency="BYN",
            payment_status=PaymentStatus.unpaid,
            status=BookingStatus.active,
            created_by=renter.id,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()
