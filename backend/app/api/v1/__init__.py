from fastapi import APIRouter

from app.api.v1.routes_activity import router as activity_router
from app.api.v1.routes_ai import router as ai_router
from app.api.v1.routes_analytics import router as analytics_router
from app.api.v1.routes_approvals import router as approvals_router
from app.api.v1.routes_auth import router as auth_router
from app.api.v1.routes_collections import router as collections_router
from app.api.v1.routes_customers import router as customers_router
from app.api.v1.routes_dev import router as dev_router
from app.api.v1.routes_inventory import router as inventory_router
from app.api.v1.routes_onboarding import router as onboarding_router
from app.api.v1.routes_orders import router as orders_router
from app.api.v1.routes_products import router as products_router
from app.api.v1.routes_promotions import router as promotions_router
from app.api.v1.routes_public import router as public_router
from app.api.v1.routes_store_creation import router as store_creation_router
from app.api.v1.routes_store_manager import router as store_manager_router
from app.api.v1.routes_storefront import router as storefront_router

api_router = APIRouter()
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(products_router, prefix="/products", tags=["products"])
api_router.include_router(collections_router, prefix="/collections", tags=["collections"])
api_router.include_router(inventory_router, prefix="/inventory", tags=["inventory"])
api_router.include_router(customers_router, prefix="/customers", tags=["customers"])
api_router.include_router(orders_router, prefix="/orders", tags=["orders"])
api_router.include_router(promotions_router, prefix="/promotions", tags=["promotions"])
api_router.include_router(store_creation_router, prefix="/store-creation", tags=["store-creation"])
api_router.include_router(onboarding_router, prefix="/onboarding", tags=["onboarding"])
api_router.include_router(storefront_router, prefix="/storefront", tags=["storefront"])
api_router.include_router(ai_router, prefix="/ai", tags=["ai"])
api_router.include_router(store_manager_router, prefix="/store-manager", tags=["store-manager"])
api_router.include_router(approvals_router, prefix="/approvals", tags=["approvals"])
api_router.include_router(activity_router, prefix="/activity", tags=["activity"])
api_router.include_router(analytics_router, prefix="/analytics", tags=["analytics"])
# Unauthenticated — consumed by the separate storefront/ app (anonymous browsing).
api_router.include_router(public_router, prefix="/public", tags=["public"])
# Dev-only — gated to settings.env == "local" inside the route itself; 404s everywhere else.
api_router.include_router(dev_router, prefix="/dev", tags=["dev"])
