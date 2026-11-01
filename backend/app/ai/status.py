"""Which AI is active, and is it usable? Safe to show to any signed-in user and to operators: it names the provider and
model and says whether credentials exist, and never contains a key, a key fragment, a request or a vendor error message."""

import asyncio
import os
import time
from urllib.parse import urlparse

from app.ai.factory import UnavailableProvider, build_llm_provider
from app.config import ENV_FILE, get_settings
from app.errors import AIProviderError

_PROBE_TTL_SECONDS = 60.0
_probe: dict = {"at": 0.0, "ready": None, "error": None, "latency_ms": None}


def _model_name(provider: str) -> str | None:
    s = get_settings()
    return {"nvidia": s.nvidia_model, "openai": s.openai_chat_model}.get(provider)


# Every place that asks for a language model. They ALL go through app.ai.factory.build_llm_provider() (one factory, one setting,
# AI_PROVIDER), which is why "text chat" and "processing" can never be configured differently. tests/test_ai_routing.py scans the
# source and fails if a call site is added, removed or bypasses the factory without this list being updated.
LLM_CALL_SITES: dict[str, str] = {
    "app/services/agent_service.py": "text chat (assistant, NOVA Guide, Store Manager conversations) and delegate_to_agent",
    "app/services/store_manager_service.py": "processing: Store Health narratives (sales/inventory/customer agents) and the Action Plan",
    "app/services/product_agent_service.py": "processing: product content generation",
    "app/services/storefront_generation_service.py": "processing: storefront generation",
    "app/services/storefront_agent_service.py": "processing: storefront change plans",
    "app/services/storefront_element_service.py": "processing: click-to-edit proposals",
    "app/ai/status.py": "the one-request provider probe",
}


def capabilities(s=None) -> dict:
    """Which provider and model each AI capability uses right now. No secrets. The text AI and everything that reasons with it share
    one provider by construction; speech and images are separate systems with their own settings."""
    s = s or get_settings()
    real = s.ai_provider != "fake"
    text = {"provider": s.ai_provider, "model": _model_name(s.ai_provider), "real_ai": real, "setting": "AI_PROVIDER"}
    chat = dict(text)
    if s.ai_provider == "nvidia":
        chat["model"] = s.nvidia_chat_model or s.nvidia_model
        chat["separate_from_processing"] = bool(s.nvidia_chat_api_key or s.nvidia_chat_model or s.nvidia_chat_base_url)
        chat["credentials_configured"] = bool(s.nvidia_chat_api_key or s.nvidia_api_key)
        chat["setting"] = "NVIDIA_CHAT_MODEL / NVIDIA_CHAT_API_KEY (inherit NVIDIA_* when unset)"
    return {
        "text_chat": {**chat, "used_by": "POST /ai/conversations/{id}/messages (the replies NOVA speaks come from here)"},
        "processing": {**text, "used_by": "Store Manager (health, action plan, delegation), product content, storefront generation, change plans, click-to-edit"},
        "transcription": {"provider": None, "implemented": False, "note": "There is no speech-to-text feature; voice replies are text chat plus speech output."},
        "speech_output": {"provider": s.tts_provider, "model": s.kokoro_repo_id if s.tts_provider == "kokoro" else None, "setting": "TTS_PROVIDER", "used_by": "POST /ai/speech"},
        "image_generation": {
            "provider": s.image_provider, "setting": "IMAGE_PROVIDER",
            # A real image provider is not built yet: whatever is selected, the placeholder generator runs. Said here, never silent.
            "implemented": False, "behaviour": "placeholder images (deterministic stand-in)",
            "note": None if s.image_provider == "fake" else f"IMAGE_PROVIDER={s.image_provider} is selected but no real image provider exists yet; placeholders are produced.",
        },
    }


def _env_file_values() -> dict[str, str]:
    """Names and values of the NON-secret AI settings currently on disk in backend/.env, plus whether a key line has a value
    (never the value itself). Lets the status say "you edited .env but the running server hasn't loaded it"."""
    out: dict[str, str] = {}
    try:
        for line in ENV_FILE.read_text().splitlines():
            if "=" not in line or line.lstrip().startswith("#"):
                continue
            name, _, value = line.partition("=")
            name, value = name.strip().upper(), value.strip().strip("\"'")
            if name in ("AI_PROVIDER", "NVIDIA_MODEL", "NVIDIA_BASE_URL", "TTS_PROVIDER"):
                out[name] = value
            elif name == "NVIDIA_API_KEY":
                out["NVIDIA_API_KEY_SET"] = "true" if value else "false"
    except OSError:
        pass
    return out


