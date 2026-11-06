import secrets
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import Invitation, InvitationStatus, User, UserRole


def create_invitation(db: Session, *, created_by: User) -> tuple[Invitation, str]:
    if created_by.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    for _ in range(20):
        code = f"{secrets.randbelow(1_000_000):06d}"
        if not db.scalar(select(Invitation.id).where(Invitation.code == code)):
            break
    else:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not generate code")
    invitation = Invitation(
        code=code,
        status=InvitationStatus.pending,
        created_by=created_by.id,
    )
    db.add(invitation)
    db.commit()
    db.refresh(invitation)
    return invitation, code


def list_invitations(db: Session) -> list[Invitation]:
    return list(db.scalars(select(Invitation).order_by(Invitation.created_at.desc())))


def revoke_invitation(db: Session, invitation_id) -> Invitation:
    invitation = db.get(Invitation, invitation_id)
    if invitation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
    if invitation.status != InvitationStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Invitation cannot be revoked"
        )
    invitation.status = InvitationStatus.revoked
    invitation.revoked_at = datetime.now(UTC)
    db.commit()
    db.refresh(invitation)
    return invitation


def register_renter_with_invite(
    db: Session,
    *,
    code: str,
    telegram_id: int,
    username: str | None,
    first_name: str | None,
    last_name: str | None,
) -> User:
    """Register a renter using a one-time 6-digit code.

    The code is claimed atomically via UPDATE ... WHERE code=... AND status='pending'.
    If no row is updated, the code is invalid or already used.
    """
    code = code.strip()
    started_tx = not db.in_transaction()
    if started_tx:
        ctx = db.begin()
    else:
        ctx = db.begin_nested()
    with ctx:
        invitation = db.scalar(select(Invitation).where(Invitation.code == code))
        if invitation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Код не найден"
            )

        existing = db.scalar(select(User).where(User.telegram_id == telegram_id))
        if existing is not None:
            if existing.role == UserRole.admin:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Administrator cannot register via invitation",
                )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="User already registered"
            )

        user = User(
            telegram_id=telegram_id,
            username=username,
            first_name=first_name,
            last_name=last_name,
            role=UserRole.renter,
            is_active=True,
        )
        db.add(user)
        db.flush()

        result = db.execute(
            update(Invitation)
            .where(Invitation.code == code, Invitation.status == InvitationStatus.pending)
            .values(status=InvitationStatus.used, used_by=user.id, used_at=datetime.now(UTC))
        )
        if result.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Код недействителен или уже использован",
            )
    if not started_tx and db.in_transaction():
        db.commit()
    db.refresh(user)
    return user
