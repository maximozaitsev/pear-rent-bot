"""add user phone

Revision ID: 0003_user_phone
Revises: 0002_stage6_notification_log
Create Date: 2026-11-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_user_phone"
down_revision: str | Sequence[str] | None = "0002_stage6_notification_log"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "phone")
