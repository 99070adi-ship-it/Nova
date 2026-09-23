"""Canonical representation + payload hash. This is the mechanical proof that "what the human
approved" and "what the executor ran" are the same bytes — not a defense against a compromised
database, a testable invariant (ARCHITECTURE.md "Approval / proposal pipeline")."""

import hashlib
import json
from typing import Any


def canonicalize_arguments(arguments: dict[str, Any]) -> dict[str, Any]:
    """Normalizes types (e.g. enums/UUIDs to plain strings) and drops None values so the same
    logical arguments always canonicalize identically regardless of how they were constructed."""

    def _normalize(value: Any) -> Any:
        if value is None:
            return None
        if hasattr(value, "value") and isinstance(getattr(value, "value"), str):  # enums
            return value.value
        if not isinstance(value, (str, int, float, bool, dict, list)):
            return str(value)
        return value

    return {k: _normalize(v) for k, v in sorted(arguments.items()) if v is not None}


def compute_payload_hash(canonical_arguments: dict[str, Any]) -> str:
    canonical_json = json.dumps(canonical_arguments, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
