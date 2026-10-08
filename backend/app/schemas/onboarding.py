from enum import Enum

from pydantic import BaseModel


class OnboardingStepKey(str, Enum):
    brand = "brand"
    products = "products"
    catalog = "catalog"
    review = "review"
    collections = "collections"
    storefront = "storefront"
    preview = "preview"
    nl_edit = "nl_edit"
    publish = "publish"
    run_business = "run_business"


class OnboardingStepStatus(str, Enum):
    locked = "locked"
    available = "available"
    completed = "completed"


class OnboardingStepOut(BaseModel):
    key: OnboardingStepKey
    title: str
    status: OnboardingStepStatus


class OnboardingProgressOut(BaseModel):
    steps: list[OnboardingStepOut]
    current_step: OnboardingStepKey | None
    intro_video_seen: bool
