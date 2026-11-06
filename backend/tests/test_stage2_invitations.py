import json
import time
from urllib.parse import urlencode

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import settings
from app.core.db import get_db
from app.main import app
from app.models import Invitation, InvitationStatus, User, UserRole


def build_init_data(*, bot_token: str, user: dict) -> str:
    import hashlib
    import hmac

    payload = {"auth_date": str(int(time.time())), "user": json.dumps(user, separators=(",", ":"))}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(payload.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    payload["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode(payload)


def test_admin_create_list_revoke_invitation(db, monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "test-token")
    monkeypatch.setattr(settings, "admin_telegram_ids", "9101")
    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db
    try:
        init_data = build_init_data(bot_token="test-token", user={"id": 9101, "first_name": "A"})
        login = client.post("/api/v1/auth/telegram", json={"init_data": init_data})
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        created = client.post("/api/v1/admin/invitations", headers=headers)
        assert created.status_code == 201
        body = created.json()
        assert body["code"] and len(body["code"]) == 6 and body["code"].isdigit()
        assert body["status"] == "pending"
        invite_id = body["id"]
        code = body["code"]

        listing = client.get("/api/v1/admin/invitations", headers=headers)
        assert listing.status_code == 200
        assert listing.json()[0]["id"] == invite_id
        assert listing.json()[0]["code"] == code

        revoked = client.post(f"/api/v1/admin/invitations/{invite_id}/revoke", headers=headers)
        assert revoked.status_code == 200
        assert revoked.json()["status"] == "revoked"
    finally:
        app.dependency_overrides.clear()


def test_register_by_valid_invite_once_then_reused_fails(db, monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "test-token")
    monkeypatch.setattr(settings, "admin_telegram_ids", "9201")
    admin = User(telegram_id=9201, role=UserRole.admin, is_active=True)
    db.add(admin)
    db.flush()
    invitation = Invitation(
        code="123456",
        status=InvitationStatus.pending,
        created_by=admin.id,
    )
    db.add(invitation)
    db.commit()

    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db
    try:
        init_data = build_init_data(bot_token="test-token", user={"id": 9202, "username": "u"})
        reg = client.post(
            "/api/v1/auth/register",
            json={"init_data": init_data, "code": "123456"},
        )
        assert reg.status_code == 201
        assert reg.json()["user"]["role"] == "renter"

        reg2 = client.post(
            "/api/v1/auth/register",
            json={"init_data": init_data, "code": "123456"},
        )
        assert reg2.status_code == 409
    finally:
        app.dependency_overrides.clear()


def test_register_invalid_revoked_used_scenarios(db, monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "test-token")
    monkeypatch.setattr(settings, "admin_telegram_ids", "")
    admin = User(telegram_id=9301, role=UserRole.admin, is_active=True)
    renter = User(telegram_id=9399, role=UserRole.renter, is_active=True)
    db.add_all([admin, renter])
    db.flush()
    db.add(Invitation(code="111111", status=InvitationStatus.revoked, created_by=admin.id))
    db.add(Invitation(code="222222", status=InvitationStatus.used, created_by=admin.id, used_by=renter.id))
    db.commit()

    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db
    try:
        init_data = build_init_data(bot_token="test-token", user={"id": 9302})
        bad = client.post("/api/v1/auth/register", json={"init_data": init_data, "code": "999999"})
        assert bad.status_code == 404
        revoked = client.post("/api/v1/auth/register", json={"init_data": init_data, "code": "111111"})
        assert revoked.status_code == 409
        used = client.post("/api/v1/auth/register", json={"init_data": init_data, "code": "222222"})
        assert used.status_code == 409
    finally:
        app.dependency_overrides.clear()


def test_parallel_registration_one_token_one_success():
    import os

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.models import Base
    from app.services.invitations import register_renter_with_invite

    url = os.environ.get("TEST_DATABASE_URL", "sqlite+pysqlite:///:memory:")
    if not url.startswith("postgresql"):
        pytest.skip("Parallel one-time invite race requires PostgreSQL; covered in CI")

    engine = create_engine(url, pool_pre_ping=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
    setup = SessionLocal()
    admin = User(telegram_id=9401, role=UserRole.admin, is_active=True)
    setup.add(admin)
    setup.flush()
    setup.add(Invitation(code="654321", status=InvitationStatus.pending, created_by=admin.id))
    setup.commit()
    setup.close()

    from concurrent.futures import ThreadPoolExecutor

    def attempt(tg_id: int):
        db = SessionLocal()
        try:
            register_renter_with_invite(db, code="654321", telegram_id=tg_id, username=None, first_name="R", last_name=None)
            return "ok"
        except Exception as exc:
            db.rollback()
            return type(exc).__name__
        finally:
            db.close()

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(attempt, [9402, 9403]))
        check = SessionLocal()
        try:
            users = list(check.scalars(select(User).where(User.role == UserRole.renter)))
            invite = check.scalar(select(Invitation))
            assert len([r for r in results if r == "ok"]) == 1
            assert len(users) == 1
            assert invite.status == InvitationStatus.used
        finally:
            check.close()
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()