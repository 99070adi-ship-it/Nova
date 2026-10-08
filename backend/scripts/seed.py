"""CLI entrypoint for the VELORA demo dataset — the actual seeding logic lives in
app.services.demo_service (shared with the dev-only demo-reset API endpoint, ARCHITECTURE.md
Checkpoint 11). Not idempotent — run once against a fresh database, or use the demo-reset
endpoint instead, which wipes first."""

import asyncio

from app.services.demo_service import seed_velora_demo


async def _main() -> None:
    summary = await seed_velora_demo()
    print(
        f"Seeded org '{summary['org_slug']}' — {summary['products']} products across "
        f"{summary['collections']} collections, {summary['customers']} customers."
    )
    print(f"Login as {summary['login_email']} / {summary['login_password']}")
    print(f"Seeded {summary['product_drafts']} product drafts (1 fully specified, 2 partial) awaiting owner review in Create My Store.")


if __name__ == "__main__":
    asyncio.run(_main())
