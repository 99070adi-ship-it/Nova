"""Deterministic test/dev double for LLMProvider — makes AI-boundary behavior (schema validation,
permission checks, loop caps, the approval gate) testable without ever calling a real model. Also
the default AI_PROVIDER so the demo never depends on a live API key."""

import hashlib
import json

from app.ai.provider import (
    GeneratedImage,
    ImageProvider,
    ImageKind,
    LLMProvider,
    ProviderFinal,
    ProviderStepResult,
    ToolCallRequest,
    ToolResultMessage,
)
from app.ai.tools import TOOL_REGISTRY


class FakeLLMProvider(LLMProvider):
    def __init__(self, script: list[ProviderStepResult] | None = None):
        """`script`, if given, is played back one entry per `step()` call — this is how a test or
        a deterministic demo makes the fake provider request a specific tool call. With no
        script, `step()` immediately returns a final answer summarizing the context it was given,
        so any agent works out of the box without a live model."""

        self._script = list(script) if script is not None else None
        self._call_count = 0

    async def step(
        self, *, system_prompt: str, context: dict, messages: list[str],
        tool_results: list[ToolResultMessage], available_tools: list[dict],
    ) -> ProviderStepResult:
        self._call_count += 1
        if self._script is not None:
            if self._call_count - 1 < len(self._script):
                return self._script[self._call_count - 1]
            # Script exhausted without an explicit final step — stop rather than loop forever.
            return ProviderStepResult(final=ProviderFinal(text=""))

        if tool_results:
            guide_narration = _synthesize_guide_narration(tool_results)
            if guide_narration is not None:
                return ProviderStepResult(final=ProviderFinal(text=guide_narration))
            summary = "; ".join(f"{r.name} -> {r.content}" for r in tool_results)
            return ProviderStepResult(final=ProviderFinal(text=f"Based on {summary}."))

        # No tools offered at all + a "known_fields" context shape ⇒ a structured content-
        # generation call (e.g. the Product Agent), not a conversational turn. Synthesize
        # deterministic JSON from what's actually in context rather than inventing facts.
        if not available_tools and "known_fields" in context:
            return ProviderStepResult(final=ProviderFinal(text=json.dumps(_synthesize_product_content(context))))

        # No tools + an "instruction" context shape ⇒ the Storefront Agent asking for a Change
        # Plan. Synthesize deterministic, keyword-driven edits rather than a no-op.
        if not available_tools and "instruction" in context:
            return ProviderStepResult(final=ProviderFinal(text=json.dumps(_synthesize_change_plan(context))))

        # No tools + context.kind == "storefront_generation" ⇒ storefront_generation_service's
        # single structured call. Synthesize deterministic copy from the real brand/collections in
        # context, in the exact shape StorefrontGenerationPlan validates.
        if not available_tools and context.get("kind") == "storefront_generation":
            return ProviderStepResult(final=ProviderFinal(text=json.dumps(_synthesize_storefront_plan(context))))

        # A lesson-specific narration prompt (FirstProductLesson.tsx's demo/explain/complete
        # calls) — matched by message content, not context shape, since nova_guide's tool set
        # means any other fresh message would otherwise always fall through to the generic
        # get_onboarding_progress tool-call path below. Checked first so it takes precedence.
        last_message = messages[-1] if messages else ""
        lesson_narration = _synthesize_lesson_narration(last_message)
        if lesson_narration is not None:
            return ProviderStepResult(final=ProviderFinal(text=lesson_narration))

        # No tool results yet — call the first read-only tool this agent has access to, if any,
        # so an unscripted run still exercises a real tool round trip (call -> execution -> result
        # fed back -> final answer) rather than just echoing text. Not "smart" — a deterministic
        # double proving the mechanism works, same spirit as support-copilot's FakeLLMProvider.
        read_only_tool = next(
            (t for t in available_tools if (spec := TOOL_REGISTRY.get(t["name"])) is not None and not spec.is_mutating),
            None,
        )
        if read_only_tool is not None:
            return ProviderStepResult(tool_calls=[ToolCallRequest(id="call_1", name=read_only_tool["name"], arguments={})])

        last_message = messages[-1] if messages else ""
        return ProviderStepResult(final=ProviderFinal(text=f"Acknowledged: {last_message}"))

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [_deterministic_pseudo_embedding(t) for t in texts]


