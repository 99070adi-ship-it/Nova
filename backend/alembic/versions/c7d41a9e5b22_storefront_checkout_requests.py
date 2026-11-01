"""storefront checkout idempotency (one order per idempotency key per store)

Revision ID: c7d41a9e5b22
Revises: b5e7a2c94f10
Create Date: 2026-10-15 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c7d41a9e5b22'
down_revision: Union[str, None] = 'b5e7a2c94f10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'checkout_requests',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('org_id', sa.Uuid(), nullable=False),
        sa.Column('idempotency_key', sa.String(length=80), nullable=False),
        sa.Column('order_id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['org_id'], ['organizations.id']),
        sa.ForeignKeyConstraint(['order_id'], ['orders.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('org_id', 'idempotency_key', name='uq_checkout_requests_org_id_key'),
    )
    op.create_index('ix_checkout_requests_org_id', 'checkout_requests', ['org_id'])


def downgrade() -> None:
    op.drop_index('ix_checkout_requests_org_id', table_name='checkout_requests')
    op.drop_table('checkout_requests')
