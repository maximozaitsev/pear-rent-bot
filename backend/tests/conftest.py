import os
from collections.abc import Generator

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base


def _test_database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "sqlite+pysqlite:///:memory:")


@pytest.fixture(scope="session")
def db_engine():
    url = _test_database_url()
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in url:
            kwargs["poolclass"] = StaticPool
    engine = create_engine(url, **kwargs)
    if engine.dialect.name == "sqlite":

        @event.listens_for(engine, "connect")
        def _set_sqlite_pragma(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture(autouse=True)
def _disable_telegram_bot(monkeypatch):
    # Prevent network bot calls and keep booking API tests isolated from notification side effects.
    # Stage 6 tests restore real functions and verify notification behavior explicitly.
    import app.api.v1.bookings as bookings_api
    import app.notifications.service as notifications_service
    from app.core.config import settings

    monkeypatch.setattr(settings, "telegram_bot_token", "")
    monkeypatch.setattr(notifications_service, "get_bot", lambda: None)
    monkeypatch.setattr(notifications_service, "notify_booking_created", lambda **_: None)
    monkeypatch.setattr(notifications_service, "notify_booking_cancelled", lambda **_: None)
    if hasattr(notifications_service, "notify_bulk_bookings_created"):
        monkeypatch.setattr(notifications_service, "notify_bulk_bookings_created", lambda **_: None)
    monkeypatch.setattr(bookings_api, "notify_booking_created", lambda **_: None)
    monkeypatch.setattr(bookings_api, "notify_booking_cancelled", lambda **_: None)
    if hasattr(bookings_api, "notify_bulk_bookings_created"):
        monkeypatch.setattr(bookings_api, "notify_bulk_bookings_created", lambda **_: None)




@pytest.fixture()
def db(db_engine) -> Generator[Session, None, None]:
    connection = db_engine.connect()
    transaction = connection.begin()
    session = sessionmaker(
        bind=connection, autoflush=False, autocommit=False, expire_on_commit=False
    )()
    try:
        yield session
    finally:
        session.close()
        if transaction.is_active:
            transaction.rollback()
        connection.close()
