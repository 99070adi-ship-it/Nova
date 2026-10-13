"""product variant SKUs are unique per organization, not globally

Revision ID: b5e7a2c94f10
Revises: 9d3c1b7a4e21
Create Date: 2026-10-13 00:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b5e7a2c94f10'
down_revision: Union[str, None] = '9d3c1b7a4e21'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # `sku` was globally unique, so one tenant using a SKU blocked every other tenant from it (and
    # revealed that it existed). Denormalize org_id onto the variant so uniqueness can be enforced
    # per organization at the database level.
    op.add_column('product_variants', sa.Column('org_id', sa.Uuid(), nullable=True))
    op.execute(
        "UPDATE product_variants SET org_id = products.org_id FROM products WHERE products.id = product_variants.product_id"
    )
    op.alter_column('product_variants', 'org_id', nullable=False)
    op.create_foreign_key(
        'fk_product_variants_org_id_organizations', 'product_variants', 'organizations', ['org_id'], ['id']
    )
    op.create_index('ix_product_variants_org_id', 'product_variants', ['org_id'])
    op.drop_constraint('uq_product_variants_sku', 'product_variants', type_='unique')
    op.create_unique_constraint('uq_product_variants_org_id_sku', 'product_variants', ['org_id', 'sku'])


def downgrade() -> None:
    # Re-creating the global constraint fails if two organizations now share a SKU; that is the
    # honest outcome of undoing this change, not something to paper over.
    op.drop_constraint('uq_product_variants_org_id_sku', 'product_variants', type_='unique')
    op.create_unique_constraint('uq_product_variants_sku', 'product_variants', ['sku'])
    op.drop_index('ix_product_variants_org_id', table_name='product_variants')
    op.drop_constraint('fk_product_variants_org_id_organizations', 'product_variants', type_='foreignkey')
    op.drop_column('product_variants', 'org_id')
