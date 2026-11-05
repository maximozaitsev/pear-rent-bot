import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, UUIDPrimaryKeyMixin


class InvitationStatus(str, enum.Enum):
    pending = "pending"
    used = "used"
    revoked = "revoked"


class Invitation(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "invitations"

    token_hash: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    status: Mapped[InvitationStatus] = mapped_column(
        Enum(InvitationStatus, name="invitation_status", native_enum=False, length=20),
        nullable=False,
        default=InvitationStatus.pending,
    )
    created_by: Mapped[object] = mapped_column(GUID(), ForeignKey("users.id"), nullable=False)
    used_by: Mapped[object | None] = mapped_column(
        GUID(), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
