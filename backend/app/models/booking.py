import enum
from datetime import datetime

from sqlalchemy import CHAR, DateTime, Enum, ForeignKey, Index, Integer, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class BookingType(str, enum.Enum):
    hourly = "hourly"
    full_day = "full_day"


class PaymentStatus(str, enum.Enum):
    unpaid = "unpaid"
    paid = "paid"


class BookingStatus(str, enum.Enum):
    active = "active"
    cancelled = "cancelled"


class Booking(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "bookings"
    __table_args__ = (
        Index("ix_bookings_chair_starts_ends", "chair_id", "starts_at", "ends_at"),
        Index("ix_bookings_renter_starts", "renter_id", "starts_at"),
        Index("ix_bookings_status_starts", "status", "starts_at"),
        Index("ix_bookings_payment_status_starts", "payment_status", "starts_at"),
    )

    chair_id: Mapped[object] = mapped_column(GUID(), ForeignKey("chairs.id"), nullable=False)
    renter_id: Mapped[object] = mapped_column(GUID(), ForeignKey("users.id"), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    booking_type: Mapped[BookingType] = mapped_column(
        Enum(BookingType, name="booking_type", native_enum=False, length=20), nullable=False
    )
    duration_hours: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    price_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(CHAR(3), nullable=False, default="BYN")
    payment_status: Mapped[PaymentStatus] = mapped_column(
        Enum(PaymentStatus, name="payment_status", native_enum=False, length=20),
        nullable=False,
        default=PaymentStatus.unpaid,
    )
    status: Mapped[BookingStatus] = mapped_column(
        Enum(BookingStatus, name="booking_status", native_enum=False, length=20),
        nullable=False,
        default=BookingStatus.active,
    )
    created_by: Mapped[object] = mapped_column(GUID(), ForeignKey("users.id"), nullable=False)
    cancelled_by: Mapped[object | None] = mapped_column(
        GUID(), ForeignKey("users.id"), nullable=True
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    chair = relationship("Chair", back_populates="bookings")
    renter = relationship("User", foreign_keys=[renter_id], back_populates="bookings")
