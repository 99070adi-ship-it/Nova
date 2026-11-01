"""photo studio images (generated / edited results and the originals they came from)

Revision ID: d8a52c1f7e03
Revises: c7d41a9e5b22
Create Date: 2026-11-02 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd8a52c1f7e03'
down_revision: Union[str, None] = 'c7d41a9e5b22'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    kind = postgresql.ENUM('generated', 'edited', 'upload', name='studio_image_kind', create_type=False)
    kind.create(op.get_bind(), checkfirst=True)
    op.create_table(
        'studio_images',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('org_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('kind', kind, nullable=False),
        sa.Column('prompt', sa.Text(), nullable=True),
        sa.Column('style', sa.String(length=40), nullable=True),
        sa.Column('provider', sa.String(length=40), nullable=True),
        sa.Column('model', sa.String(length=120), nullable=True),
        sa.Column('mime_type', sa.String(length=40), nullable=False),
        sa.Column('width', sa.Integer(), nullable=True),
        sa.Column('height', sa.Integer(), nullable=True),
        sa.Column('data', sa.LargeBinary(), nullable=False),
        sa.Column('source_image_id', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], name=op.f('fk_studio_images_org_id_organizations')),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_studio_images_user_id_users')),
        sa.ForeignKeyConstraint(['source_image_id'], ['studio_images.id'], ondelete='SET NULL', name=op.f('fk_studio_images_source_image_id_studio_images')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_studio_images')),
    )
    op.create_index(op.f('ix_studio_images_org_id'), 'studio_images', ['org_id'])
    op.create_index(op.f('ix_studio_images_user_id'), 'studio_images', ['user_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_studio_images_user_id'), table_name='studio_images')
    op.drop_index(op.f('ix_studio_images_org_id'), table_name='studio_images')
    op.drop_table('studio_images')
    sa.Enum(name='studio_image_kind').drop(op.get_bind(), checkfirst=True)
