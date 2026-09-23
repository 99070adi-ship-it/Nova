from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Literal


@dataclass(frozen=True)
class ToolCallRequest:
    """One tool call the model wants to make. `id` lets the loop correlate a tool result back to
    the call that produced it, mirroring the OpenAI tool-calling wire format."""

    id: str
    name: str
    arguments: dict


@dataclass(frozen=True)
class ProviderFinal:
    text: str


@dataclass(frozen=True)
class ProviderStepResult:
    tool_calls: list[ToolCallRequest] = field(default_factory=list)
    final: ProviderFinal | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0


@dataclass(frozen=True)
class ToolResultMessage:
    tool_call_id: str
    name: str
    content: dict


class LLMProvider(ABC):
    """Application/domain code depends only on this interface, never on a specific vendor SDK
    (ARCHITECTURE.md "AI provider abstraction"). Domain-agnostic by design — `system_prompt` and
    `context` carry whatever a given agent needs (ticket text, product data, store health
    findings, ...); the provider itself knows nothing about NOVA's business domain."""

    @abstractmethod
    async def step(
        self,
        *,
        system_prompt: str,
        context: dict,
        messages: list[str],
        tool_results: list[ToolResultMessage],
        available_tools: list[dict],
    ) -> ProviderStepResult: ...

    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]]: ...


@dataclass(frozen=True)
class GeneratedImage:
    url: str
    provider: str
    model: str
    prompt_metadata: dict


ImageKind = Literal["lifestyle", "on_model", "environment", "promotional", "hero", "collection"]


class ImageProvider(ABC):
    """Typed for all six image kinds the product concept eventually needs; Prototype 1
    concretely exercises only `lifestyle` (ARCHITECTURE.md "AI image system")."""

    @abstractmethod
    async def generate_image(
        self,
        *,
        kind: ImageKind,
        source_image_url: str | None,
        environment: str | None,
        model: str | None,
        mood: str | None,
        prompt_hint: str | None,
    ) -> GeneratedImage: ...
