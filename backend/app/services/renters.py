import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Booking, RenterRole, User, UserRole


def list_renters(db: Session) -> list[User]:
    return list(
        db.scalars(
            select(User).where(User.role == UserRole.renter).order_by(User.created_at.desc())
        )
    )


def get_renter(db: Session, renter_id: uuid.UUID) -> dict:
    renter = db.scalar(select(User).where(User.id == renter_id, User.role == UserRole.renter))
    if renter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Renter not found")
    bookings = list(
        db.scalars(
            select(Booking)
            .where(Booking.renter_id == renter_id)
            .order_by(Booking.starts_at.desc())
        )
    )
    return {"renter": renter, "bookings": bookings}


def set_renter_status(db: Session, *, renter_id: uuid.UUID, is_active: bool) -> User:
    renter = db.scalar(select(User).where(User.id == renter_id, User.role == UserRole.renter))
    if renter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Renter not found")
    renter.is_active = is_active
    db.commit()
    db.refresh(renter)
    return renter


def set_renter_role(db: Session, *, renter_id: uuid.UUID, renter_role: RenterRole) -> User:
    renter = db.scalar(select(User).where(User.id == renter_id, User.role == UserRole.renter))
    if renter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Renter not found")
    renter.renter_role = renter_role
    db.commit()
    db.refresh(renter)
    return renter
