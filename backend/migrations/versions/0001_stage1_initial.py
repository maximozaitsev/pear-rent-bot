"""stage 1 initial schema

Revision ID: 0001_stage1_initial
Revises:
Create Date: 2026-11-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_stage1_initial"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"
    if is_pg:
        op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("telegram_id", sa.BigInteger(), nullable=False),
        sa.Column("username", sa.String(length=255), nullable=True),
        sa.Column("first_name", sa.String(length=255), nullable=True),
        sa.Column("last_name", sa.String(length=255), nullable=True),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("telegram_id", name=op.f("uq_users_telegram_id")),
    )
    op.create_index(op.f("ix_users_telegram_id"), "users", ["telegram_id"], unique=False)
    op.create_index("ix_users_role_is_active", "users", ["role", "is_active"], unique=False)

    op.create_table(
        "chairs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_chairs")),
    )

    op.create_table(
        "weekly_schedule",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("weekday", sa.SmallInteger(), nullable=False),
        sa.Column("is_open", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("open_time", sa.Time(), nullable=True),
        sa.Column("close_time", sa.Time(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("weekday >= 0 AND weekday <= 6", name="weekday_range"),
        sa.CheckConstraint(
            "(is_open = false) OR (open_time IS NOT NULL AND close_time IS NOT NULL AND open_time < close_time)",
            name="open_hours_valid",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_weekly_schedule")),
        sa.UniqueConstraint("weekday", name=op.f("uq_weekly_schedule_weekday")),
    )

    op.create_table(
        "date_schedule_overrides",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("is_open", sa.Boolean(), nullable=False),
        sa.Column("open_time", sa.Time(), nullable=True),
        sa.Column("close_time", sa.Time(), nullable=True),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "(is_open = false) OR (open_time IS NOT NULL AND close_time IS NOT NULL AND open_time < close_time)",
            name="open_hours_valid",
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name=op.f("fk_date_schedule_overrides_created_by_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_date_schedule_overrides")),
        sa.UniqueConstraint("date", name=op.f("uq_date_schedule_overrides_date")),
    )

    op.create_table(
        "invitations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("used_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name=op.f("fk_invitations_created_by_users")),
        sa.ForeignKeyConstraint(["used_by"], ["users.id"], name=op.f("fk_invitations_used_by_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_invitations")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_invitations_token_hash")),
    )

    op.create_table(
        "bookings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("chair_id", sa.Uuid(), nullable=False),
        sa.Column("renter_id", sa.Uuid(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("booking_type", sa.String(length=20), nullable=False),
        sa.Column("duration_hours", sa.SmallInteger(), nullable=False),
        sa.Column("price_amount", sa.Integer(), nullable=False),
        sa.Column("currency", sa.CHAR(length=3), nullable=False, server_default="BYN"),
        sa.Column("payment_status", sa.String(length=20), nullable=False, server_default="unpaid"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("cancelled_by", sa.Uuid(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancellation_reason", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("ends_at > starts_at", name="ends_after_start"),
        sa.CheckConstraint("duration_hours >= 1", name="duration_positive"),
        sa.CheckConstraint("price_amount >= 0", name="price_non_negative"),
        sa.ForeignKeyConstraint(["cancelled_by"], ["users.id"], name=op.f("fk_bookings_cancelled_by_users")),
        sa.ForeignKeyConstraint(["chair_id"], ["chairs.id"], name=op.f("fk_bookings_chair_id_chairs")),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name=op.f("fk_bookings_created_by_users")),
        sa.ForeignKeyConstraint(["renter_id"], ["users.id"], name=op.f("fk_bookings_renter_id_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bookings")),
    )
    op.create_index("ix_bookings_chair_starts_ends", "bookings", ["chair_id", "starts_at", "ends_at"], unique=False)
    op.create_index("ix_bookings_renter_starts", "bookings", ["renter_id", "starts_at"], unique=False)
    op.create_index("ix_bookings_status_starts", "bookings", ["status", "starts_at"], unique=False)
    op.create_index("ix_bookings_payment_status_starts", "bookings", ["payment_status", "starts_at"], unique=False)

    if is_pg:
        op.execute(
            """
            ALTER TABLE bookings
            ADD CONSTRAINT ex_bookings_no_overlap
            EXCLUDE USING gist (
                chair_id WITH =,
                tstzrange(starts_at, ends_at, '[)') WITH &&
            )
            WHERE (status = 'active')
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"
    if is_pg:
        op.execute("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS ex_bookings_no_overlap")
    op.drop_index("ix_bookings_payment_status_starts", table_name="bookings")
    op.drop_index("ix_bookings_status_starts", table_name="bookings")
    op.drop_index("ix_bookings_renter_starts", table_name="bookings")
    op.drop_index("ix_bookings_chair_starts_ends", table_name="bookings")
    op.drop_table("bookings")
    op.drop_table("invitations")
    op.drop_table("date_schedule_overrides")
    op.drop_table("weekly_schedule")
    op.drop_table("chairs")
    op.drop_index("ix_users_role_is_active", table_name="users")
    op.drop_index(op.f("ix_users_telegram_id"), table_name="users")
    op.drop_table("users")
