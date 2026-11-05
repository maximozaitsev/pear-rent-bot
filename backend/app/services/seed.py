from datetime import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Chair, User, UserRole, WeeklySchedule


def seed_initial_data(db: Session) -> None:
    """Idempotent seed for stage-1 baseline data."""
    _seed_chairs(db)
    _seed_weekly_schedule(db)
    _seed_admins(db)
    db.commit()


def _seed_chairs(db: Session) -> None:
    if db.scalar(select(Chair.id).limit(1)) is not None:
        return
    db.add_all([Chair(name="Кресло №1"), Chair(name="Кресло №2")])


def _seed_weekly_schedule(db: Session) -> None:
    if db.scalar(select(WeeklySchedule.id).limit(1)) is not None:
        return
    for weekday in range(7):
        db.add(
            WeeklySchedule(
                weekday=weekday,
                is_open=True,
                open_time=time(9, 0),
                close_time=time(22, 0),
            )
        )


def _seed_admins(db: Session) -> None:
    # Safe bootstrap only: admins are created from explicit env config, never via public API.
    for telegram_id in settings.admin_telegram_id_list:
        existing = db.scalar(select(User).where(User.telegram_id == telegram_id))
        if existing is None:
            db.add(User(telegram_id=telegram_id, role=UserRole.admin, is_active=True))
            continue
        if existing.role != UserRole.admin:
            existing.role = UserRole.admin
            existing.is_active = True
