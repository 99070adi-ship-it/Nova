"""The model's entire action surface (ARCHITECTURE.md "Tool system"). Every entry satisfies the
same contract regardless of whether it reads or mutates: typed schema, authorization requirement,
tenant context (never a schema field — always injected server-side from AuthContext), risk
classification, deterministic execution, audit event.

Tool schemas deliberately never include org_id/user_id — there is nothing for the model to forge."""

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field


class GetBrandProfileArgs(BaseModel):
    fields: list[str] | None = None


class GetStoreSummaryArgs(BaseModel):
    pass


class GetSalesMetricsArgs(BaseModel):
    days: int = Field(default=30, gt=0, le=365)


class GetLowStockProductsArgs(BaseModel):
    pass


class GetCustomerActivityArgs(BaseModel):
    inactive_days: int = Field(default=30, gt=0, le=365)


class UpdateProductContentArgs(BaseModel):
    product_id: str
    title: str | None = None
    description: str | None = None
    category: str | None = None
    seo_title: str | None = None
    seo_description: str | None = None


class PublishStorefrontArgs(BaseModel):
    pass


class DraftCampaignArgs(BaseModel):
    goal: str = Field(min_length=1, max_length=300)
    target_segment: str = Field(min_length=1, max_length=200)
    campaign_copy: str = Field(min_length=1, max_length=2000)


class CancelOrderArgs(BaseModel):
    order_id: str
    reason: str = Field(min_length=1, max_length=500)


class GetOrderDetailsArgs(BaseModel):
    order_id: str


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    args_model: type[BaseModel]
    is_mutating: bool
    risk_classification: Literal["low", "high"] | None  # None ⇒ read-only, executes inline
    auto_executable: bool = False  # only for a narrow allowlist of low-risk write tools


TOOL_REGISTRY: dict[str, ToolSpec] = {
    "get_brand_profile": ToolSpec(
        name="get_brand_profile",
        description="Read the org's brand profile (name, vibe, positioning, target customer, ...). Pass `fields` to limit which ones come back.",
        args_model=GetBrandProfileArgs,
        is_mutating=False,
        risk_classification=None,
    ),
    "get_store_summary": ToolSpec(
        name="get_store_summary",
        description="Get counts of products, customers, orders, and low-stock inventory for the org's store.",
        args_model=GetStoreSummaryArgs,
        is_mutating=False,
        risk_classification=None,
    ),
    "get_sales_metrics": ToolSpec(
        name="get_sales_metrics",
        description="Get revenue, order count, and top-selling products over the last N days.",
        args_model=GetSalesMetricsArgs,
        is_mutating=False,
        risk_classification=None,
    ),
    "get_low_stock_products": ToolSpec(
        name="get_low_stock_products",
        description="List products/variants at or below their low-stock threshold.",
        args_model=GetLowStockProductsArgs,
        is_mutating=False,
        risk_classification=None,
    ),
    "get_customer_activity": ToolSpec(
        name="get_customer_activity",
        description="List customers with their order counts and last-order date, flagging those inactive for N+ days.",
        args_model=GetCustomerActivityArgs,
        is_mutating=False,
        risk_classification=None,
    ),
    "update_product_content": ToolSpec(
        name="update_product_content",
        description="Propose updating a product's title/description/category/SEO fields. Never changes price, status, or inventory.",
        args_model=UpdateProductContentArgs,
        is_mutating=True,
        risk_classification="low",
        auto_executable=True,
    ),
    "publish_storefront": ToolSpec(
        name="publish_storefront",
        description="Propose publishing the current storefront draft as the live site.",
        args_model=PublishStorefrontArgs,
        is_mutating=True,
        risk_classification="high",
    ),
    "draft_campaign": ToolSpec(
        name="draft_campaign",
        description="Propose a marketing campaign draft (goal, target segment, copy). Never sends anything — drafting only.",
        args_model=DraftCampaignArgs,
        is_mutating=True,
        risk_classification="high",
    ),
    "cancel_order": ToolSpec(
        name="cancel_order",
        description="Propose cancelling an order.",
        args_model=CancelOrderArgs,
        is_mutating=True,
        risk_classification="high",
    ),
    "get_order_details": ToolSpec(
        name="get_order_details",
        description="Look up an order's status, payment status, and items by id.",
        args_model=GetOrderDetailsArgs,
        is_mutating=False,
        risk_classification=None,
    ),
}


def tool_schemas_for_model(tool_names: list[str]) -> list[dict]:
    """JSON-schema-shaped tool definitions handed to the provider, restricted to the subset a
    given AgentSpec is allowed to call."""

    return [
        {"name": spec.name, "description": spec.description, "parameters": spec.args_model.model_json_schema()}
        for name in tool_names
        if (spec := TOOL_REGISTRY.get(name)) is not None
    ]


class ToolValidationError(Exception):
    def __init__(self, tool_name: str, reason: str):
        super().__init__(f"Invalid arguments for tool '{tool_name}': {reason}")
        self.tool_name = tool_name
        self.reason = reason


def validate_tool_arguments(tool_name: str, raw_arguments: dict) -> BaseModel:
    spec = TOOL_REGISTRY.get(tool_name)
    if spec is None:
        raise ToolValidationError(tool_name, "unknown tool")
    try:
        return spec.args_model.model_validate(raw_arguments)
    except Exception as exc:  # pydantic ValidationError
        raise ToolValidationError(tool_name, str(exc)) from exc
