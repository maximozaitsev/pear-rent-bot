"""stage 6 notification log

Revision ID: 0002_stage6_notification_log
Revises: 0001_stage1_initial
Create Date: 2026-11-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_stage6_notification_log"
down_revision: str | Sequence[str] | None = "0001_stage1_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notification_log",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("booking_id", sa.Uuid(), nullable=False),
        sa.Column("recipient_user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(length=1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["booking_id"], ["bookings.id"], name=op.f("fk_notification_log_booking_id_bookings")),
        sa.ForeignKeyConstraint(["recipient_user_id"], ["users.id"], name=op.f("fk_notification_log_recipient_user_id_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notification_log")),
        sa.UniqueConstraint(
            "event_type",
            "booking_id",
            "recipient_user_id",
            name="uq_notification_log_event_booking_recipient",
        ),
    )
    op.create_index(op.f("ix_notification_log_booking_id"), "notification_log", ["booking_id"], unique=False)
    op.create_index(op.f("ix_notification_log_recipient_user_id"), "notification_log", ["recipient_user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_notification_log_recipient_user_id"), table_name="notification_log")
    op.drop_index(op.f("ix_notification_log_booking_id"), table_name="notification_log")
    op.drop_table("notification_log")