def _config_report(s) -> dict:
    """Where the running server got its AI settings and whether they are stale (the process caches them at start)."""
    file_values = _env_file_values()
    from_env = [n for n in ("AI_PROVIDER", "NVIDIA_API_KEY", "NVIDIA_MODEL", "NVIDIA_BASE_URL") if n in os.environ]
    stale: list[str] = []
    if "AI_PROVIDER" not in os.environ and file_values.get("AI_PROVIDER", s.ai_provider) != s.ai_provider:
        stale.append("AI_PROVIDER")
    if "NVIDIA_MODEL" not in os.environ and file_values.get("NVIDIA_MODEL", s.nvidia_model) != s.nvidia_model:
        stale.append("NVIDIA_MODEL")
    if "NVIDIA_API_KEY" not in os.environ and (file_values.get("NVIDIA_API_KEY_SET") == "true") != bool(s.nvidia_api_key):
        stale.append("NVIDIA_API_KEY")
    return {
        "env_file": str(ENV_FILE), "env_file_found": ENV_FILE.exists(),
        # Process environment variables beat backend/.env; naming WHICH ones are set (not their values) explains surprises.
        "overridden_by_environment": from_env,
        "restart_required": bool(stale), "changed_on_disk": stale,
    }


def describe(*, include_probe: bool = True) -> dict:
    s = get_settings()
    key_present = {"nvidia": bool(s.nvidia_api_key), "openai": bool(s.openai_api_key)}.get(s.ai_provider)
    real = s.ai_provider != "fake"
    info: dict = {
        "provider": s.ai_provider,
        "model": _model_name(s.ai_provider),
        "real_ai": real,
        # "fake" is the rule-based test/demo double: it follows rules, it is not a language model.
        "mode": "language_model" if real else "rule_based_demo",
        "credentials_configured": True if not real else bool(key_present),
        "endpoint_host": urlparse(s.nvidia_base_url).hostname if s.ai_provider == "nvidia" else None,
    }
    info["config"] = _config_report(s)
    # The voice (text-to-speech) provider is separate from the text AI above and has its own settings (TTS_PROVIDER, KOKORO_*).
    info["voice"] = {"provider": s.tts_provider, "role": "speech output only"}
    info["capabilities"] = capabilities(s)
    if not real:
        info["ready"] = True
    elif not key_present:
        info["ready"] = False
        info["reason"] = "credentials_missing"
    elif include_probe and _probe["at"]:
        info["ready"] = _probe["ready"]
        info["last_check"] = {"seconds_ago": round(time.monotonic() - _probe["at"]), "error": _probe["error"], "latency_ms": _probe["latency_ms"]}
    else:
        info["ready"] = None  # configured, not yet checked: use the probe
    return info


async def probe() -> dict:
    """One tiny real request to the configured provider (cached for a minute so it can't be used to burn quota). The outcome
    records only whether it worked and the KIND of failure."""
    s = get_settings()
    if s.ai_provider == "fake" or time.monotonic() - _probe["at"] < _PROBE_TTL_SECONDS and _probe["at"]:
        return describe()
    provider = build_llm_provider()
    started = time.monotonic()
    error: str | None = None
    ready = False
    if isinstance(provider, UnavailableProvider):
        error = "credentials_missing"
    else:
        try:
            step = await asyncio.wait_for(
                provider.step(system_prompt="Reply with the single word: ok", context={}, messages=["ping"], tool_results=[], available_tools=[]),
                timeout=min(20.0, s.ai_timeout_seconds),
            )
            ready = bool(step.final and step.final.text.strip())
            error = None if ready else "empty_response"
        except AIProviderError:
            error = "provider_error"
        except TimeoutError:
            error = "timeout"
        except Exception as exc:  # the SDK's own types, reduced to an operator-useful KIND (never the message)
            code = getattr(exc, "status_code", None)
            error = {401: "authentication_failed", 403: "access_denied", 404: "model_not_found", 429: "rate_limited"}.get(code) or (
                "timeout" if "Timeout" in type(exc).__name__ else "provider_error"
            )
    _probe.update(at=time.monotonic(), ready=ready, error=error, latency_ms=round((time.monotonic() - started) * 1000))
    return describe()


def reset_probe() -> None:
    _probe.update(at=0.0, ready=None, error=None, latency_ms=None)
