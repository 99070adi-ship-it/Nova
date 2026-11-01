import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

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
    # A fingerprint of the draft's content. Click-to-edit proposals are bound to it, so a proposal made against an
    # older state of the draft is refused instead of overwriting newer edits.
    revision: str

    model_config = {"from_attributes": True}

    @classmethod
    def from_version(cls, version) -> "StorefrontVersionOut":
        from app.services.storefront_revision import compute_revision

        return cls(
            id=version.id, status=version.status, generated_by=version.generated_by,
            published_at=version.published_at, theme=version.theme.tokens, revision=compute_revision(version),
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
    button_style: str | None = None


class DiffOut(BaseModel):
    changes: list[str]


class ChangePlanRequest(BaseModel):
    instruction: str


class ChangePlanOut(BaseModel):
    agent_run_id: uuid.UUID
    instruction: str
    plan: list[dict]
    applied: bool


class EditableElementsOut(BaseModel):
    elements: list[dict]
    section_types: list[dict]
    fonts: dict[str, str]


class ElementEditProposeIn(BaseModel):
    draft_id: uuid.UUID
    revision: str = Field(min_length=8, max_length=64)  # the draft revision the preview was showing when the element was clicked
    section_id: uuid.UUID | None = None  # null only for the theme
    element: str = Field(min_length=3, max_length=60)
    instruction: str = Field(min_length=2, max_length=600)


class ElementChangeOut(BaseModel):
    path: str
    label: str
    current: Any
    proposed: Any


class ElementEditProposalOut(BaseModel):
    proposal_id: uuid.UUID
    draft_id: uuid.UUID
    revision: str
    section_id: uuid.UUID | None
    element: str
    element_label: str
    summary: str
    reasoning: str
    changes: list[ElementChangeOut]
    warnings: list[str] = []
    state: str = "proposed"  # proposed | applied | discarded


class ElementEditApplyIn(BaseModel):
    revision: str = Field(min_length=8, max_length=64)
