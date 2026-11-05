from sqlalchemy import func, select

from app.core.config import settings
from app.models import Chair, User, UserRole, WeeklySchedule
from app.services.seed import seed_initial_data


def test_seed_initial_data_idempotent(db, monkeypatch):
    monkeypatch.setattr(settings, "admin_telegram_ids", "900001,900002")
    # Test runs inside a savepoint-transaction fixture; seed commits at savepoint scope.
    seed_initial_data(db)
    seed_initial_data(db)

    assert db.scalar(select(func.count()).select_from(Chair)) == 2
    chairs = list(db.scalars(select(Chair).order_by(Chair.name)))
    assert [c.name for c in chairs] == ["Кресло №1", "Кресло №2"]

    assert db.scalar(select(func.count()).select_from(WeeklySchedule)) == 7
    schedules = list(db.scalars(select(WeeklySchedule).order_by(WeeklySchedule.weekday)))
    assert all(s.is_open for s in schedules)
    assert all(str(s.open_time).startswith("09:00") for s in schedules)
    assert all(str(s.close_time).startswith("22:00") for s in schedules)

    admins = list(
        db.scalars(select(User).where(User.role == UserRole.admin).order_by(User.telegram_id))
    )

    assert [a.telegram_id for a in admins] == [900001, 900002]
    assert all(a.is_active for a in admins)
