"""Photo Studio image providers. Real work goes to Cloudflare Workers AI (FLUX); the call shapes below were verified live:
  generate: POST .../ai/run/<gen model>  JSON {prompt, steps<=8}          -> {"result": {"image": "<base64>"}, "success": true}
  edit:     POST .../ai/run/<edit model> multipart: prompt, width, height, file field `input_image_0`
            (a field named `image` is accepted but silently IGNORED by the model: never use it).
The provider holds the secret server-side and never echoes it, or the provider's raw error text, to a caller."""

import base64
import hashlib
import struct
import zlib
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.config import get_settings


class StudioProviderError(Exception):
    """Carries a message that is safe to show the user. Never contains credentials or raw provider output."""

    def __init__(self, user_message: str, *, kind: str = "failed"):
        super().__init__(user_message)
        self.user_message = user_message
        self.kind = kind  # failed | flagged | busy | timeout


@dataclass(frozen=True)
class StudioResult:
    data: bytes
    mime: str
    provider: str
    model: str


class StudioProvider(Protocol):
    async def generate(self, prompt: str) -> StudioResult: ...
    async def edit(self, prompt: str, image: bytes, width: int, height: int) -> StudioResult: ...


def _sniff_mime(data: bytes) -> str:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise StudioProviderError("The image service returned something that is not an image. Please try again.")


class CloudflareStudioProvider:
    name = "cloudflare"

    def __init__(self, *, account_id: str, api_token: str, generate_model: str, edit_model: str, timeout: float):
        self._base = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/"
        self._token = api_token
        self._gen_model = generate_model
        self._edit_model = edit_model
        self._timeout = timeout

    async def _call(self, model: str, **kwargs) -> bytes:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(self._base + model, headers={"Authorization": f"Bearer {self._token}"}, **kwargs)
        except httpx.TimeoutException:
            raise StudioProviderError("The image service took too long to respond. Please try again.", kind="timeout") from None
        except httpx.HTTPError:
            raise StudioProviderError("Could not reach the image service. Please try again in a moment.") from None

        if resp.status_code == 429:
            raise StudioProviderError("The image service is busy or its free allowance is used up for now. Try again later.", kind="busy")
        if resp.status_code != 200:
            if "flagged" in resp.text.lower():
                raise StudioProviderError(
                    "The image service's safety filter blocked this request. Try rephrasing the prompt or using a different image.",
                    kind="flagged",
                )
            raise StudioProviderError("The image service could not complete this request. Please try again.")
        try:
            body = resp.json()
            if not body.get("success"):
                raise ValueError
            return base64.b64decode(body["result"]["image"])
        except Exception:
            raise StudioProviderError("The image service returned an unexpected response. Please try again.") from None

    async def generate(self, prompt: str) -> StudioResult:
        data = await self._call(self._gen_model, json={"prompt": prompt, "steps": 4})
        return StudioResult(data, _sniff_mime(data), self.name, self._gen_model)

    async def edit(self, prompt: str, image: bytes, width: int, height: int) -> StudioResult:
        data = await self._call(
            self._edit_model,
            data={"prompt": prompt, "width": str(width), "height": str(height)},
            files={"input_image_0": ("image.jpg", image, "image/jpeg")},
        )
        return StudioResult(data, _sniff_mime(data), self.name, self._edit_model)


def _solid_png(rgb: tuple[int, int, int], size: int = 64) -> bytes:
    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    row = b"\x00" + bytes(rgb) * size
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(row * size))
        + chunk(b"IEND", b"")
    )


class FakeStudioProvider:
    """Local development and tests only (build_studio_provider refuses it outside ENV=local). A flat colour derived from the prompt:
    it is a placeholder for wiring checks, never a result presented to users in production."""

    name = "fake"

    async def generate(self, prompt: str) -> StudioResult:
        h = hashlib.sha256(prompt.encode()).digest()
        return StudioResult(_solid_png((h[0], h[1], h[2])), "image/png", self.name, "fake-generate")

    async def edit(self, prompt: str, image: bytes, width: int, height: int) -> StudioResult:
        h = hashlib.sha256(prompt.encode()).digest()
        return StudioResult(_solid_png((h[3], h[4], h[5])), "image/png", self.name, "fake-edit")


def build_studio_provider() -> StudioProvider | None:
    """None = Photo Studio is not configured (the API reports that honestly instead of faking a result)."""
    s = get_settings()
    if s.studio_provider == "fake":
        return FakeStudioProvider() if s.env == "local" else None
    if not (s.cloudflare_account_id and s.cloudflare_api_token):
        return None
    return CloudflareStudioProvider(
        account_id=s.cloudflare_account_id,
        api_token=s.cloudflare_api_token,
        generate_model=s.cloudflare_image_model,
        edit_model=s.cloudflare_edit_model,
        timeout=s.studio_timeout_seconds,
    )
