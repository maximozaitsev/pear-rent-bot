from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "pear-rent-bot"
    env: str = "development"
    debug: bool = False
    api_prefix: str = "/api/v1"
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 60

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/pear_rent"

    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    telegram_mini_app_url: str = "https://example.com"
    admin_telegram_ids: str = ""

    timezone: str = "Europe/Minsk"
    telegram_auth_max_age_seconds: int = 86400

    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

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
