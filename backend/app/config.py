from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# Always backend/.env, wherever the server was started from: a relative ".env" silently loaded nothing (and left the
# deterministic defaults, e.g. AI_PROVIDER=fake) when uvicorn was launched from the repository root.
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    env: str = "local"
    database_url: str = "postgresql+asyncpg://nova:nova@db:5432/nova"

    @field_validator("database_url")
    @classmethod
    def _force_asyncpg_driver(cls, v: str) -> str:
        # Managed Postgres providers hand out DATABASE_URL as postgres:// or postgresql://
        # (psycopg2-style, no driver suffix). This project only installs asyncpg.
        if v.startswith("postgres://"):
            return "postgresql+asyncpg://" + v[len("postgres://") :]
        if v.startswith("postgresql://"):
            return "postgresql+asyncpg://" + v[len("postgresql://") :]
        return v

    jwt_secret: str = "dev-secret-change-me-please-32-bytes-minimum"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 14

    ai_provider: Literal["fake", "nvidia", "openai"] = "fake"
    image_provider: Literal["fake", "nvidia", "openai"] = "fake"
    nvidia_api_key: str | None = None
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    # Cloudflare Workers AI (free daily allowance): text-to-image only. Needs the account id and an API token with
    # the "Workers AI" permission. Model is configurable; nothing in the code depends on a specific one beyond its I/O shape.
    cloudflare_account_id: str | None = None
    cloudflare_api_token: str | None = None
    cloudflare_image_model: str = "@cf/black-forest-labs/flux-1-schnell"
    cloudflare_edit_model: str = "@cf/black-forest-labs/flux-2-klein-4b"
    # Photo Studio. "cloudflare" is the real provider; "fake" (a tiny deterministic image) is allowed ONLY when ENV=local,
    # so a production deployment can never present a placeholder as an AI result.
    studio_provider: Literal["cloudflare", "fake"] = "cloudflare"
    studio_daily_limit: int = 20  # generations + edits per user per UTC day (protects the free-tier allowance)
    studio_burst_per_minute: int = 6
    studio_max_upload_bytes: int = 5 * 1024 * 1024
    studio_timeout_seconds: float = 90.0
    # NVIDIA NIM (OpenAI-compatible). Change NVIDIA_MODEL to switch models; nothing in the code names one.
    # NOTE: NVIDIA's free developer endpoints are for prototyping, research, development and testing, not for
    # serving real end users in production. Keep the provider swappable (AI_PROVIDER) and review NVIDIA's terms
    # before any production use (see README-ai.md).
    nvidia_model: str = "nvidia/nemotron-3-super-120b-a12b"
    # Optional JSON object sent as `chat_template_kwargs` (e.g. {"enable_thinking": false} for reasoning models).
    # Unset by default: only send what the endpoint is known to accept.
    nvidia_chat_template_kwargs: str | None = None
    # Optional SECOND NVIDIA identity used only for NOVA's conversation (text chat; its replies are also what gets spoken).
    # Everything unset here inherits the processing settings above, so a single-key setup behaves exactly as before.
    # Processing (Store Manager, storefront generation, product content, change plans, click-to-edit) never uses these.
    nvidia_chat_api_key: str | None = None
    nvidia_chat_base_url: str | None = None
    nvidia_chat_model: str | None = None
    ai_timeout_seconds: float = 45.0  # per attempt (chat: short, so a stuck call fails fast)
    ai_processing_timeout_seconds: float = 90.0  # per attempt for generation/analysis, which legitimately takes 20-40s on Nemotron Super
    ai_max_retries: int = 1
    ai_temperature: float = 0.4
    ai_max_output_tokens: int = 1500
    ai_history_messages: int = 20  # most recent conversation messages sent to the model
    openai_api_key: str | None = None
    openai_chat_model: str = "gpt-4o-mini"

    # Text-to-speech for the NOVA Guide / helping centre (app/ai/speech.py): self-hosted Kokoro-82M
    # (https://github.com/hexgrad/kokoro). No API key, no per-request cost; the model runs in this
    # process. "fake" returns a short tone (local playback checks, tests).
    tts_provider: Literal["kokoro", "fake"] = "kokoro"
    kokoro_repo_id: str = "hexgrad/Kokoro-82M"
    kokoro_lang_code: str = "a"  # "a" = American English, "b" = British English (see the Kokoro docs)
    kokoro_voice: str = "af_heart"  # e.g. af_bella, af_nicole, am_michael, bf_emma
    kokoro_speed: float = 1.0
    kokoro_device: Literal["cpu", "cuda", "mps", "auto"] = "cpu"
    kokoro_cache_dir: str | None = None  # Hugging Face cache for the model + voices (default ~/.cache/huggingface)
    tts_preload: bool = False  # load the model at startup instead of on first use / warm-up
    tts_max_chars: int = 600
    tts_timeout_seconds: float = 45.0  # whole request, including waiting for the model to finish loading
    tts_requests_per_minute: int = 30  # per user
    tts_max_queue: int = 6  # requests allowed to wait for the (single) inference worker; more get "busy"

    # Storefront checkout limits (app/services/checkout_service.py).
    checkout_max_quantity_per_line: int = 10
    checkout_max_lines: int = 30
    order_lookups_per_minute: int = 20  # per client
    # Absolute URL prefix for images stored as site-relative paths (e.g. /static/velora/tote.svg). Defaults to
    # the request's own origin; set it when the API sits behind a proxy that rewrites the host.
    public_base_url: str | None = None

    tool_loop_max_round_trips: int = 4
    store_manager_max_delegations: int = 6

    proposal_expiry_hours_low_risk: int = 24
    proposal_expiry_hours_high_risk: int = 4

    # SameSite for the refresh cookie. "strict" is right when the admin and the API share a registrable domain
    # (app.example.com + api.example.com). If they are on different sites (e.g. *.vercel.app + another host) the browser
    # will not send a strict cookie cross-site and sign-in will not persist: set COOKIE_SAMESITE=none (requires HTTPS; secure is already on outside local).
    cookie_samesite: Literal["strict", "lax", "none"] = "strict"

    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
    ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
