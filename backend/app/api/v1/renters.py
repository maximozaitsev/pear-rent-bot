import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.core.db import get_db
from app.models import Booking, BookingStatus, PaymentStatus, RenterRole, User
from app.schemas.admin import (
    RenterOut,
    RenterPaymentStats,
    RenterRoleRequest,
    RenterStatusRequest,
    RenterUpdateRequest,
)
from app.schemas.bookings import BookingOut
from app.services.renters import (
    delete_renter,
    get_renter,
    list_renters,
    set_renter_role,
    set_renter_status,
    update_renter,
)
from app.services.schedule import localize_shop, shop_tz

router = APIRouter()


def _renter_out(user: User) -> RenterOut:
    return RenterOut(
        id=str(user.id),
        telegram_id=user.telegram_id,
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
        phone=user.phone,
        is_active=user.is_active,
        renter_role=user.renter_role.value if user.renter_role else None,
        created_at=user.created_at,
    )


def _booking_out(booking, viewer: User) -> BookingOut:
    starts_local = localize_shop(booking.starts_at)
    ends_local = localize_shop(booking.ends_at)
    return BookingOut(
        id=str(booking.id),
        chair_id=str(booking.chair_id),
        renter_id=str(booking.renter_id),
        starts_at=starts_local.isoformat(),
        ends_at=ends_local.isoformat(),
        booking_type=booking.booking_type.value,
        duration_hours=booking.duration_hours,
        price_amount=booking.price_amount,
        currency=booking.currency,
        status=booking.status.value,
        payment_status=booking.payment_status.value,
        cancelled_by=str(booking.cancelled_by) if booking.cancelled_by else None,
        cancelled_at=booking.cancelled_at.isoformat() if booking.cancelled_at else None,
        cancellation_reason=booking.cancellation_reason,
        created_at=booking.created_at.isoformat() if booking.created_at else None,
    )


def _payment_stats(bookings: list[Booking]) -> RenterPaymentStats:
    today = datetime.now(shop_tz()).date()
    debt = to_pay = paid_total = 0
    for b in bookings:
        if b.status != BookingStatus.active:
            continue
        if b.payment_status == PaymentStatus.paid:
            paid_total += b.price_amount
        elif localize_shop(b.starts_at).date() < today:
            debt += b.price_amount
        else:
            to_pay += b.price_amount
    return RenterPaymentStats(debt=debt, to_pay=to_pay, paid_total=paid_total)


@router.get("/admin/renters", response_model=list[RenterOut])
def admin_list_renters(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return [_renter_out(r) for r in list_renters(db)]


@router.get("/admin/renters/{renter_id}")
def admin_get_renter(
    renter_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    data = get_renter(db, renter_id)
    return {
        "renter": _renter_out(data["renter"]),
        "bookings": [_booking_out(b, viewer=admin) for b in data["bookings"]],
        "stats": _payment_stats(data["bookings"]).model_dump(),
    }


@router.patch("/admin/renters/{renter_id}/status", response_model=RenterOut)
def admin_set_renter_status(
    renter_id: uuid.UUID,
    payload: RenterStatusRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    return _renter_out(set_renter_status(db, renter_id=renter_id, is_active=payload.is_active))


@router.patch("/admin/renters/{renter_id}/role", response_model=RenterOut)
def admin_set_renter_role(
    renter_id: uuid.UUID,
    payload: RenterRoleRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    return _renter_out(
        set_renter_role(
            db,
            renter_id=renter_id,
            renter_role=RenterRole(payload.renter_role),
        )
    )


@router.patch("/admin/renters/{renter_id}", response_model=RenterOut)
def admin_update_renter(
    renter_id: uuid.UUID,
    payload: RenterUpdateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    return _renter_out(
        update_renter(
            db,
            renter_id=renter_id,
            first_name=payload.first_name,
            last_name=payload.last_name,
        )
    )


@router.delete("/admin/renters/{renter_id}", response_model=RenterOut)
def admin_delete_renter(
    renter_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    data = get_renter(db, renter_id)
    out = _renter_out(data["renter"])
    delete_renter(db, renter_id=renter_id)
    return out
