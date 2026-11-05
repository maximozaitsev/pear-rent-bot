import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Booking, BookingStatus, Chair


def list_chairs(db: Session, *, include_archived: bool = False) -> list[Chair]:
    q = select(Chair).order_by(Chair.name)
    if not include_archived:
        q = q.where(Chair.archived_at.is_(None))
    return list(db.scalars(q))


def create_chair(db: Session, *, name: str) -> Chair:
    chair = Chair(name=name.strip(), is_active=True)
    db.add(chair)
    db.commit()
    db.refresh(chair)
    return chair


def _future_active_bookings(db: Session, chair_id: uuid.UUID) -> list[Booking]:
    now = datetime.now(UTC)
    return list(
        db.scalars(
            select(Booking)
            .where(
                Booking.chair_id == chair_id,
                Booking.status == BookingStatus.active,
                Booking.ends_at > now,
            )
            .order_by(Booking.starts_at)
        )
    )


def _conflicts_payload(bookings: list[Booking]) -> list[dict]:
    return [
        {
            "id": str(b.id),
            "starts_at": b.starts_at.isoformat(),
            "ends_at": b.ends_at.isoformat(),
            "renter_id": str(b.renter_id),
            "booking_type": b.booking_type.value,
        }
        for b in bookings
    ]


def update_chair(
    db: Session, *, chair_id: uuid.UUID, name: str | None, is_active: bool | None
) -> Chair:
    chair = db.get(Chair, chair_id)
    if chair is None or chair.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chair not found")
    if is_active is False:
        conflicts = _future_active_bookings(db, chair_id)
        if conflicts:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Chair has future active bookings",
                    "conflicts": _conflicts_payload(conflicts),
                },
            )
    if name is not None:
        chair.name = name.strip()
    if is_active is not None:
        chair.is_active = is_active
    db.commit()
    db.refresh(chair)
    return chair


def archive_chair(db: Session, *, chair_id: uuid.UUID) -> Chair:
    chair = db.get(Chair, chair_id)
    if chair is None or chair.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chair not found")
    conflicts = _future_active_bookings(db, chair_id)
    if conflicts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "Chair has future active bookings",
                "conflicts": _conflicts_payload(conflicts),
            },
        )
    chair.is_active = False
    chair.archived_at = datetime.now(UTC)
    db.commit()
    db.refresh(chair)
    return chair
