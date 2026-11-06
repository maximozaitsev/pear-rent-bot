import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.core.db import get_db
from app.models import User
from app.schemas.auth import InvitationCreatedOut, InvitationOut
from app.services.invitations import (
    create_invitation,
    list_invitations,
    revoke_invitation,
)

router = APIRouter()


def _out(inv) -> InvitationOut:
    return InvitationOut(
        id=str(inv.id),
        status=inv.status.value,
        created_by=str(inv.created_by),
        used_by=str(inv.used_by) if inv.used_by else None,
        created_at=inv.created_at,
        used_at=inv.used_at,
        revoked_at=inv.revoked_at,
    )


@router.post("", response_model=InvitationCreatedOut, status_code=status.HTTP_201_CREATED)
def create(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> InvitationCreatedOut:
    invitation, code = create_invitation(db, created_by=admin)
    base = _out(invitation)
    return InvitationCreatedOut(**base.model_dump(), code=code)


@router.get("", response_model=list[InvitationOut])
def list_all(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[InvitationOut]:
    return [_out(i) for i in list_invitations(db)]


@router.post("/{invitation_id}/revoke", response_model=InvitationOut)
def revoke(
    invitation_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> InvitationOut:
    return _out(revoke_invitation(db, invitation_id))
