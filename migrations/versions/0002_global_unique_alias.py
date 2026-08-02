"""make alias globally unique

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NOTE: if any environment already has two rows sharing the same alias
    # (possible under the old per-user constraint), rename one of them by
    # hand before running this migration or it will fail on the new
    # unique index below.
    op.drop_constraint("uq_api_keys_user_alias", "api_keys", type_="unique")
    op.drop_index("ix_api_keys_alias", table_name="api_keys")
    op.create_index("ix_api_keys_alias", "api_keys", ["alias"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_api_keys_alias", table_name="api_keys")
    op.create_index("ix_api_keys_alias", "api_keys", ["alias"], unique=False)
    op.create_unique_constraint(
        "uq_api_keys_user_alias", "api_keys", ["user_id", "alias"]
    )
