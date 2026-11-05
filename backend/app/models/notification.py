import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, UUIDPrimaryKeyMixin


class NotificationLog(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "notification_log"
    __table_args__ = (
        UniqueConstraint(
            "event_type",
            "booking_id",
            "recipient_user_id",
            name="uq_notification_log_event_booking_recipient",
        ),
    )

    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    booking_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("bookings.id"), nullable=False)
    recipient_user_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
