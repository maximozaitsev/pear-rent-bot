"""replace invitation token_hash with code

Revision ID: 0004_invitation_code
Revises: 0003_user_phone
Create Date: 2026-11-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_invitation_code"
down_revision: str | Sequence[str] | None = "0003_user_phone"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("invitations", recreate="always") as batch:
            batch.add_column(sa.Column("code", sa.String(length=6), nullable=True))
            batch.drop_column("token_hash")
            batch.alter_column("code", existing_type=sa.String(length=6), nullable=False)
            batch.create_unique_constraint("uq_invitations_code", ["code"])
        return
    op.add_column("invitations", sa.Column("code", sa.String(length=6), nullable=True))
    op.drop_constraint("uq_invitations_token_hash", "invitations", type_="unique")
    op.drop_column("invitations", "token_hash")
    op.alter_column("invitations", "code", nullable=False)
    op.create_unique_constraint("uq_invitations_code", "invitations", ["code"])


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("invitations", recreate="always") as batch:
            batch.add_column(sa.Column("token_hash", sa.String(length=255), nullable=True))
            batch.drop_column("code")
            batch.alter_column("token_hash", existing_type=sa.String(length=255), nullable=False)
            batch.create_unique_constraint("uq_invitations_token_hash", ["token_hash"])
        return
    op.add_column("invitations", sa.Column("token_hash", sa.String(length=255), nullable=True))
    op.drop_constraint("uq_invitations_code", "invitations", type_="unique")
    op.drop_column("invitations", "code")
    op.alter_column("invitations", "token_hash", nullable=False)
    op.create_unique_constraint("uq_invitations_token_hash", "invitations", ["token_hash"])