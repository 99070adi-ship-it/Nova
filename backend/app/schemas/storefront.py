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
