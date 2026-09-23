"""Minimal P1 bootstrap seed: one organization + one owner user, just enough to exercise the
auth flow end to end before the full VELORA demo dataset exists (that's `scripts/seed.py`, added
in P10). Not idempotent — run once against a fresh database, same convention the full seed will
follow.
"""

import asyncio

from app.core.security import hash_password
from app.db.models import Organization, User, UserRole
from app.db.session import AsyncSessionLocal


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        org = Organization(name="Velora", slug="velora")
        db.add(org)
        await db.flush()

        owner = User(
            org_id=org.id,
            email="owner@velora.demo",
            password_hash=hash_password("changeme123"),
            full_name="Owner",
            role=UserRole.owner,
        )
        db.add(owner)
        await db.commit()
        print(f"Seeded org '{org.slug}' — login as owner@velora.demo / changeme123")


if __name__ == "__main__":
    asyncio.run(seed())
