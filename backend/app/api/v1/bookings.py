import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_admin
from app.core.db import get_db
from app.models import Booking, BookingStatus, PaymentStatus, User, UserRole
from app.notifications.service import notify_booking_cancelled, notify_booking_created, notify_bulk_bookings_created
from app.schemas.bookings import (
    BookingCancelRequest,
    BookingCreateRequest,
    BookingOut,
    BulkBookingCreateRequest,
    BulkBookingCreateResponse,
    BulkBookingResultItem,
    PaymentStatusRequest,
    RenterBriefOut,
)
from app.services.bookings import (
    cancel_booking,
    create_booking,
    create_bookings_bulk,
    get_booking_for_actor,
    list_admin_bookings,
    list_my_bookings,
    update_payment_status,
)
from app.services.schedule import localize_shop

router = APIRouter()


def _booking_out(booking: Booking, *, viewer: User) -> BookingOut:
    show_admin = viewer.role == UserRole.admin
    show_owner_private = show_admin or booking.renter_id == viewer.id
    renter = None
    if show_admin:
        r = booking.renter
        renter = RenterBriefOut(
            id=str(r.id),
            telegram_id=r.telegram_id,
            username=r.username,
            first_name=r.first_name,
            last_name=r.last_name,
        )
    return BookingOut(
        id=str(booking.id),
        chair_id=str(booking.chair_id),
        renter_id=str(booking.renter_id),
        starts_at=localize_shop(booking.starts_at).isoformat(),
        ends_at=localize_shop(booking.ends_at).isoformat(),
        booking_type=booking.booking_type.value,
        duration_hours=booking.duration_hours,
        price_amount=booking.price_amount if show_owner_private else 0,
        currency=booking.currency,
        status=booking.status.value,
        payment_status=booking.payment_status.value if show_owner_private else None,
        renter=renter,
        created_by=str(booking.created_by) if show_admin else None,
        cancelled_by=str(booking.cancelled_by) if (show_admin and booking.cancelled_by) else None,
        cancelled_at=booking.cancelled_at.isoformat() if booking.cancelled_at else None,
        cancellation_reason=booking.cancellation_reason if show_admin else None,
        created_at=booking.created_at.isoformat() if booking.created_at else None,
    )


@router.post("/bookings/bulk", response_model=BulkBookingCreateResponse, status_code=201)
def create_bulk(
    payload: BulkBookingCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != UserRole.renter:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bulk booking is for renters")
    items = [
        {
            "chair_id": it.chair_id,
            "starts_at": it.starts_at,
            "ends_at": it.ends_at,
            "booking_type": it.booking_type,
            "renter_id": user.id,
            "price_amount": it.price_amount,
        }
        for it in payload.items
    ]
    bookings, failures = create_bookings_bulk(db, actor=user, items=items)
    if bookings:
        notify_bulk_bookings_created(booking_ids=[b.id for b in bookings], actor_id=user.id)
    outs = [_booking_out(b, viewer=user) for b in bookings]
    results = [
        BulkBookingResultItem(date=localize_shop(b.starts_at).date().isoformat(), chair_id=str(b.chair_id), ok=True, booking=out)
        for b, out in zip(bookings, outs, strict=True)
    ]
    for f in failures:
        results.append(
            BulkBookingResultItem(
                date=localize_shop(f["starts_at"]).date().isoformat(),
                chair_id=str(f["chair_id"]),
                ok=False,
                error=f.get("error"),
            )
        )
    # Preserve request order by date+chair as best effort? not critical; keep stable-ish.
    results.sort(key=lambda r: (r.date, r.chair_id, 0 if r.ok else 1))
    total = sum(b.price_amount for b in bookings)
    currency = bookings[0].currency if bookings else "BYN"
    return BulkBookingCreateResponse(created_count=len(bookings), failed_count=len(failures), total_amount=total, currency=currency, results=results)


@router.post("/bookings", response_model=BookingOut, status_code=201)
def create(
    payload: BookingCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.renter_id is not None and user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    booking = create_booking(
        db,
        actor=user,
        chair_id=payload.chair_id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        booking_type=payload.booking_type,
        renter_id=payload.renter_id,
    )
    # Booking is committed inside create_booking; notify after commit. Never rollback on notify errors.
    notify_booking_created(booking_id=booking.id, actor_id=user.id)
    return _booking_out(booking, viewer=user)


@router.get("/bookings/my", response_model=list[BookingOut])
def my_bookings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return [_booking_out(b, viewer=user) for b in list_my_bookings(db, renter=user)]


@router.get("/bookings/{booking_id}", response_model=BookingOut)
def get_one(
    booking_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    booking = get_booking_for_actor(db, actor=user, booking_id=booking_id)
    return _booking_out(booking, viewer=user)


@router.post("/bookings/{booking_id}/cancel", response_model=BookingOut)
def cancel(
    booking_id: uuid.UUID,
    payload: BookingCancelRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    reason = payload.reason if payload else None
    booking = cancel_booking(db, actor=user, booking_id=booking_id, reason=reason)
    notify_booking_cancelled(booking_id=booking.id, actor_id=user.id)
    return _booking_out(booking, viewer=user)


@router.get("/admin/bookings", response_model=list[BookingOut])
def admin_list(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    from_dt: datetime | None = Query(default=None),
    to_dt: datetime | None = Query(default=None),
    chair_id: uuid.UUID | None = Query(default=None),
    renter_id: uuid.UUID | None = Query(default=None),
    payment_status: PaymentStatus | None = Query(default=None),
    booking_status: BookingStatus | None = Query(default=None),
):
    bookings = list_admin_bookings(
        db,
        from_dt=from_dt,
        to_dt=to_dt,
        chair_id=chair_id,
        renter_id=renter_id,
        payment_status=payment_status,
        booking_status=booking_status,
    )
    return [_booking_out(b, viewer=admin) for b in bookings]


@router.post("/admin/bookings", response_model=BookingOut, status_code=201)
def admin_create(
    payload: BookingCreateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    booking = create_booking(
        db,
        actor=admin,
        chair_id=payload.chair_id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        booking_type=payload.booking_type,
        renter_id=payload.renter_id,
    )
    notify_booking_created(booking_id=booking.id, actor_id=admin.id)
    return _booking_out(booking, viewer=admin)


@router.patch("/admin/bookings/{booking_id}/payment", response_model=BookingOut)
def admin_payment(
    booking_id: uuid.UUID,
    payload: PaymentStatusRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    booking = update_payment_status(
        db, booking_id=booking_id, payment_status=payload.payment_status
    )
    return _booking_out(booking, viewer=admin)
