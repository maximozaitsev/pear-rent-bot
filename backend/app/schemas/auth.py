from datetime import datetime

from pydantic import BaseModel, Field


class TelegramAuthRequest(BaseModel):
    init_data: str = Field(min_length=1)
    start_param: str | None = None


class RegisterRequest(BaseModel):
    init_data: str = Field(min_length=1)
    invite_token: str = Field(min_length=20)


class UserOut(BaseModel):
    id: str
    telegram_id: int
    username: str | None
    first_name: str | None
    last_name: str | None
    role: str
    is_active: bool
    created_at: datetime


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
    needs_registration: bool = False


class InvitationOut(BaseModel):
    id: str
    status: str
    created_by: str
    used_by: str | None
    created_at: datetime
    used_at: datetime | None
    revoked_at: datetime | None


class InvitationCreatedOut(InvitationOut):
    invite_token: str
    invite_link: str
