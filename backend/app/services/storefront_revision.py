import hashlib
import json


def compute_revision(version) -> str:
    """A short fingerprint of everything editable in a storefront version: its pages, sections (ids, order, type,
    configuration) and theme. Any edit, by anyone, through any path, changes it, so it works as an optimistic
    concurrency token without a schema change."""
    payload = {
        "pages": [
            {
                "id": str(p.id), "slug": p.slug, "title": p.title, "order": p.order,
                "sections": [
                    {"id": str(s.id), "type": s.type, "order": s.order, "configuration": s.configuration}
                    for s in sorted(p.sections, key=lambda s: (s.order, str(s.id)))
                ],
            }
            for p in sorted(version.pages, key=lambda p: (p.order, str(p.id)))
        ],
        "theme": version.theme.tokens if version.theme is not None else {},
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:20]
