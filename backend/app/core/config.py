import json
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ROOT_DIR = _BACKEND_DIR.parent
_ENV_FILES = (_BACKEND_DIR / ".env", _ROOT_DIR / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILES, env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "pear-rent-bot"
    env: str = "development"
    debug: bool = False
    api_prefix: str = "/api/v1"
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 60

    database_url: str = "sqlite:///./pear_rent.db"

    @field_validator("database_url", mode="before")
    @classmethod
    def _normalize_database_url(cls, value: object) -> object:
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return "sqlite:///./pear_rent.db"
            if raw.startswith("postgres://"):
                return raw.replace("postgres://", "postgresql+psycopg://", 1)
            if raw.startswith("postgresql://") and "+psycopg" not in raw:
                return raw.replace("postgresql://", "postgresql+psycopg://", 1)
            if raw.startswith("https://"):
                # Bothost may proxy DB URL; prefer explicit postgresql+psycopg if needed.
                return raw.replace("https://", "postgresql+psycopg://", 1)
            return raw
        return value

    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    telegram_mini_app_url: str = "https://example.com"
    admin_telegram_ids: str = ""

    timezone: str = "Europe/Minsk"
    telegram_auth_max_age_seconds: int = 86400

    cors_origins: list[str] | str = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, value: object) -> object:
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return ["http://localhost:5173", "http://127.0.0.1:5173"]
            if raw.startswith("["):
                return json.loads(raw)
            return [part.strip() for part in raw.split(",") if part.strip()]
        return value

    @property
    def admin_telegram_id_list(self) -> list[int]:
        raw = self.admin_telegram_ids.strip()
        if not raw:
            return []
        ids: list[int] = []
        for part in raw.split(","):
            part = part.strip()
            if part:
                ids.append(int(part))
        return ids


settings = Settings()
