import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.core.db import get_db
from app.models import User
from app.schemas.admin import RenterOut, RenterStatusRequest
from app.schemas.bookings import BookingOut
from app.services.renters import get_renter, list_renters, set_renter_status

router = APIRouter()


def _renter_out(user: User) -> RenterOut:
    return RenterOut(
        id=str(user.id),
        telegram_id=user.telegram_id,
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
        is_active=user.is_active,
        created_at=user.created_at,
    )


def _booking_out(booking, viewer: User) -> BookingOut:
    return BookingOut(
        id=str(booking.id),
        chair_id=str(booking.chair_id),
        renter_id=str(booking.renter_id),
        starts_at=booking.starts_at.isoformat(),
        ends_at=booking.ends_at.isoformat(),
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
    }


@router.patch("/admin/renters/{renter_id}/status", response_model=RenterOut)
def admin_set_renter_status(
    renter_id: uuid.UUID,
    payload: RenterStatusRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    return _renter_out(set_renter_status(db, renter_id=renter_id, is_active=payload.is_active))
