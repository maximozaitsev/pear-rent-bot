import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_admin
from app.core.db import get_db
from app.models import User
from app.schemas.admin import ChairCreateRequest, ChairOut, ChairUpdateRequest
from app.services.chairs import archive_chair, create_chair, list_chairs, update_chair

router = APIRouter()


def _out(chair) -> ChairOut:
    return ChairOut(
        id=str(chair.id),
        name=chair.name,
        is_active=chair.is_active,
        created_at=chair.created_at,
        archived_at=chair.archived_at,
    )


@router.get("/chairs", response_model=list[ChairOut])
def get_chairs(
    include_archived: bool = Query(default=False),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    # Renter schedule uses active chairs via schedule API; explicit chair list is read-only.
    return [_out(c) for c in list_chairs(db, include_archived=include_archived)]


@router.post("/admin/chairs", response_model=ChairOut, status_code=status.HTTP_201_CREATED)
def admin_create_chair(
    payload: ChairCreateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    return _out(create_chair(db, name=payload.name))


@router.patch("/admin/chairs/{chair_id}", response_model=ChairOut)
def admin_update_chair(
    chair_id: uuid.UUID,
    payload: ChairUpdateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    return _out(update_chair(db, chair_id=chair_id, name=payload.name, is_active=payload.is_active))


@router.post("/admin/chairs/{chair_id}/archive", response_model=ChairOut)
def admin_archive_chair(
    chair_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    return _out(archive_chair(db, chair_id=chair_id))
