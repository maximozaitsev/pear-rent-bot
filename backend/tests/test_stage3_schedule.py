from datetime import UTC, date, datetime, time

from app.models import (
    Booking,
    BookingStatus,
    BookingType,
    Chair,
    DateScheduleOverride,
    PaymentStatus,
    User,
    UserRole,
    WeeklySchedule,
)
from app.services.schedule import get_working_hours, working_hours_conflicts


def _seed_day(db):
    for weekday in range(7):
        db.add(
            WeeklySchedule(
                weekday=weekday,
                is_open=True,
                open_time=time(9, 0),
                close_time=time(22, 0),
            )
        )
    admin = User(telegram_id=50001, role=UserRole.admin, is_active=True)
    db.add(admin)
    db.commit()
    return admin


def test_weekly_schedule_default_hours(db):
    _seed_day(db)
    hours = get_working_hours(db, date(2026, 11, 9))
    assert hours.is_open is True
    assert str(hours.open_time).startswith("09:00")
    assert str(hours.close_time).startswith("22:00")
    assert hours.source == "weekly"


def test_date_override_takes_priority(db):
    admin = _seed_day(db)
    db.add(DateScheduleOverride(date=date(2026, 11, 9), is_open=False, created_by=admin.id))
    db.commit()
    hours = get_working_hours(db, date(2026, 11, 9))
    assert hours.is_open is False
    assert hours.source == "override"


def test_schedule_change_conflict_detected(db):
    _seed_day(db)
    chair = Chair(name="Кресло №1")
    renter = User(telegram_id=50002, role=UserRole.renter, is_active=True)
    db.add_all([chair, renter])
    db.flush()
    db.add(
        Booking(
            chair_id=chair.id,
            renter_id=renter.id,
            starts_at=datetime(2026, 11, 9, 18, 0, tzinfo=UTC),
            ends_at=datetime(2026, 11, 9, 20, 0, tzinfo=UTC),
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
    conflicts = working_hours_conflicts(
        db, day=date(2026, 11, 9), is_open=True, open_time=time(9, 0), close_time=time(19, 0)
    )
    assert len(conflicts) == 1
