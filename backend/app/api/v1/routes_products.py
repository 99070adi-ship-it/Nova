import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_any_role
from app.db.session import get_db
from app.schemas.product import GenerateLifestyleImage, ProductCreate, ProductImageOut, ProductOut, ProductUpdate
from app.services import image_service, product_service

router = APIRouter()


@router.get("", response_model=list[ProductOut])
async def list_products(
    ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> list[ProductOut]:
    products = await product_service.list_products(db, ctx.org_id)
    return [ProductOut.model_validate(p) for p in products]


@router.get("/{product_id}", response_model=ProductOut)
async def get_product(
    product_id: uuid.UUID, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> ProductOut:
    product = await product_service.get_product_or_404(db, ctx.org_id, product_id)
    return ProductOut.model_validate(product)


@router.post("", response_model=ProductOut, status_code=201)
async def create_product(
    payload: ProductCreate, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> ProductOut:
    product = await product_service.create_product(db, ctx.org_id, payload)
    return ProductOut.model_validate(product)


@router.patch("/{product_id}", response_model=ProductOut)
async def update_product(
    product_id: uuid.UUID, payload: ProductUpdate, ctx: AuthContext = Depends(require_any_role),
    db: AsyncSession = Depends(get_db),
) -> ProductOut:
    product = await product_service.update_product(db, ctx.org_id, product_id, payload)
    return ProductOut.model_validate(product)


@router.get("/{product_id}/images", response_model=list[ProductImageOut])
async def list_images(
    product_id: uuid.UUID, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> list[ProductImageOut]:
    images = await image_service.list_images(db, ctx.org_id, product_id)
    return [ProductImageOut.model_validate(i) for i in images]


@router.post("/{product_id}/images/generate", response_model=ProductImageOut, status_code=201)
async def generate_lifestyle_image(
    product_id: uuid.UUID, payload: GenerateLifestyleImage, ctx: AuthContext = Depends(require_any_role),
    db: AsyncSession = Depends(get_db),
) -> ProductImageOut:
    image = await image_service.generate_lifestyle_image(db, ctx.org_id, product_id, environment=payload.environment, mood=payload.mood)
    return ProductImageOut.model_validate(image)
