import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Booking, BookingStatus, BookingType, Chair, PaymentStatus, User, UserRole
from app.services.pricing import calculate_price
from app.services.schedule import (
    combine_local,
    get_working_hours,
    localize_shop,
    validate_booking_window,
)


def _lock_chair(db: Session, chair_id: uuid.UUID) -> Chair:
    chair = db.scalar(select(Chair).where(Chair.id == chair_id).with_for_update())
    if chair is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chair not found")
    if not chair.is_active or chair.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Chair is not available")
    return chair


def _assert_no_overlap(
    db: Session, *, chair_id: uuid.UUID, starts_at: datetime, ends_at: datetime
) -> None:

    conflict = db.scalar(
        select(Booking.id).where(
            Booking.chair_id == chair_id,
            Booking.status == BookingStatus.active,
            Booking.starts_at < ends_at,
            Booking.ends_at > starts_at,
        )
    )
    if conflict is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Selected time conflicts with an existing booking",
        )


def _resolve_renter(db: Session, *, actor: User, renter_id: uuid.UUID | None) -> User:
    if actor.role == UserRole.admin and renter_id is not None:
        renter = db.scalar(select(User).where(User.id == renter_id))
        if renter is None or renter.role != UserRole.renter or not renter.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Renter not found")
        return renter
    if actor.role == UserRole.renter:
        if not actor.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive"
            )
        return actor
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to create booking"
    )


def create_bookings_bulk(
    db: Session,
    *,
    actor: User,
    items: list[dict],
) -> tuple[list[Booking], list[dict]]:
    """Best-effort bulk create: each item validated/created independently; returns (created, failures)."""
    created: list[Booking] = []
    failures: list[dict] = []
    for item in items:
        try:
            b = create_booking(
                db,
                actor=actor,
                chair_id=item["chair_id"],
                starts_at=item["starts_at"],
                ends_at=item["ends_at"],
                booking_type=item["booking_type"],
                renter_id=item.get("renter_id"),
            )
            created.append(b)
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else "Ошибка бронирования"
            failures.append({"chair_id": item["chair_id"], "starts_at": item["starts_at"], "error": detail})
        except Exception:
            db.rollback()
            failures.append({"chair_id": item["chair_id"], "starts_at": item["starts_at"], "error": "Ошибка бронирования"})
    return created, failures
    starts_local = localize_shop(starts_at)
    ends_local = localize_shop(ends_at)
    duration_hours = int((ends_local - starts_local).total_seconds() // 3600)

    # Server-side validation and transactional protection against double booking.
    try:
        started_outer = not db.in_transaction()
        ctx = db.begin_nested() if not started_outer else db.begin()
        with ctx:
            renter = _resolve_renter(db, actor=actor, renter_id=renter_id)
            _lock_chair(db, chair_id)
            validate_booking_window(db, starts_at=starts_at, ends_at=ends_at)

            hours = get_working_hours(db, starts_local.date())
            if booking_type == BookingType.full_day:
                if hours.open_time is None or hours.close_time is None:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT, detail="Barbershop is closed"
                    )
                expected_start = combine_local(starts_local.date(), hours.open_time)
                expected_end = combine_local(starts_local.date(), hours.close_time)
                if starts_local != expected_start or ends_local != expected_end:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail="Full-day booking must cover the full working interval",
                    )
                duration_hours = int((expected_end - expected_start).total_seconds() // 3600)

            _assert_no_overlap(db, chair_id=chair_id, starts_at=starts_at, ends_at=ends_at)

            booking = Booking(
                chair_id=chair_id,
                renter_id=renter.id,
                starts_at=starts_at,
                ends_at=ends_at,
                booking_type=booking_type,
                duration_hours=duration_hours,
                price_amount=calculate_price(booking_type, duration_hours),
                currency="BYN",
                payment_status=PaymentStatus.unpaid,
                status=BookingStatus.active,
                created_by=actor.id,
            )
            db.add(booking)
            db.flush()
        # Persist for request-scoped sessions (autobegin leaves an outer transaction open).
        if not started_outer and db.in_transaction():
            db.commit()
        db.refresh(booking)
        return booking
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Selected time conflicts with an existing booking",
        ) from exc


def cancel_booking(
    db: Session, *, actor: User, booking_id: uuid.UUID, reason: str | None = None
) -> Booking:
    booking = db.scalar(select(Booking).where(Booking.id == booking_id))
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    if actor.role == UserRole.renter and booking.renter_id != actor.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    if actor.role == UserRole.renter and booking.status != BookingStatus.active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Booking cannot be cancelled"
        )
    if booking.status == BookingStatus.cancelled:
        return booking
    booking.status = BookingStatus.cancelled
    booking.cancelled_by = actor.id
    booking.cancelled_at = datetime.now(UTC)
    booking.cancellation_reason = reason
    db.commit()
    db.refresh(booking)
    return booking


def get_booking_for_actor(db: Session, *, actor: User, booking_id: uuid.UUID) -> Booking:
    booking = db.scalar(select(Booking).where(Booking.id == booking_id))
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    if actor.role == UserRole.renter and booking.renter_id != actor.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    return booking


def list_my_bookings(db: Session, *, renter: User) -> list[Booking]:
    # Renters see active bookings (future/current context handled by API/UI filters as needed).
    # Cancelled bookings excluded from renter view.
    return list(
        db.scalars(
            select(Booking)
            .where(Booking.renter_id == renter.id, Booking.status == BookingStatus.active)
            .order_by(Booking.starts_at.asc())
        )
    )


def list_admin_bookings(
    db: Session,
    *,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
    chair_id: uuid.UUID | None = None,
    renter_id: uuid.UUID | None = None,
    payment_status: PaymentStatus | None = None,
    booking_status: BookingStatus | None = None,
) -> list[Booking]:
    conditions = []
    if from_dt is not None:
        conditions.append(Booking.ends_at > from_dt)
    if to_dt is not None:
        conditions.append(Booking.starts_at < to_dt)
    if chair_id is not None:
        conditions.append(Booking.chair_id == chair_id)
    if renter_id is not None:
        conditions.append(Booking.renter_id == renter_id)
    if payment_status is not None:
        conditions.append(Booking.payment_status == payment_status)
    if booking_status is not None:
        conditions.append(Booking.status == booking_status)
    q = select(Booking).order_by(Booking.starts_at.desc())
    if conditions:
        q = q.where(and_(*conditions))
    return list(db.scalars(q))


def update_payment_status(
    db: Session, *, booking_id: uuid.UUID, payment_status: PaymentStatus
) -> Booking:

    booking = db.scalar(select(Booking).where(Booking.id == booking_id))
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    booking.payment_status = payment_status
    db.commit()
    db.refresh(booking)
    return booking
