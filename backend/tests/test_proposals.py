from app.db.models import ProposalStatus
from app.db.session import AsyncSessionLocal
from app.errors import ConflictError, StaleProposalError
from app.repositories import proposal_repo
from app.schemas.product import ProductCreate, VariantIn
from app.services import product_service, proposal_service


async def _create_test_product(org_id):
    async with AsyncSessionLocal() as db:
        product = await product_service.create_product(
            db, org_id,
            ProductCreate(title="Widget", slug="widget", variants=[VariantIn(sku="WIDGET-1", price=9.99)]),
        )
        return product.id


async def test_update_product_content_proposal_full_lifecycle(seeded_owner):
    org_id = seeded_owner["org_id"]
    user_id = seeded_owner["user_id"]
    product_id = await _create_test_product(org_id)

    async with AsyncSessionLocal() as db:
        proposal = await proposal_service.create_proposal(
            db, org_id, tool_name="update_product_content",
            raw_arguments={"product_id": str(product_id), "title": "Deluxe Widget"},
            requesting_agent_run_id=None, requesting_user_id=user_id,
        )
        assert proposal.status == ProposalStatus.proposed
        assert proposal.risk_classification == "low"

    async with AsyncSessionLocal() as db:
        approved = await proposal_service.approve_and_execute_proposal(db, org_id, proposal.id, approving_user_id=user_id)
        assert approved.status == ProposalStatus.executed
        assert approved.execution_result["title"] == "Deluxe Widget"

    async with AsyncSessionLocal() as db:
        product = await product_service.get_product_or_404(db, org_id, product_id)
        assert product.title == "Deluxe Widget"


async def test_double_approve_is_rejected_by_state_machine(seeded_owner):
    org_id = seeded_owner["org_id"]
    user_id = seeded_owner["user_id"]
    product_id = await _create_test_product(org_id)

    async with AsyncSessionLocal() as db:
        proposal = await proposal_service.create_proposal(
            db, org_id, tool_name="update_product_content", raw_arguments={"product_id": str(product_id), "title": "First"},
            requesting_agent_run_id=None, requesting_user_id=user_id,
        )

    async with AsyncSessionLocal() as db:
        await proposal_service.approve_and_execute_proposal(db, org_id, proposal.id, approving_user_id=user_id)

    async with AsyncSessionLocal() as db:
        try:
            await proposal_service.approve_and_execute_proposal(db, org_id, proposal.id, approving_user_id=user_id)
            assert False, "second approval should have been rejected"
        except ConflictError:
            pass


async def test_reject_proposal(seeded_owner):
    org_id = seeded_owner["org_id"]
    user_id = seeded_owner["user_id"]
    product_id = await _create_test_product(org_id)

    async with AsyncSessionLocal() as db:
        proposal = await proposal_service.create_proposal(
            db, org_id, tool_name="update_product_content", raw_arguments={"product_id": str(product_id), "title": "Nope"},
            requesting_agent_run_id=None, requesting_user_id=user_id,
        )

    async with AsyncSessionLocal() as db:
        rejected = await proposal_service.reject_proposal(db, org_id, proposal.id, actor_id=user_id, reason="not needed")
        assert rejected.status == ProposalStatus.rejected
        assert rejected.rejection_reason == "not needed"

    # Product must be untouched.
    async with AsyncSessionLocal() as db:
        product = await product_service.get_product_or_404(db, org_id, product_id)
        assert product.title == "Widget"


async def test_publish_storefront_proposal_requires_existing_draft(seeded_owner):
    org_id = seeded_owner["org_id"]
    user_id = seeded_owner["user_id"]

    async with AsyncSessionLocal() as db:
        proposal = await proposal_service.create_proposal(
            db, org_id, tool_name="publish_storefront", raw_arguments={}, requesting_agent_run_id=None, requesting_user_id=user_id,
        )
        assert proposal.risk_classification == "high"

    async with AsyncSessionLocal() as db:
        # No draft exists yet for this fresh org — execution must fail closed as "stale", not
        # silently succeed or crash.
        try:
            await proposal_service.approve_and_execute_proposal(db, org_id, proposal.id, approving_user_id=user_id)
            assert False, "should have raised StaleProposalError"
        except StaleProposalError:
            pass

    async with AsyncSessionLocal() as db:
        refetched = await proposal_repo.get_proposal(db, org_id, proposal.id)
        assert refetched.status == ProposalStatus.stale
