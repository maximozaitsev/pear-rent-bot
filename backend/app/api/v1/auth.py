from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
import os, json
from urllib.parse import parse_qs

from app.core.auth import create_access_token, get_current_user, sync_admin_role_from_config
from app.core.config import settings
from app.core.db import get_db
from app.core.telegram_auth import validate_init_data
from app.models import User, UserRole
from app.schemas.auth import AuthResponse, CompleteRegistrationRequest, RegisterRequest, TelegramAuthRequest, UserOut
from app.services.invitations import register_renter_with_invite

router = APIRouter()


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=str(user.id),
        telegram_id=user.telegram_id,
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
        phone=user.phone,
        role=user.role.value,
        is_active=user.is_active,
        created_at=user.created_at,
    )


def _upsert_admin_if_configured(db: Session, tg_user) -> User | None:
    if tg_user.id not in set(settings.admin_telegram_id_list):
        return None
    user = db.scalar(select(User).where(User.telegram_id == tg_user.id))
    if user is None:
        user = User(
            telegram_id=tg_user.id,
            username=tg_user.username,
            first_name=tg_user.first_name,
            last_name=tg_user.last_name,
            role=UserRole.admin,
            is_active=True,
        )
        db.add(user)
    else:
        user.username = tg_user.username
        user.first_name = tg_user.first_name
        user.last_name = tg_user.last_name
        user.role = UserRole.admin
        user.is_active = True
    db.commit()
    db.refresh(user)
    return user


@router.post("/telegram", response_model=AuthResponse)
def auth_telegram(payload: TelegramAuthRequest, db: Session = Depends(get_db)) -> AuthResponse:
    tg_user = validate_init_data(payload.init_data)

    admin = _upsert_admin_if_configured(db, tg_user)
    if admin is not None:
        return AuthResponse(access_token=create_access_token(admin), user=_user_out(admin))

    user = db.scalar(select(User).where(User.telegram_id == tg_user.id))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "registration_required",
                "message": "Доступ выдаётся администратором. Введите код приглашения.",
            },
        )

    sync_admin_role_from_config(user)
    user.username = tg_user.username
    user.first_name = tg_user.first_name
    user.last_name = tg_user.last_name
    db.commit()
    db.refresh(user)

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive")
    return AuthResponse(access_token=create_access_token(user), user=_user_out(user))


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> AuthResponse:
    tg_user = validate_init_data(payload.init_data)
    if tg_user.id in set(settings.admin_telegram_id_list):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Administrator account is bootstrapped from configuration",
        )
    existing = db.scalar(select(User).where(User.telegram_id == tg_user.id))
    if existing is not None and existing.role == UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Role escalation forbidden"
        )


    token = payload.invite_code.strip()
    user = register_renter_with_invite(
        db,
        token=token,
        telegram_id=tg_user.id,
        username=tg_user.username,
        first_name=tg_user.first_name,
        last_name=tg_user.last_name,
    )
    return AuthResponse(access_token=create_access_token(user), user=_user_out(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return _user_out(user)


@router.post("/complete-registration", response_model=AuthResponse)
def complete_registration(
    payload: CompleteRegistrationRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AuthResponse:
    user.first_name = payload.first_name.strip()
    user.last_name = payload.last_name.strip() if payload.last_name else None
    user.phone = payload.phone.strip()
    db.commit()
    db.refresh(user)
    return AuthResponse(access_token=create_access_token(user), user=_user_out(user))


@router.post("/dev-bypass", response_model=AuthResponse)
def dev_bypass(payload: TelegramAuthRequest, db: Session = Depends(get_db)) -> AuthResponse:
    """DEV ONLY (DEV_INSECURE_AUTH_BYPASS=1): local Telegram WebView/ngrok debugging."""
    if os.getenv("DEV_INSECURE_AUTH_BYPASS", "").lower() not in {"1", "true", "yes"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Dev bypass disabled")
    tg = payload.dev_user if isinstance(payload.dev_user, dict) and payload.dev_user.get("id") else {}
    if not tg:
        parsed = parse_qs(payload.init_data, keep_blank_values=True)
        try:
            tg = json.loads(parsed.get("user", ["{}"])[0] or "{}")
        except Exception:
            tg = {}
    telegram_id = int(tg.get("id") or 0)
    if not telegram_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No Telegram user in initData")
    user = db.scalar(select(User).where(User.telegram_id == telegram_id))
    if user is None:
        code = (payload.invite_code or "").strip()
        if not code:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "registration_required", "message": "Введите код приглашения."})
        user = register_renter_with_invite(db, token=code, telegram_id=telegram_id, username=tg.get("username"), first_name=tg.get("first_name"), last_name=tg.get("last_name"))
    return AuthResponse(access_token=create_access_token(user), user=_user_out(user))
