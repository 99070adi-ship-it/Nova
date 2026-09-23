"""Deterministic test/dev double for LLMProvider — makes AI-boundary behavior (schema validation,
permission checks, loop caps, the approval gate) testable without ever calling a real model. Also
the default AI_PROVIDER so the demo never depends on a live API key."""

import hashlib

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
            summary = "; ".join(f"{r.name} -> {r.content}" for r in tool_results)
            return ProviderStepResult(final=ProviderFinal(text=f"Based on {summary}."))

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
