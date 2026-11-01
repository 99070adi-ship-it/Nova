import asyncio
import io
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone

from PIL import Image, UnidentifiedImageError
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.studio_provider import StudioProviderError, build_studio_provider
from app.config import get_settings
from app.db.models import StudioImage, StudioImageKind
from app.errors import ForbiddenError, NotFoundError, RateLimitedError, UnavailableError, ValidationDomainError
from app.repositories import storefront_repo

# Style presets are honest prompt modifiers: FLUX has no style parameter, so a preset is words added to the prompt.
STYLES: dict[str, tuple[str, str]] = {
    "none": ("No preset", ""),
    "photo": ("Editorial photo", "editorial photography, natural light, sharp focus, high detail"),
    "studio": ("Product studio", "clean product photography, soft studio lighting, seamless backdrop"),
    "cinematic": ("Cinematic", "cinematic lighting, shallow depth of field, film still"),
    "illustration": ("Illustration", "polished digital illustration, clean shapes, rich colour"),
    "minimal": ("Minimal", "minimalist composition, generous negative space, muted palette"),
}

_ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
_MAX_EDGE = 1024
_MAX_PIXELS = 24_000_000
_burst: dict[uuid.UUID, deque] = defaultdict(deque)  # per-process; enough to blunt hammering, the daily cap is the real guard


def _start_of_utc_day() -> datetime:
    return datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


def _check_burst(user_id: uuid.UUID) -> None:
    s, now, q = get_settings(), time.monotonic(), _burst[user_id]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= s.studio_burst_per_minute:
        raise RateLimitedError("You're going a little fast. Wait a moment and try again.")
    q.append(now)


async def used_today(db: AsyncSession, user_id: uuid.UUID) -> int:
    q = select(func.count()).select_from(StudioImage).where(
        StudioImage.user_id == user_id,
        StudioImage.kind.in_([StudioImageKind.generated, StudioImageKind.edited]),
        StudioImage.created_at >= _start_of_utc_day(),
    )
    return (await db.execute(q)).scalar_one()


async def _is_demo(db: AsyncSession, org_id: uuid.UUID) -> bool:
    org = await storefront_repo.get_org_by_id(db, org_id)
    return bool(org and org.is_demo)


async def _require_real_workspace(db: AsyncSession, org_id: uuid.UUID) -> None:
    """The demo workspace never reaches a paid/limited provider: a visitor could otherwise spend the whole free allowance."""
    if await _is_demo(db, org_id):
        raise ForbiddenError("Photo Studio runs real AI, so it isn't available in the demo workspace. Create an account to use it.")


