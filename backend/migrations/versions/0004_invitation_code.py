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
    op.add_column("invitations", sa.Column("code", sa.String(length=6), nullable=True))
    # Backfill impossible for hashed tokens; drop old column.
    op.drop_constraint("uq_invitations_token_hash", "invitations", type_="unique")
    op.drop_column("invitations", "token_hash")
    op.alter_column("invitations", "code", nullable=False)
    op.create_unique_constraint("uq_invitations_code", "invitations", ["code"])


def downgrade() -> None:
    op.add_column("invitations", sa.Column("token_hash", sa.String(length=255), nullable=True))
    op.drop_constraint("uq_invitations_code", "invitations", type_="unique")
    op.drop_column("invitations", "code")
    op.alter_column("invitations", "token_hash", nullable=False)
    op.create_unique_constraint("uq_invitations_token_hash", "invitations", ["token_hash"])