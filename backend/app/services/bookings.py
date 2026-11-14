import calendar
import uuid
from datetime import UTC, date, datetime

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    Booking,
    BookingStatus,
    BookingType,
    Chair,
    PaymentStatus,
    RenterRole,
    User,
    UserRole,
)
from app.services.pricing import calculate_price
from app.services.schedule import (
    combine_local,
    get_working_hours,
    localize_shop,
    shop_tz,
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


def _assert_renter_booking_window(renter: User, starts_local: datetime) -> None:
    """Role-based booking horizon.

    Permanent: current and next month only.
    Temporary: current month only; next month opens after the 15th of the current month.
    Nobody can book the month after the next one.
    """
    role = renter.renter_role
    now = datetime.now(shop_tz())
    year, month = now.year, now.month
    last_current = calendar.monthrange(year, month)[1]
    if month == 12:
        ny, nm = year + 1, 1
    else:
        ny, nm = year, month + 1
    last_next = calendar.monthrange(ny, nm)[1]
    last_allowed = date(ny, nm, last_next)
    if role == RenterRole.temporary and now.day < 15:
        last_allowed = date(year, month, last_current)
    if starts_local.date() > last_allowed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Бронь на этот месяц пока недоступна для вашей роли",
        )


def _create_technical_renter(db: Session, name: str) -> User:
    clean = name.strip()
    if not clean:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Renter name is required")
    for _ in range(5):
        tg_id = -int(uuid.uuid4().int % 10**12) - 1
        try:
            user = User(
                telegram_id=tg_id,
                first_name=clean,
                role=UserRole.renter,
                renter_role=RenterRole.temporary,
                is_active=True,
            )
            db.add(user)
            db.flush()
            return user
        except IntegrityError:
            db.rollback()
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not create renter")


def create_booking(
    db: Session,
    *,
    actor: User,
    chair_id: uuid.UUID,
    starts_at: datetime,
    ends_at: datetime,
    booking_type: BookingType,
    renter_id: uuid.UUID | None = None,
    renter_name: str | None = None,
    price_amount: int | None = None,
    allow_past: bool = False,
) -> Booking:
    starts_local = localize_shop(starts_at)
    ends_local = localize_shop(ends_at)
    span_seconds = (ends_local - starts_local).total_seconds()
    duration_hours = int(span_seconds // 3600)
    btype = BookingType(booking_type) if isinstance(booking_type, str) else booking_type

    # Server-side validation and transactional protection against double booking.
    try:
        started_outer = not db.in_transaction()
        ctx = db.begin_nested() if not started_outer else db.begin()
        with ctx:
            if renter_name is not None and renter_id is None:
                renter_id = _create_technical_renter(db, renter_name).id
            renter = _resolve_renter(db, actor=actor, renter_id=renter_id)
            if actor.role != UserRole.admin:
                _assert_renter_booking_window(renter, starts_local)
            _lock_chair(db, chair_id)
            validate_booking_window(db, starts_at=starts_at, ends_at=ends_at, allow_past=allow_past)

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

            if price_amount is None:
                if btype == BookingType.hourly:
                    # Charge the "first hour" only once per day per renter/chair.
                    # Sum already-active hourly bookings on this chair/day so the
                    # total day price is calcHourlyPrice(total_hours), then bill only
                    # the difference for the new slice.
                    day = starts_local.date()
                    existing = db.scalars(
                        select(Booking).where(
                            Booking.chair_id == chair_id,
                            Booking.renter_id == renter.id,
                            Booking.status == BookingStatus.active,
                        )
                    ).all()
                    existing_hours = 0
                    existing_price = 0
                    for b in existing:
                        if localize_shop(b.starts_at).date() == day:
                            existing_hours += b.duration_hours
                            existing_price += b.price_amount
                    total_hours = existing_hours + duration_hours
                    price_amount = max(0, calculate_price(BookingType.hourly, total_hours) - existing_price)
                else:
                    price_amount = calculate_price(booking_type, duration_hours)

            booking = Booking(
                chair_id=chair_id,
                renter_id=renter.id,
                starts_at=starts_at,
                ends_at=ends_at,
                booking_type=booking_type,
                duration_hours=duration_hours,
                price_amount=price_amount,
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


def create_bookings_bulk(
    db: Session,
    *,
    actor: User,
    items: list[dict],
    allow_past: bool = False,
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
                price_amount=item.get("price_amount"),
                allow_past=allow_past,
            )
            created.append(b)
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else "Ошибка бронирования"
            failures.append({"chair_id": item["chair_id"], "starts_at": item["starts_at"], "error": detail})
        except Exception:
            db.rollback()
            failures.append({"chair_id": item["chair_id"], "starts_at": item["starts_at"], "error": "Ошибка бронирования"})
    return created, failures


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