async def status(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    s = get_settings()
    configured = build_studio_provider() is not None
    demo = await _is_demo(db, org_id)
    gen_note = None if configured and not demo else ("Not available in the demo workspace." if demo else "Image generation isn't configured on this server yet.")
    cap = lambda: {"available": configured and not demo, "note": gen_note}  # noqa: E731
    return {
        "configured": configured, "demo_workspace": demo, "used_today": await used_today(db, user_id), "daily_limit": s.studio_daily_limit,
        "max_upload_mb": s.studio_max_upload_bytes // (1024 * 1024),
        "styles": [{"key": k, "label": v[0]} for k, v in STYLES.items()],
        "generate": cap(), "edit": cap(),
        "enhance": {"available": False, "note": "Coming soon. No enhancement model is connected yet, so NOVA doesn't offer it."},
    }


def _clean_prompt(prompt: str) -> str:
    p = " ".join(prompt.split())
    if len(p) < 3:
        raise ValidationDomainError("Describe what you want in at least a few words.")
    if len(p) > 500:
        raise ValidationDomainError("Keep the description under 500 characters.")
    return p


async def _guard(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, units: int):
    await _require_real_workspace(db, org_id)
    provider = build_studio_provider()
    if provider is None:
        raise UnavailableError("Image generation isn't configured on this server yet.")
    s = get_settings()
    used = await used_today(db, user_id)
    if used + units > s.studio_daily_limit:
        raise RateLimitedError(
            f"That would pass your daily limit of {s.studio_daily_limit} images ({used} used today). It resets at 00:00 UTC."
        )
    _check_burst(user_id)
    return provider


async def generate(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, *, prompt: str, style: str, count: int) -> dict:
    prompt = _clean_prompt(prompt)
    if style not in STYLES:
        raise ValidationDomainError("Unknown style preset.")
    provider = await _guard(db, org_id, user_id, count)
    suffix = STYLES[style][1]
    full = f"{prompt}, {suffix}" if suffix else prompt

    results = await asyncio.gather(*[provider.generate(full) for _ in range(count)], return_exceptions=True)
    ok = [r for r in results if not isinstance(r, BaseException)]
    errors = [r for r in results if isinstance(r, StudioProviderError)]
    for r in results:
        if isinstance(r, BaseException) and not isinstance(r, StudioProviderError):
            raise r
    if not ok:  # nothing was produced: nothing is recorded or counted
        raise UnavailableError(errors[0].user_message)

    rows = []
    for r in ok:
        w, h = _dimensions(r.data)
        row = StudioImage(
            org_id=org_id, user_id=user_id, kind=StudioImageKind.generated, prompt=prompt, style=style, provider=r.provider,
            model=r.model, mime_type=r.mime, width=w, height=h, data=r.data,
        )
        db.add(row)
        rows.append(row)
    await db.commit()
    failed = count - len(ok)
    return {"images": rows, "failed": failed, "message": f"{failed} of {count} images could not be produced." if failed else None}


def _dimensions(data: bytes) -> tuple[int | None, int | None]:
    try:
        with Image.open(io.BytesIO(data)) as im:
            return im.size
    except Exception:
        return None, None


def _prepare_upload(raw: bytes) -> tuple[str, bytes, int, int]:
    """Validates by actually decoding (not by trusting the filename or Content-Type) and normalises for the model:
    RGB JPEG, longest edge <= 1024, sides rounded to multiples of 16. Returns (original mime, normalised bytes, w, h)."""
    s = get_settings()
    if not raw:
        raise ValidationDomainError("That file is empty.")
    if len(raw) > s.studio_max_upload_bytes:
        raise ValidationDomainError(f"That image is too large. The limit is {s.studio_max_upload_bytes // (1024 * 1024)} MB.")
    try:
        with Image.open(io.BytesIO(raw)) as im:
            fmt = im.format
            if fmt not in _ALLOWED_FORMATS:
                raise ValidationDomainError("Unsupported image type. Use a JPEG, PNG or WebP image.")
            if im.width * im.height > _MAX_PIXELS:
                raise ValidationDomainError("That image has too many pixels. Please use a smaller image.")
            im.load()
            rgb = im.convert("RGB")
    except ValidationDomainError:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ValidationDomainError("That file isn't a readable image.") from None
    scale = min(1.0, _MAX_EDGE / max(rgb.size))
    w = max(256, round(rgb.width * scale / 16) * 16)
    h = max(256, round(rgb.height * scale / 16) * 16)
    rgb = rgb.resize((min(w, _MAX_EDGE), min(h, _MAX_EDGE)), Image.LANCZOS)
    out = io.BytesIO()
    rgb.save(out, "JPEG", quality=92)
    return {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}[fmt], out.getvalue(), rgb.width, rgb.height


async def edit(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, *, prompt: str, raw: bytes) -> dict:
    prompt = _clean_prompt(prompt)
    original_mime, normalised, w, h = _prepare_upload(raw)
    provider = await _guard(db, org_id, user_id, 1)
    try:
        result = await provider.edit(prompt, normalised, w, h)
    except StudioProviderError as e:
        raise UnavailableError(e.user_message) from None

    ow, oh = _dimensions(raw)
    original = StudioImage(
        org_id=org_id, user_id=user_id, kind=StudioImageKind.upload, mime_type=original_mime, width=ow, height=oh, data=raw,
    )
    db.add(original)
    await db.flush()
    rw, rh = _dimensions(result.data)
    edited = StudioImage(
        org_id=org_id, user_id=user_id, kind=StudioImageKind.edited, prompt=prompt, provider=result.provider, model=result.model,
        mime_type=result.mime, width=rw, height=rh, data=result.data, source_image_id=original.id,
    )
    db.add(edited)
    await db.commit()
    return {"original": original, "edited": edited}


async def history(db: AsyncSession, org_id: uuid.UUID, *, limit: int = 60) -> list[StudioImage]:
    q = (
        select(StudioImage)
        .where(StudioImage.org_id == org_id, StudioImage.kind != StudioImageKind.upload)
        .order_by(StudioImage.created_at.desc())
        .limit(limit)
    )
    return list((await db.execute(q)).scalars())


async def get_image(db: AsyncSession, org_id: uuid.UUID, image_id: uuid.UUID) -> StudioImage:
    row = (await db.execute(select(StudioImage).where(StudioImage.id == image_id, StudioImage.org_id == org_id))).scalar_one_or_none()
    if row is None:  # same answer for "doesn't exist" and "belongs to someone else"
        raise NotFoundError("Image not found")
    return row


async def delete_image(db: AsyncSession, org_id: uuid.UUID, image_id: uuid.UUID) -> None:
    row = await get_image(db, org_id, image_id)
    source_id = row.source_image_id
    await db.execute(delete(StudioImage).where(StudioImage.id == row.id))
    if source_id is not None:
        still_used = (await db.execute(select(func.count()).select_from(StudioImage).where(StudioImage.source_image_id == source_id))).scalar_one()
        if not still_used:  # an original with no remaining result is just stored clutter
            await db.execute(delete(StudioImage).where(StudioImage.id == source_id, StudioImage.org_id == org_id))
    await db.commit()
