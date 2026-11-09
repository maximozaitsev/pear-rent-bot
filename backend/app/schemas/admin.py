from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, Field


class ChairCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class ChairUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    is_active: bool | None = None


class ChairOut(BaseModel):
    id: str
    name: str
    is_active: bool
    created_at: datetime
    archived_at: datetime | None


class ChairConflictOut(BaseModel):
    id: str
    starts_at: str
    ends_at: str
    renter_id: str
    booking_type: str


class WeeklyScheduleItem(BaseModel):
    weekday: int = Field(ge=0, le=6)
    is_open: bool
    open_time: time | None = None
    close_time: time | None = None


class WeeklyScheduleUpsert(BaseModel):
    items: list[WeeklyScheduleItem]


class WeeklyScheduleOut(BaseModel):
    weekday: int
    is_open: bool
    open_time: time | None
    close_time: time | None
    updated_at: datetime


class DateOverrideUpsert(BaseModel):
    is_open: bool
    open_time: time | None = None
    close_time: time | None = None
    reason: str | None = Field(default=None, max_length=255)


class DateOverrideOut(BaseModel):
    date: date
    is_open: bool
    open_time: time | None
    close_time: time | None
    reason: str | None
    created_by: str
    created_at: datetime
    updated_at: datetime


class RenterOut(BaseModel):
    id: str
    telegram_id: int
    username: str | None
    first_name: str | None
    last_name: str | None
    phone: str | None = None
    is_active: bool
    renter_role: str | None = None
    created_at: datetime


class RenterPaymentStats(BaseModel):
    debt: int = 0
    to_pay: int = 0
    paid_total: int = 0


class RenterDetailOut(BaseModel):
    renter: RenterOut
    bookings: list[dict]
    stats: RenterPaymentStats


class RenterStatusRequest(BaseModel):
    is_active: bool


class RenterRoleRequest(BaseModel):
    renter_role: Literal["permanent", "temporary"]
