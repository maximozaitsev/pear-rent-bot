from datetime import date, datetime, time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Booking, BookingStatus, Chair, User, UserRole
from app.services.schedule import WorkingHours, combine_local, get_working_hours, localize_shop


def _intervals_overlap(
    a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime
) -> bool:
    return a_start < b_end and a_end > b_start


def list_active_chairs(db: Session):
    return list(
        db.scalars(
            select(Chair)
            .where(Chair.is_active.is_(True), Chair.archived_at.is_(None))
            .order_by(Chair.name)
        )
    )


def bookings_for_day(db: Session, day: date) -> list[Booking]:
    start = combine_local(day, time(0, 0))
    end = combine_local(day, time(23, 59, 59))
    return list(
        db.scalars(
            select(Booking)
            .where(
                Booking.status == BookingStatus.active,
                Booking.starts_at < end,
                Booking.ends_at > start,
            )
            .order_by(Booking.starts_at)
        )
    )


def free_intervals(
    working: WorkingHours, busy: list[tuple[datetime, datetime]]
) -> list[tuple[datetime, datetime]]:

    if not working.is_open or working.open_time is None or working.close_time is None:
        return []
    cursor = combine_local(working.day, working.open_time)
    end = combine_local(working.day, working.close_time)
    normalized = sorted((localize_shop(s), localize_shop(e)) for s, e in busy)
    merged: list[tuple[datetime, datetime]] = []
    for s, e in normalized:
        if not merged or s > merged[-1][1]:
            merged.append((s, e))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
    result: list[tuple[datetime, datetime]] = []
    for s, e in merged:
        if e <= cursor or s >= end:
            continue
        if s > cursor:
            result.append((cursor, min(s, end)))
        cursor = max(cursor, e)
        if cursor >= end:
            break
    if cursor < end:
        result.append((cursor, end))
    return result


def day_schedule(db: Session, day: date, *, viewer: User) -> dict:
    hours = get_working_hours(db, day)
    chairs = list_active_chairs(db)
    all_bookings = bookings_for_day(db, day)
    by_chair: dict = {c.id: [] for c in chairs}
    for b in all_bookings:
        if b.chair_id in by_chair:
            by_chair[b.chair_id].append(b)

    chair_payloads = []
    for chair in chairs:
        busy_bookings = by_chair.get(chair.id, [])
        busy_intervals = [(b.starts_at, b.ends_at) for b in busy_bookings]
        free = free_intervals(hours, busy_intervals)
        has_mine = any(b.renter_id == viewer.id for b in busy_bookings)
        bookings_payload = []
        for b in busy_bookings:
            item = {
                "id": str(b.id),
                "starts_at": localize_shop(b.starts_at).isoformat(),
                "ends_at": localize_shop(b.ends_at).isoformat(),
                "booking_type": b.booking_type.value,
                "duration_hours": b.duration_hours,
            }
            if viewer.role == UserRole.admin:
                renter = b.renter
                item["renter"] = {
                    "id": str(renter.id),
                    "telegram_id": renter.telegram_id,
                    "username": renter.username,
                    "first_name": renter.first_name,
                    "last_name": renter.last_name,
                }
                item["price_amount"] = b.price_amount
                item["currency"] = b.currency
                item["payment_status"] = b.payment_status.value
                item["status"] = b.status.value
            if b.renter_id == viewer.id:
                item["is_mine"] = True
            bookings_payload.append(item)

        fully_booked = hours.is_open and len(free) == 0 and len(busy_bookings) > 0
        chair_payloads.append(
            {
                "chair_id": str(chair.id),
                "name": chair.name,
                "is_fully_booked": fully_booked,
                "is_partially_booked": hours.is_open and len(busy_bookings) > 0 and len(free) > 0,
                "is_free_whole_day": hours.is_open and len(busy_bookings) == 0,
                "can_book_full_day": hours.is_open and len(busy_bookings) == 0 and not has_mine,
                "busy_intervals": [
                    {
                        "starts_at": localize_shop(s).isoformat(),
                        "ends_at": localize_shop(e).isoformat(),
                    }
                    for s, e in busy_intervals
                ],
                "free_intervals": [
                    {
                        "starts_at": localize_shop(s).isoformat(),
                        "ends_at": localize_shop(e).isoformat(),
                    }
                    for s, e in free
                ],
                "bookings": bookings_payload,
            }
        )

    return {
        "date": day.isoformat(),
        "working_hours": {
            "is_open": hours.is_open,
            "open_time": hours.open_time.isoformat() if hours.open_time else None,
            "close_time": hours.close_time.isoformat() if hours.close_time else None,
            "source": hours.source,
        },
        "chairs": chair_payloads,
    }
