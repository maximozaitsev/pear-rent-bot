import hashlib
import secrets
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Invitation, InvitationStatus, User, UserRole


def hash_code(code: str) -> str:
    return hashlib.sha256(code.strip().encode("utf-8")).hexdigest()


def create_invitation(db: Session, *, created_by: User) -> tuple[Invitation, str]:
    if created_by.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    for _ in range(20):
        code = f"{secrets.randbelow(1_000_000):06d}"
        if not db.scalar(select(Invitation.id).where(Invitation.token_hash == hash_code(code))):
            break
    else:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not generate code")
    invitation = Invitation(
        token_hash=hash_code(code),
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
    token: str,
    telegram_id: int,
    username: str | None,
    first_name: str | None,
    last_name: str | None,
) -> User:
    """Register a renter using a one-time 6-digit code.

    Locks the invitation row to prevent parallel reuse. Safe with session fixtures that
    manage outer transactions (uses a savepoint when a transaction is already active).
    Never allows assigning admin role via invite.
    """
    token_digest = hash_code(token)
    started_tx = not db.in_transaction()
    if started_tx:
        ctx = db.begin()
    else:
        ctx = db.begin_nested()
    with ctx:
        invitation = db.scalar(
            select(Invitation).where(Invitation.token_hash == token_digest).with_for_update()
        )
        if invitation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Код не найден"
            )
        if invitation.status == InvitationStatus.used:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Код уже использован"
            )
        if invitation.status == InvitationStatus.revoked:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Код отозван"
            )
        if invitation.status != InvitationStatus.pending:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Код недоступен"
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
            role=UserRole.renter,  # explicit: invite never grants admin
            is_active=True,
        )
        db.add(user)
        db.flush()

        invitation.status = InvitationStatus.used
        invitation.used_by = user.id
        invitation.used_at = datetime.now(UTC)
    if not started_tx and db.in_transaction():
        db.commit()
    db.refresh(user)
    return user
