from datetime import UTC, date, datetime, time, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DateScheduleOverride, WeeklySchedule
from app.services.schedule import localize_shop, working_hours_conflicts


def _conflicts_payload(bookings) -> list[dict]:
    return [
        {
            "id": str(b.id),
            "chair_id": str(b.chair_id),
            "renter_id": str(b.renter_id),
            "starts_at": localize_shop(b.starts_at).isoformat(),
            "ends_at": localize_shop(b.ends_at).isoformat(),
        }
        for b in bookings
    ]


def _validate_hours(is_open: bool, open_time: time | None, close_time: time | None) -> None:
    if not is_open:
        return
    if open_time is None or close_time is None or open_time >= close_time:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Open time must be before close time",
        )
    if open_time.minute or close_time.minute:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Schedule times must use whole-hour boundaries",
        )


def list_weekly(db: Session) -> list[WeeklySchedule]:
    return list(db.scalars(select(WeeklySchedule).order_by(WeeklySchedule.weekday)))


def upsert_weekly(db: Session, *, items: list[dict]) -> list[WeeklySchedule]:
    # Check conflicts against affected future dates (limited horizon for MVP).
    today = datetime.now(UTC).date()
    horizon = today + timedelta(days=90)
    by_weekday = {int(item["weekday"]): item for item in items}
    conflicts = []
    cur = today
    while cur <= horizon:
        item = by_weekday.get(cur.weekday())
        if item is not None and db.scalar(
            select(DateScheduleOverride.id).where(DateScheduleOverride.date == cur)
        ) is None:
            c = working_hours_conflicts(
                db,
                day=cur,
                is_open=bool(item["is_open"]),
                open_time=item.get("open_time"),
                close_time=item.get("close_time"),
            )
            for b in c:
                conflicts.append(b)
        cur += timedelta(days=1)
    if conflicts:
        # Deduplicate by booking id
        seen = {}
        for b in conflicts:
            seen[str(b.id)] = b
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "Schedule change conflicts with existing active bookings",
                "conflicts": _conflicts_payload(list(seen.values())),
            },
        )

    for item in items:
        _validate_hours(item["is_open"], item.get("open_time"), item.get("close_time"))
        row = db.scalar(select(WeeklySchedule).where(WeeklySchedule.weekday == item["weekday"]))
        if row is None:
            row = WeeklySchedule(weekday=item["weekday"])
            db.add(row)
        row.is_open = item["is_open"]
        row.open_time = item.get("open_time") if item["is_open"] else None
        row.close_time = item.get("close_time") if item["is_open"] else None
    db.commit()
    return list_weekly(db)


def list_overrides(db: Session) -> list[DateScheduleOverride]:
    return list(db.scalars(select(DateScheduleOverride).order_by(DateScheduleOverride.date.desc())))


def upsert_override(
    db: Session,
    *,
    day: date,
    is_open: bool,
    open_time: time | None,
    close_time: time | None,
    reason: str | None,
    admin_id,
) -> DateScheduleOverride:
    _validate_hours(is_open, open_time, close_time)
    conflicts = working_hours_conflicts(
        db, day=day, is_open=is_open, open_time=open_time, close_time=close_time
    )
    if conflicts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "Schedule change conflicts with existing active bookings",
                "conflicts": _conflicts_payload(conflicts),
            },
        )
    row = db.scalar(select(DateScheduleOverride).where(DateScheduleOverride.date == day))
    if row is None:
        row = DateScheduleOverride(date=day, created_by=admin_id)
        db.add(row)
    row.is_open = is_open
    row.open_time = open_time if is_open else None
    row.close_time = close_time if is_open else None
    row.reason = reason
    db.commit()
    db.refresh(row)
    return row


def delete_override(db: Session, *, day: date) -> None:
    # Deleting override restores weekly schedule; check resulting weekly hours for conflicts.
    row = db.scalar(select(DateScheduleOverride).where(DateScheduleOverride.date == day))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Override not found")
    weekly = db.scalar(select(WeeklySchedule).where(WeeklySchedule.weekday == day.weekday()))
    if weekly is not None:
        conflicts = working_hours_conflicts(
            db,
            day=day,
            is_open=weekly.is_open,
            open_time=weekly.open_time,
            close_time=weekly.close_time,
        )
        if conflicts:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Removing override conflicts with existing active bookings",
                    "conflicts": _conflicts_payload(conflicts),
                },
            )
    db.delete(row)
    db.commit()
