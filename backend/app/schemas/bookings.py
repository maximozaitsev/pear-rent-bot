import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.models import BookingType, PaymentStatus


def _coerce_shop_datetime(value: object) -> object:
    if not isinstance(value, str):
        return value
    s = value.strip()
    if not s:
        return value
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return value
    if dt.tzinfo is None:
        return dt.replace(tzinfo=ZoneInfo(settings.timezone))
    return dt


class BookingCreateRequest(BaseModel):
    chair_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    booking_type: BookingType
    renter_id: uuid.UUID | None = None  # admin-only

    @field_validator("starts_at", "ends_at", mode="before")
    @classmethod
    def _shop_local(cls, v: object) -> object:
        return _coerce_shop_datetime(v)


class BookingCancelRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class PaymentStatusRequest(BaseModel):
    payment_status: PaymentStatus


class RenterBriefOut(BaseModel):
    id: str
    telegram_id: int
    username: str | None
    first_name: str | None
    last_name: str | None


class BookingOut(BaseModel):
    id: str
    chair_id: str
    renter_id: str
    starts_at: str
    ends_at: str
    booking_type: str
    duration_hours: int
    price_amount: int
    currency: str
    status: str
    payment_status: str | None = None
    renter: RenterBriefOut | None = None
    created_by: str | None = None
    cancelled_by: str | None = None
    cancelled_at: str | None = None
    cancellation_reason: str | None = None
    created_at: str | None = None
