"""organization is_demo flag

Revision ID: f4ac7eee2dba
Revises: 2c7b7b5de768
Create Date: 2026-10-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4ac7eee2dba'
down_revision: Union[str, None] = '2c7b7b5de768'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Unambiguous, DB-level tag for "this org is a demo workspace" (public one-click demo or the
    # dev-only /dev/demo-reset fixture) — deliberately NOT inferred from org slug/email string
    # matching, which a real signup's chosen org name could theoretically collide with. Every
    # existing row backfills to false via server_default; only the demo-seeding paths ever set it
    # true going forward.
    op.add_column('organizations', sa.Column('is_demo', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column('organizations', 'is_demo')
