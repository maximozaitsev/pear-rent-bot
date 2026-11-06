from datetime import datetime

from pydantic import BaseModel, Field


class TelegramAuthRequest(BaseModel):
    init_data: str = Field(min_length=1)
    # DEV_INSECURE_AUTH_BYPASS only; ignored otherwise.
    dev_user: dict | None = None
    code: str | None = None


class RegisterRequest(BaseModel):
    init_data: str = Field(min_length=1)
    code: str = Field(min_length=4, max_length=32)


class UserOut(BaseModel):
    id: str
    telegram_id: int
    username: str | None
    first_name: str | None
    last_name: str | None
    phone: str | None
    role: str
    is_active: bool
    created_at: datetime


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
    needs_registration: bool = False


class CompleteRegistrationRequest(BaseModel):
    first_name: str = Field(min_length=1, max_length=255)
    last_name: str | None = Field(default=None, max_length=255)
    phone: str = Field(min_length=5, max_length=32)


class InvitationOut(BaseModel):
    id: str
    code: str
    status: str
    created_by: str
    used_by: str | None
    created_at: datetime
    used_at: datetime | None
    revoked_at: datetime | None


class InvitationCreatedOut(InvitationOut):
    pass
