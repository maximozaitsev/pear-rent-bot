"""add renter_role to users

Revision ID: 0005_renter_role
Revises: 0004_invitation_code
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_renter_role"
down_revision: str | Sequence[str] | None = "0004_invitation_code"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ROLE_CHECK = "ck_users_renter_role"


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("users", recreate="always") as batch:
            batch.add_column(sa.Column("renter_role", sa.String(length=20), nullable=True))
            batch.create_check_constraint(ROLE_CHECK, "renter_role IN ('permanent', 'temporary')")
        op.execute("UPDATE users SET renter_role = 'permanent' WHERE renter_role IS NULL")
        with op.batch_alter_table("users", recreate="always") as batch:
            batch.alter_column("renter_role", existing_type=sa.String(length=20), nullable=False)
        return
    op.add_column("users", sa.Column("renter_role", sa.String(length=20), nullable=True))
    op.create_check_constraint(ROLE_CHECK, "users", "renter_role IN ('permanent', 'temporary')")
    op.execute("UPDATE users SET renter_role = 'permanent' WHERE renter_role IS NULL")
    op.alter_column("users", "renter_role", existing_type=sa.String(length=20), nullable=False)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("users", recreate="always") as batch:
            batch.drop_constraint(ROLE_CHECK, type_="check")
            batch.drop_column("renter_role")
        return
    op.drop_constraint(ROLE_CHECK, "users", type_="check")
    op.drop_column("users", "renter_role")
