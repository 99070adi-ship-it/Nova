"""Regenerates contracts/editable-elements.json from the backend's editable-element registry.

Run from backend/:  python scripts/export_editable_elements.py
Backend tests fail when the committed file is stale; the storefront's tests fail when what it renders and tags for
click-to-edit differs from this file, so the registry, the renderer and the admin outline cannot drift apart."""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.services.storefront_registry import public_registry  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parents[2] / "contracts" / "editable-elements.json"

if __name__ == "__main__":
    OUT.write_text(json.dumps(public_registry(), indent=2, sort_keys=True) + "\n")
    print(f"wrote {OUT}")
