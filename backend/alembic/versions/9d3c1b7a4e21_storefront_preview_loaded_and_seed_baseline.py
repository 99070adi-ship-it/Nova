"""storefront versions: preview_loaded_at + is_seed_baseline

Revision ID: 9d3c1b7a4e21
Revises: f4ac7eee2dba
Create Date: 2026-10-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9d3c1b7a4e21'
down_revision: Union[str, None] = 'f4ac7eee2dba'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable timestamp: the onboarding `preview` step is complete only once a draft's preview has
    # genuinely loaded in the storefront app. Existing rows have never recorded that event.
    op.add_column('storefront_versions', sa.Column('preview_loaded_at', sa.DateTime(timezone=True), nullable=True))
    # Marks the seeded demo baseline (a real live version) so it never satisfies the onboarding
    # `publish` step. Every existing row backfills to false.
    op.add_column(
        'storefront_versions',
        sa.Column('is_seed_baseline', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column('storefront_versions', 'is_seed_baseline')
    op.drop_column('storefront_versions', 'preview_loaded_at')
