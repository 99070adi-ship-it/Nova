import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.factory import build_image_provider
from app.db.models import ProductImage
from app.errors import NotFoundError, ValidationDomainError
from app.repositories import product_repo


async def list_images(db: AsyncSession, org_id: uuid.UUID, product_id: uuid.UUID) -> list[ProductImage]:
    product = await product_repo.get_product(db, org_id, product_id)
    if product is None:
        raise NotFoundError("Product not found")
    return await product_repo.list_images(db, product.id)


async def generate_lifestyle_image(
    db: AsyncSession, org_id: uuid.UUID, product_id: uuid.UUID, *, environment: str | None, mood: str | None
) -> ProductImage:
    """Runs off the product's canonical image — never overwrites it, only ever adds a new
    `role=generated` row pointing back at it (ARCHITECTURE.md "AI image system")."""

    product = await product_repo.get_product(db, org_id, product_id)
    if product is None:
        raise NotFoundError("Product not found")
    canonical = await product_repo.get_canonical_image(db, product.id)
    if canonical is None:
        raise ValidationDomainError("Product has no canonical image to generate a lifestyle image from")

    provider = build_image_provider()
    generated = await provider.generate_image(
        kind="lifestyle", source_image_url=canonical.url, environment=environment, model=None, mood=mood, prompt_hint=None
    )
    image = await product_repo.create_generated_image(
        db, product.id, url=generated.url, provider=generated.provider, model=generated.model,
        prompt_metadata=generated.prompt_metadata, environment=environment, mood=mood, source_image_id=canonical.id,
    )
    await db.commit()
    return image
