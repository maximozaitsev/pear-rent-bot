import hashlib
import hmac
import json
import logging
import time
from dataclasses import dataclass
from urllib.parse import parse_qsl

from fastapi import HTTPException, status

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class TelegramUser:
    id: int
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None


def validate_init_data(init_data: str) -> TelegramUser:
    """Validate Telegram WebApp initData per Telegram's official algorithm.

    Never trust user identity sent separately from initData.
    """
    def _debug(msg: str, *args: object) -> None:
        if settings.log_auth_debug:
            logger.info("auth_debug " + msg, *args)

    def _reject(status_code: int, detail: str) -> None:
        logger.warning("Telegram initData rejected: %s", detail)
        raise HTTPException(status_code=status_code, detail=detail)

    _debug(
        "validate start init_data_len=%s bot_token_configured=%s max_age=%s",
        len(init_data or ""), bool(settings.telegram_bot_token), settings.telegram_auth_max_age_seconds,
    )
    if not init_data:
        _reject(status.HTTP_401_UNAUTHORIZED, "initData required")
    if not settings.telegram_bot_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Telegram auth is not configured",
        )

    parsed = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = parsed.pop("hash", None)
    if not received_hash:
        _debug("missing hash keys=%s", sorted(parsed.keys()))
        _reject(status.HTTP_401_UNAUTHORIZED, "Invalid initData")

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))
    secret_key = hmac.new(
        b"WebAppData", settings.telegram_bot_token.encode(), hashlib.sha256
    ).digest()
    calculated_hash = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(calculated_hash, received_hash):
        _reject(status.HTTP_401_UNAUTHORIZED, "Invalid initData signature")

    try:
        auth_date = int(parsed.get("auth_date", "0"))
    except ValueError:
        _debug("bad auth_date raw=%r", parsed.get("auth_date"))
        _reject(status.HTTP_401_UNAUTHORIZED, "Invalid auth_date")
    now = int(time.time())
    age = now - auth_date
    _debug("auth_date=%s now=%s age_s=%s max_age=%s", auth_date, now, age, settings.telegram_auth_max_age_seconds)
    if auth_date <= 0:
        _reject(status.HTTP_401_UNAUTHORIZED, "Invalid auth_date")
    max_age = settings.telegram_auth_max_age_seconds
    if max_age > 0 and age > max_age:
        logger.warning("Telegram initData expired: age_s=%s max_age=%s auth_date=%s", age, max_age, auth_date)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="initData expired")

    raw_user = parsed.get("user")
    if not raw_user:
        _reject(status.HTTP_401_UNAUTHORIZED, "Missing Telegram user")
    try:
        payload = json.loads(raw_user)
    except json.JSONDecodeError:
        _reject(status.HTTP_401_UNAUTHORIZED, "Invalid Telegram user")
    try:
        telegram_id = int(payload["id"])
    except (KeyError, TypeError, ValueError):
        _reject(status.HTTP_401_UNAUTHORIZED, "Invalid Telegram user")

    _debug("validate ok telegram_id=%s username=%r", telegram_id, payload.get("username"))
    return TelegramUser(
        id=telegram_id,
        username=payload.get("username"),
        first_name=payload.get("first_name"),
        last_name=payload.get("last_name"),
    )
