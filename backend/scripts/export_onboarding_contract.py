"""Regenerates contracts/onboarding-steps.json from the backend's canonical STEP_DEFINITIONS.

Run from backend/:  python scripts/export_onboarding_contract.py
Backend tests fail when the committed file is stale; admin tests fail when a step has no lesson."""

import json
from pathlib import Path

from app.services.onboarding_service import contract_snapshot

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "contracts" / "onboarding-steps.json"

if __name__ == "__main__":
    CONTRACT_PATH.write_text(json.dumps(contract_snapshot(), indent=2) + "\n")
    print(f"wrote {CONTRACT_PATH}")
