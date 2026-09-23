from app.ai.fake_provider import FakeLLMProvider, FakePlaceholderImageProvider
from app.ai.openai_compatible_provider import OpenAICompatibleProvider
from app.ai.provider import ImageProvider, LLMProvider
from app.config import get_settings


def build_llm_provider() -> LLMProvider:
    """Selects the LLMProvider implementation from configuration. Tests never go through this —
    they construct FakeLLMProvider directly so behavior can be scripted per test."""

    settings = get_settings()
    if settings.ai_provider == "nvidia":
        return OpenAICompatibleProvider(
            api_key=settings.nvidia_api_key, base_url=settings.nvidia_base_url, chat_model=settings.nvidia_chat_model,
            embedding_model=None,  # NVIDIA NIM's catalog varies by deployment; not exercised in Prototype 1
        )
    if settings.ai_provider == "openai":
        return OpenAICompatibleProvider(
            api_key=settings.openai_api_key, base_url=None, chat_model=settings.openai_chat_model,
        )
    return FakeLLMProvider()


def build_image_provider() -> ImageProvider:
    settings = get_settings()
    if settings.image_provider in ("nvidia", "openai"):
        # Real image generation is out of scope to wire end-to-end for Prototype 1 (the six-kind
        # ImageProvider ABC exists so a real backend slots in later without an interface change);
        # fall back to the deterministic placeholder rather than a half-built vendor call.
        return FakePlaceholderImageProvider()
    return FakePlaceholderImageProvider()
