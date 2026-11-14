import enum

from sqlalchemy import BigInteger, Boolean, Enum, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class UserRole(str, enum.Enum):
    admin = "admin"
    renter = "renter"


class RenterRole(str, enum.Enum):
    permanent = "permanent"
    temporary = "temporary"


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_role_is_active", "role", "is_active"),
    )

    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False, index=True)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    first_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", native_enum=False, length=20),
        nullable=False,
    )
    renter_role: Mapped[RenterRole] = mapped_column(
        Enum(RenterRole, name="renter_role", native_enum=False, length=20),
        nullable=False,
        default=RenterRole.permanent,
        server_default=RenterRole.permanent.value,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    bookings = relationship("Booking", foreign_keys="Booking.renter_id", back_populates="renter")
