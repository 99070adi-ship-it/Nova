import json

from app.errors import AIProviderNotConfiguredError
from app.ai.fake_provider import FakeLLMProvider, FakePlaceholderImageProvider
from app.ai.openai_compatible_provider import OpenAICompatibleProvider
from app.ai.provider import ImageProvider, LLMProvider
from app.config import get_settings


class UnavailableProvider(LLMProvider):
    """Stands in when a real provider is selected but cannot be built (e.g. a missing key). It FAILS every call with the safe
    AIProviderError; it never quietly answers with the deterministic test double, so a live demo can't pass off canned output
    as real AI."""

    def __init__(self, reason: str):
        self.reason = reason

    async def step(self, **kwargs):  # type: ignore[override]
        raise AIProviderNotConfiguredError()

    async def embed(self, texts: list[str]) -> list[list[float]]:
        raise AIProviderNotConfiguredError()


def _template_kwargs(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return {"chat_template_kwargs": value} if isinstance(value, dict) else None


def build_llm_provider(role: str = "processing") -> LLMProvider:
    """role is "processing" (default: reasoning, tools, generation) or "chat" (NOVA's conversation). Selects the LLMProvider from configuration. AI_PROVIDER=fake is the deterministic test/demo double (and says so in the
    status endpoint); nvidia/openai are real. A real provider without credentials is UnavailableProvider, never the double."""

    settings = get_settings()
    common = dict(
        timeout_seconds=settings.ai_timeout_seconds if role == "chat" else settings.ai_processing_timeout_seconds, max_retries=settings.ai_max_retries,
        temperature=settings.ai_temperature, max_output_tokens=settings.ai_max_output_tokens,
    )
    if settings.ai_provider == "nvidia":
        # role="chat" may use its own key/endpoint/model (NVIDIA_CHAT_*); each unset piece inherits the processing value.
        chat = role == "chat"
        api_key = (settings.nvidia_chat_api_key if chat else None) or settings.nvidia_api_key
        if not api_key:
            return UnavailableProvider("NVIDIA_API_KEY is not set")
        return OpenAICompatibleProvider(
            api_key=api_key,
            base_url=(settings.nvidia_chat_base_url if chat else None) or settings.nvidia_base_url,
            chat_model=(settings.nvidia_chat_model if chat else None) or settings.nvidia_model,
            embedding_model=None,  # NIM's catalog varies by deployment; embeddings aren't used here
            extra_body=_template_kwargs(settings.nvidia_chat_template_kwargs), **common,
        )
    if settings.ai_provider == "openai":
        if not settings.openai_api_key:
            return UnavailableProvider("OPENAI_API_KEY is not set")
        return OpenAICompatibleProvider(api_key=settings.openai_api_key, base_url=None, chat_model=settings.openai_chat_model, **common)
    return FakeLLMProvider()


def build_image_provider() -> ImageProvider:
    settings = get_settings()
    if settings.image_provider in ("nvidia", "openai"):
        # Real image generation is out of scope to wire end-to-end for Prototype 1 (the six-kind
        # ImageProvider ABC exists so a real backend slots in later without an interface change);
        # fall back to the deterministic placeholder rather than a half-built vendor call.
        return FakePlaceholderImageProvider()
    return FakePlaceholderImageProvider()
