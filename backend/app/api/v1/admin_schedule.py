from datetime import date

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.core.db import get_db
from app.models import User
from app.schemas.admin import (
    DateOverrideOut,
    DateOverrideUpsert,
    WeeklyScheduleOut,
    WeeklyScheduleUpsert,
)
from app.services.admin_schedule import (
    delete_override,
    list_overrides,
    list_weekly,
    upsert_override,
    upsert_weekly,
)

router = APIRouter()


def _weekly_out(row) -> WeeklyScheduleOut:
    return WeeklyScheduleOut(
        weekday=row.weekday,
        is_open=row.is_open,
        open_time=row.open_time,
        close_time=row.close_time,
        updated_at=row.updated_at,
    )


def _override_out(row) -> DateOverrideOut:
    return DateOverrideOut(
        date=row.date,
        is_open=row.is_open,
        open_time=row.open_time,
        close_time=row.close_time,
        reason=row.reason,
        created_by=str(row.created_by),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/admin/schedule/weekly", response_model=list[WeeklyScheduleOut])
def admin_get_weekly(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return [_weekly_out(r) for r in list_weekly(db)]


@router.put("/admin/schedule/weekly", response_model=list[WeeklyScheduleOut])
def admin_put_weekly(
    payload: WeeklyScheduleUpsert,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    items = [item.model_dump() for item in payload.items]
    return [_weekly_out(r) for r in upsert_weekly(db, items=items)]


@router.get("/admin/schedule/exceptions", response_model=list[DateOverrideOut])
def admin_list_exceptions(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return [_override_out(r) for r in list_overrides(db)]


@router.put("/admin/schedule/exceptions/{day}", response_model=DateOverrideOut)
def admin_put_exception(
    day: date,
    payload: DateOverrideUpsert,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    row = upsert_override(
        db,
        day=day,
        is_open=payload.is_open,
        open_time=payload.open_time,
        close_time=payload.close_time,
        reason=payload.reason,
        admin_id=admin.id,
    )
    return _override_out(row)


@router.delete("/admin/schedule/exceptions/{day}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_exception(
    day: date,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    delete_override(db, day=day)
    return None
