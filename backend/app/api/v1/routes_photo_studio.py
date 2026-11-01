import uuid

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.deps import AuthContext, require_any_role
from app.db.session import get_db
from app.errors import ValidationDomainError
from app.schemas.photo_studio import EditResult, GenerateRequest, GenerateResult, StudioImageOut, StudioStatus
from app.services import photo_studio_service as svc

router = APIRouter()


@router.get("/status", response_model=StudioStatus)
async def studio_status(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> dict:
    return await svc.status(db, ctx.org_id, ctx.user_id)


@router.post("/generate", response_model=GenerateResult)
async def generate(payload: GenerateRequest, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> dict:
    return await svc.generate(db, ctx.org_id, ctx.user_id, prompt=payload.prompt, style=payload.style, count=payload.count)


@router.post("/edit", response_model=EditResult)
async def edit(
    prompt: str = Form(...),
    image: UploadFile = File(...),
    ctx: AuthContext = Depends(require_any_role),
    db: AsyncSession = Depends(get_db),
) -> dict:
    limit = get_settings().studio_max_upload_bytes
    raw = await image.read(limit + 1)  # never buffer more than the limit
    if len(raw) > limit:
        raise ValidationDomainError(f"That image is too large. The limit is {limit // (1024 * 1024)} MB.")
    return await svc.edit(db, ctx.org_id, ctx.user_id, prompt=prompt, raw=raw)


@router.get("/history", response_model=list[StudioImageOut])
async def history(ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)):
    return await svc.history(db, ctx.org_id)


@router.get("/images/{image_id}")
async def image_bytes(
    image_id: uuid.UUID, download: bool = False, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> Response:
    row = await svc.get_image(db, ctx.org_id, image_id)
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}.get(row.mime_type, "img")
    disposition = f'attachment; filename="nova-{row.id}.{ext}"' if download else "inline"
    return Response(
        content=row.data, media_type=row.mime_type,
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Disposition": disposition},
    )


@router.delete("/images/{image_id}", status_code=204)
async def delete_image(image_id: uuid.UUID, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)) -> None:
    await svc.delete_image(db, ctx.org_id, image_id)
