import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

from fastapi.testclient import TestClient

from app.core.auth import create_access_token
from app.core.config import settings
from app.core.db import get_db
from app.main import app
from app.models import User, UserRole


def build_init_data(*, bot_token: str, user: dict, auth_date: int | None = None) -> str:
    auth_date = int(time.time()) if auth_date is None else auth_date
    payload = {"auth_date": str(auth_date), "user": json.dumps(user, separators=(",", ":"))}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(payload.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    payload["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode(payload)


def test_telegram_auth_rejects_invalid_signature(db, monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "test-token")
    init_data = build_init_data(bot_token="wrong-token", user={"id": 42, "first_name": "A"})

    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db
    try:
        r = client.post("/api/v1/auth/telegram", json={"init_data": init_data})
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 401


def test_unknown_user_without_invite_gets_registration_required(db, monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "test-token")
    monkeypatch.setattr(settings, "admin_telegram_ids", "")
    init_data = build_init_data(bot_token="test-token", user={"id": 5001, "username": "r"})

    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db
    try:
        r = client.post("/api/v1/auth/telegram", json={"init_data": init_data})
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "registration_required"


def test_admin_bootstrapped_from_config(db, monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "test-token")
    monkeypatch.setattr(settings, "admin_telegram_ids", "7001")
    init_data = build_init_data(bot_token="test-token", user={"id": 7001, "first_name": "Admin"})

    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db
    try:
        r = client.post("/api/v1/auth/telegram", json={"init_data": init_data})
        assert r.status_code == 200
        token = r.json()["access_token"]
        me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    finally:
        app.dependency_overrides.clear()
    assert me.status_code == 200
    assert me.json()["role"] == "admin"
    assert me.json()["telegram_id"] == 7001


def test_renter_cannot_access_admin_invitations(db):
    renter = User(telegram_id=8001, role=UserRole.renter, is_active=True)
    db.add(renter)
    db.commit()
    token = create_access_token(renter)

    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db
    try:
        r = client.get("/api/v1/admin/invitations", headers={"Authorization": f"Bearer {token}"})
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 403
