from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

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
    nvidia_chat_model: str = "meta/llama-3.1-70b-instruct"
    openai_api_key: str | None = None
    openai_chat_model: str = "gpt-4o-mini"

    tool_loop_max_round_trips: int = 4
    store_manager_max_delegations: int = 6

    proposal_expiry_hours_low_risk: int = 24
    proposal_expiry_hours_high_risk: int = 4

    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
    ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
