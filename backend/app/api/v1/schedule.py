from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.db import get_db
from app.models import User
from app.services.availability import day_schedule
from app.services.schedule import get_working_hours

router = APIRouter()


@router.get("/schedule/working-hours")
def working_hours(
    day: date = Query(alias="date"),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    hours = get_working_hours(db, day)
    return {
        "date": day.isoformat(),
        "is_open": hours.is_open,
        "open_time": hours.open_time.isoformat() if hours.open_time else None,
        "close_time": hours.close_time.isoformat() if hours.close_time else None,
        "source": hours.source,
    }


@router.get("/schedule/day")
def schedule_day(
    day: date = Query(alias="date"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return day_schedule(db, day, viewer=user)


@router.get("/schedule/weekly")
def schedule_weekly(
    week: date = Query(alias="week"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    start = week - timedelta(days=week.weekday())
    days = [day_schedule(db, start + timedelta(days=i), viewer=user) for i in range(7)]
    return {"week_start": start.isoformat(), "days": days}


@router.get("/schedule/availability")
def availability(
    from_date: date = Query(alias="from"),
    to_date: date = Query(alias="to"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if to_date < from_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid date range"
        )
    if (to_date - from_date).days > 31:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Range too large"
        )
    days = []
    cur = from_date
    while cur <= to_date:
        days.append(day_schedule(db, cur, viewer=user))
        cur += timedelta(days=1)
    return {"from": from_date.isoformat(), "to": to_date.isoformat(), "days": days}
