import uuid
from datetime import datetime

from pydantic import BaseModel

from app.db.models import GeneratedBy, StorefrontVersionStatus


class SectionOut(BaseModel):
    id: uuid.UUID
    type: str
    order: int
    configuration: dict

    model_config = {"from_attributes": True}


class PageOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    order: int
    sections: list[SectionOut]

    model_config = {"from_attributes": True}


class StorefrontVersionOut(BaseModel):
    id: uuid.UUID
    status: StorefrontVersionStatus
    generated_by: GeneratedBy
    published_at: datetime | None
    theme: dict
    pages: list[PageOut]

    model_config = {"from_attributes": True}

    @classmethod
    def from_version(cls, version) -> "StorefrontVersionOut":
        return cls(
            id=version.id, status=version.status, generated_by=version.generated_by,
            published_at=version.published_at, theme=version.theme.tokens,
            pages=[PageOut.model_validate(p) for p in sorted(version.pages, key=lambda p: p.order)],
        )


class SectionCreate(BaseModel):
    page_id: uuid.UUID
    type: str
    order: int = 0
    configuration: dict = {}


class SectionUpdate(BaseModel):
    order: int | None = None
    configuration: dict | None = None


class ThemeUpdate(BaseModel):
    primary_color: str | None = None
    background_color: str | None = None
    font_family: str | None = None
    border_radius: str | None = None


class DiffOut(BaseModel):
    changes: list[str]


class ChangePlanRequest(BaseModel):
    instruction: str


class ChangePlanOut(BaseModel):
    agent_run_id: uuid.UUID
    instruction: str
    plan: list[dict]
    applied: bool
