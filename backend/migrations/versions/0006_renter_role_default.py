"""add server default for users.renter_role

Revision ID: 0006_renter_role_default
Revises: 0005_renter_role
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_renter_role_default"
down_revision: str | Sequence[str] | None = "0005_renter_role"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _set_default(default: str | None) -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("users", recreate="always") as batch:
            batch.alter_column("renter_role", existing_type=sa.String(length=20), server_default=default)
        return
    op.alter_column("users", "renter_role", existing_type=sa.String(length=20), server_default=default)


def upgrade() -> None:
    _set_default("permanent")


def downgrade() -> None:
    _set_default(None)
