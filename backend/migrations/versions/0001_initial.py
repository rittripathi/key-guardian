"""initial schema

Revision ID: 0001
Revises:
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "api_keys",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("alias", sa.String(64), nullable=False),
        sa.Column("label", sa.String(120), server_default=""),
        sa.Column("provider", sa.String(32), server_default="openai"),
        sa.Column("base_url", sa.String(255), server_default=""),
        sa.Column("secret_ciphertext", sa.Text(), nullable=False),
        sa.Column("secret_last4", sa.String(8), server_default=""),
        sa.Column("passphrase_hash", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "alias", name="uq_api_keys_user_alias"),
    )
    op.create_index("ix_api_keys_alias", "api_keys", ["alias"])
    op.create_index("ix_api_keys_user_id", "api_keys", ["user_id"])

    op.create_table(
        "key_limits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("api_key_id", sa.Integer(), sa.ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("rate_limit", sa.Integer(), server_default="0"),
        sa.Column("rate_window_seconds", sa.Integer(), server_default="60"),
        sa.Column("rate_mode", sa.String(16), server_default="block"),
        sa.Column("spend_cap_usd", sa.Float(), server_default="0"),
        sa.Column("spend_mode", sa.String(16), server_default="block"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_key_limits_api_key_id", "key_limits", ["api_key_id"])

    op.create_table(
        "key_usage",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("api_key_id", sa.Integer(), sa.ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False),
        sa.Column("path", sa.String(255), server_default=""),
        sa.Column("model", sa.String(120), server_default=""),
        sa.Column("status_code", sa.Integer(), server_default="0"),
        sa.Column("prompt_tokens", sa.Integer(), server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), server_default="0"),
        sa.Column("cost_usd", sa.Float(), server_default="0"),
        sa.Column("latency_ms", sa.Integer(), server_default="0"),
        sa.Column("is_test", sa.Boolean(), server_default=sa.false()),
        sa.Column("client_ip", sa.String(64), server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_key_usage_key_created", "key_usage", ["api_key_id", "created_at"])

    op.create_table(
        "alerts",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("api_key_id", sa.Integer(), sa.ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(48), nullable=False),
        sa.Column("severity", sa.String(16), server_default="warning"),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("read", sa.Boolean(), server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_alerts_user_created", "alerts", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_table("alerts")
    op.drop_table("key_usage")
    op.drop_table("key_limits")
    op.drop_table("api_keys")
    op.drop_table("users")
