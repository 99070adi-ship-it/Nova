import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=500)
    style: str = Field(default="none", max_length=40)
    count: int = Field(default=1, ge=1, le=4)


class StudioImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    prompt: str | None
    style: str | None
    model: str | None
    width: int | None
    height: int | None
    source_image_id: uuid.UUID | None
    created_at: datetime


class GenerateResult(BaseModel):
    images: list[StudioImageOut]
    failed: int = 0
    message: str | None = None  # set when only some of the requested images could be produced


class EditResult(BaseModel):
    original: StudioImageOut
    edited: StudioImageOut


class StudioCapability(BaseModel):
    available: bool
    note: str | None = None


class StudioStatus(BaseModel):
    configured: bool
    demo_workspace: bool
    used_today: int
    daily_limit: int
    max_upload_mb: int
    styles: list[dict]
    generate: StudioCapability
    edit: StudioCapability
    enhance: StudioCapability