def _deterministic_pseudo_embedding(text: str, dimensions: int = 1536) -> list[float]:
    """Bag-of-character-trigrams hashing vectorizer: identical text -> identical vector, and text
    sharing substrings lands close in cosine space — reproducible, lexical-overlap behavior for
    tests/demos, not a claim of semantic understanding."""

    grams: set[str] = set()
    for token in text.lower().split():
        padded = f" {token} "
        grams.update(padded[i : i + 3] for i in range(len(padded) - 2))
    if not grams:
        grams = {text}

    vector = [0.0] * dimensions
    for gram in grams:
        digest = hashlib.sha256(gram.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % dimensions
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign
    return vector


def _synthesize_lesson_narration(message: str) -> str | None:
    """Deterministic stand-in for the active, demonstration-driven Guide lessons (NOVA 2.0's
    Guide redesign — FirstProductLesson.tsx): the lesson sends a fixed, distinctive prompt per
    phase, matched here by substring. A real provider would answer these same prompts from its
    own reasoning; this produces a plain-English equivalent deterministically, same spirit as
    _synthesize_guide_narration above."""

    text = message.lower()
    if "demonstrate adding a product" in text:
        return (
            "Watch me first — I'll fill in a product's name, price, SKU, and category, then "
            "clear it so you can add the real one yourself."
        )
    if "what you just showed me" in text:
        return (
            "Those fields — title, price, SKU, category — are the facts only you actually know; "
            "NOVA never guesses them. Everything else (description, SEO, tags) it can suggest "
            "once a real product exists. Your turn — add one for real."
        )
    if "added their own product successfully" in text:
        return "Nicely done — that's a real product now. NOVA can generate the rest whenever you're ready."
    return None


def _synthesize_guide_narration(tool_results: list[ToolResultMessage]) -> str | None:
    """Deterministic stand-in for the NOVA Guide's narration (ARCHITECTURE.md "Onboarding — the
    NOVA Guide") — without this, the generic tool-echo below would hand back a raw Python dict
    repr of the progress payload, which defeats the entire point of a "Guide" under the default
    (no API key) demo configuration. A real provider narrates this same tool result in its own
    words; this produces a plain-English equivalent deterministically."""

    progress_result = next((r for r in tool_results if r.name == "get_onboarding_progress"), None)
    if progress_result is None:
        return None

    content = progress_result.content
    steps = content.get("steps") or []
    current_key = content.get("current_step")
    completed_titles = [s["title"] for s in steps if s.get("status") == "completed"]

    if current_key is None:
        return "Every onboarding step is done — your store is built, published, and NOVA is watching it. Ask me anything, any time."

    current_title = next((s["title"] for s in steps if s.get("key") == current_key), current_key)
    if completed_titles:
        return f"Nice work so far — {', '.join(completed_titles)} done. Next: {current_title}. Handle this step and I'll pick up from there."
    return f"Let's start with: {current_title}. I'll take it from here once you do."


def _synthesize_product_content(context: dict) -> dict:
    """Deterministic stand-in for the Product Agent's content generation — builds plausible
    description/category/tags/SEO text from the title and brand vibe alone, never inventing a
    physical spec that wasn't supplied (ARCHITECTURE.md "Product ingestion & AI product content
    workflow")."""

    known = context.get("known_fields", {})
    brand = context.get("brand", {})
    title = known.get("title") or "New Product"
    category = known.get("category")
    vibe = (brand.get("vibe_text") or "quality craftsmanship").strip()
    target = brand.get("target_customer") or "our customers"
    brand_name = brand.get("name") or "the shop"

    description = f"{title} — designed with {vibe.lower()} for {target}."
    vibe_tag = vibe.split(",")[0].strip().lower() if vibe else None
    tags = [t for t in [category, vibe_tag] if t] or ["new"]

    return {
        "description": description,
        "category": category or "General",
        "tags": tags,
        "seo_title": f"{title} | {brand_name}",
        "seo_description": description[:160],
    }


def _synthesize_change_plan(context: dict) -> list[dict]:
    """Deterministic stand-in for the Storefront Agent's NL-to-structured-edit translation —
    keyword-driven, not a language model, but genuinely reads the instruction and existing draft
    rather than always returning the same plan (ARCHITECTURE.md "Store Builder — natural-language
    editing")."""

    instruction = (context.get("instruction") or "").lower()
    existing_types = set(context.get("existing_section_types") or [])
    brand = context.get("brand", {})
    plan: list[dict] = []

    if any(w in instruction for w in ("story", "about", "history")) and "brand_story" not in existing_types:
        plan.append(
            {
                "action": "add_section", "section_type": "brand_story",
                "description": "Add a brand story section to the homepage.",
                "configuration": {
                    "heading": "Our story",
                    "body": brand.get("description") or brand.get("positioning") or f"About {brand.get('name', 'us')}.",
                },
            }
        )

    if any(w in instruction for w in ("premium", "luxury", "elevate", "elegant", "upscale")):
        plan.append(
            {
                "action": "update_theme", "description": "Darken the palette and tighten corners for a more premium feel.",
                "configuration": {"primary_color": "#0c0a09", "border_radius": "2px"},
            }
        )

    if any(w in instruction for w in ("playful", "bold", "bright", "fun")):
        plan.append(
            {
                "action": "update_theme", "description": "Brighten the palette and round corners for a more playful feel.",
                "configuration": {"primary_color": "#e11d48", "border_radius": "16px"},
            }
        )

    if not plan:
        plan.append({"action": "none", "description": "No actionable change matched this instruction.", "configuration": None})

    return plan


def _synthesize_storefront_plan(context: dict) -> dict:
    """Deterministic stand-in for storefront_generation_service's structured call — builds the
    same hero/brand-story/product-grid/theme plan the old hardcoded template produced, but from
    genuinely reading `context` (brand, collections) rather than being a template itself: a real
    OpenAI-backed provider synthesizes this same shape from its own reasoning over the same
    context, not from calling this function."""

    brand = context.get("brand", {})
    name = brand.get("name") or "My Store"
    story_body = brand.get("description") or brand.get("positioning")

    collections = context.get("collections") or []

    plan = {
        "hero": {
            "headline": name,
            "subheadline": brand.get("vibe_text") or brand.get("positioning") or "Shop the collection",
            "cta_text": "Shop now",
            "cta_href": "/shop",
        },
        "include_brand_story": bool(story_body),
        "brand_story": {"heading": "Our story", "body": story_body} if story_body else None,
        "product_grid": {
            "title": "Shop all",
            "collection_id": collections[0]["id"] if collections else None,
            "limit": 12,
        },
        "theme": {
            "primary_color": (brand.get("preferred_colors") or [None])[0],
            "border_radius": None,
            "font_family": brand.get("typography_preference"),
        },
    }
    return plan


def scripted_tool_call(name: str, arguments: dict, call_id: str = "call_1") -> ProviderStepResult:
    return ProviderStepResult(tool_calls=[ToolCallRequest(id=call_id, name=name, arguments=arguments)])


def scripted_final(text: str) -> ProviderStepResult:
    return ProviderStepResult(final=ProviderFinal(text=text))


class FakePlaceholderImageProvider(ImageProvider):
    """Returns a deterministic placeholder image URL rather than calling a real generation API —
    default IMAGE_PROVIDER, same reasoning as FakeLLMProvider."""

    async def generate_image(
        self, *, kind: ImageKind, source_image_url: str | None, environment: str | None,
        model: str | None, mood: str | None, prompt_hint: str | None,
    ) -> GeneratedImage:
        seed = hashlib.sha256(f"{kind}:{source_image_url}:{environment}:{mood}".encode()).hexdigest()[:12]
        return GeneratedImage(
            url=f"https://placehold.co/800x800?text={kind}-{seed}",
            provider="fake",
            model="placeholder",
            prompt_metadata={"kind": kind, "environment": environment, "mood": mood, "prompt_hint": prompt_hint},
        )
