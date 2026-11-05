from dataclasses import dataclass
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Booking, BookingStatus, DateScheduleOverride, WeeklySchedule


@dataclass(frozen=True)
class WorkingHours:
    day: date
    is_open: bool
    open_time: time | None
    close_time: time | None
    source: str  # "override" | "weekly" | "missing"


def shop_tz() -> ZoneInfo:
    return ZoneInfo(settings.timezone)


def localize_shop(dt: datetime) -> datetime:
    tz = shop_tz()
    if dt.tzinfo is None:
        return dt.replace(tzinfo=tz)
    return dt.astimezone(tz)


def combine_local(day: date, t: time) -> datetime:
    return datetime.combine(day, t, tzinfo=shop_tz())


def get_working_hours(db: Session, day: date) -> WorkingHours:
    override = db.scalar(select(DateScheduleOverride).where(DateScheduleOverride.date == day))
    if override is not None:
        return WorkingHours(
            day=day,
            is_open=override.is_open,
            open_time=override.open_time,
            close_time=override.close_time,
            source="override",
        )
    weekly = db.scalar(select(WeeklySchedule).where(WeeklySchedule.weekday == day.weekday()))
    if weekly is None:
        return WorkingHours(
            day=day, is_open=False, open_time=None, close_time=None, source="missing"
        )
    return WorkingHours(
        day=day,
        is_open=weekly.is_open,
        open_time=weekly.open_time,
        close_time=weekly.close_time,
        source="weekly",
    )


def assert_hour_boundary(dt: datetime) -> None:
    local = localize_shop(dt)
    if local.minute != 0 or local.second != 0 or local.microsecond != 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Start and end must align to whole-hour boundaries",
        )


def validate_booking_window(
    db: Session, *, starts_at: datetime, ends_at: datetime
) -> tuple[date, WorkingHours]:
    starts_local = localize_shop(starts_at)
    ends_local = localize_shop(ends_at)
    day = starts_local.date()
    if starts_local.date() != ends_local.date():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Booking must start and end on the same day",
        )
    now_local = datetime.now(shop_tz())
    if day < now_local.date():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Date is in the past"
        )

    hours = get_working_hours(db, day)
    if not hours.is_open or hours.open_time is None or hours.close_time is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Barbershop is closed on this date"
        )

    open_dt = combine_local(day, hours.open_time)
    close_dt = combine_local(day, hours.close_time)
    assert_hour_boundary(starts_at)
    assert_hour_boundary(ends_at)
    if starts_local < open_dt or ends_local > close_dt:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Booking must fit within working hours",
        )
    if ends_local <= starts_local:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="End time must be after start time",
        )
    duration_hours = int((ends_local - starts_local).total_seconds() // 3600)
    if duration_hours < 1 or (ends_local - starts_local).total_seconds() % 3600 != 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Duration must be at least 1 hour in whole-hour steps",
        )
    return day, hours


def working_hours_conflicts(
    db: Session, *, day: date, is_open: bool, open_time: time | None, close_time: time | None
):
    """Return active bookings that would fall outside new working hours for the given date."""
    open_dt = combine_local(day, open_time) if is_open and open_time else None
    close_dt = combine_local(day, close_time) if is_open and close_time else None
    day_start = combine_local(day, time(0, 0))
    day_end = combine_local(day, time(23, 59, 59))

    q = select(Booking).where(
        Booking.status == BookingStatus.active,
        Booking.starts_at < day_end,
        Booking.ends_at > day_start,
    )
    conflicts = []
    for booking in db.scalars(q):
        b_start = localize_shop(booking.starts_at)
        b_end = localize_shop(booking.ends_at)
        if b_start.date() != day and b_end.date() != day:
            # should not happen with same-day rule, but keep safe
            continue
        if not is_open or open_dt is None or close_dt is None:
            conflicts.append(booking)
            continue
        if b_start < open_dt or b_end > close_dt:
            conflicts.append(booking)
    return conflicts
