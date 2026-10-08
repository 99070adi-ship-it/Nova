"""Provider-failure containment (ARCHITECTURE.md "AI provider abstraction" — every `LLMProvider`
is treated as an untrusted, unreliable external dependency). Two pieces:

- `safe_provider_step` wraps every `LLMProvider.step()` call — inside `agent_loop.run_agent`'s
  tool-calling loop and every single-shot structured-output call (Product Agent, Storefront
  Agent, Store Manager's missing-description generation) — so a raw SDK exception (rate limit,
  timeout, malformed response, network error) never reaches application code as anything but the
  one error type callers already know how to handle: `AIProviderError`.
- `guard_agent_run` is what every service function that owns an `AIAgentRun` wraps its body in.
  On `AIProviderError` it finalizes that run as `failed` — a real, committed, queryable row,
  distinct from `completed` (a run that produced a real answer) and from the request simply
  raising an unhandled 500 — and re-raises the same safe error for the route layer's existing
  `DomainError` handler to turn into the standard error envelope. It never swallows the error or
  retries; a caller that wants a retry makes that decision explicitly, once, outside this guard.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.provider import LLMProvider, ProviderStepResult, ToolResultMessage
from app.db.models import AgentRunStatus, AIAgentRun
from app.errors import AIProviderError
from app.repositories import ai_repo


async def safe_provider_step(
    provider: LLMProvider,
    *,
    system_prompt: str,
    context: dict,
    messages: list[str],
    tool_results: list[ToolResultMessage],
    available_tools: list[dict],
) -> ProviderStepResult:
    try:
        return await provider.step(
            system_prompt=system_prompt, context=context, messages=messages,
            tool_results=tool_results, available_tools=available_tools,
        )
    except AIProviderError:
        raise
    except Exception as exc:  # the vendor SDK's own exception types, timeouts, network errors — anything
        raise AIProviderError() from exc


@asynccontextmanager
async def guard_agent_run(db: AsyncSession, run: AIAgentRun) -> AsyncIterator[None]:
    try:
        yield
    except AIProviderError:
        await ai_repo.complete_agent_run(
            db, run, status=AgentRunStatus.failed, prompt_tokens=0, completion_tokens=0,
            hit_loop_cap=False, result_json={"error": "ai_provider_unavailable"},
        )
        await db.commit()
        raise
