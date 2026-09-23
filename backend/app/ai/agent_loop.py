"""The hand-built tool-calling loop (no agent framework) — owns only loop mechanics and the
round-trip cap; tool *execution* is supplied by the caller via the two executor callbacks, keeping
this module free of DB/service concerns. Generalized from a ticket-specific version: any agent —
specialized or Store Manager — runs through this same bounded loop (ARCHITECTURE.md "Store
Manager": "both loops have independent round-trip caps — bounded execution, structurally
enforced")."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from app.ai.provider import LLMProvider, ProviderFinal, ToolCallRequest, ToolResultMessage
from app.ai.tools import TOOL_REGISTRY, tool_schemas_for_model

ToolExecutor = Callable[[ToolCallRequest], Awaitable[ToolResultMessage]]


@dataclass
class AgentLoopResult:
    final: ProviderFinal | None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    hit_loop_cap: bool = False
    tool_call_log: list[dict] = field(default_factory=list)


async def run_agent(
    provider: LLMProvider,
    *,
    system_prompt: str,
    context: dict,
    messages: list[str],
    tool_names: list[str],
    read_only_executor: ToolExecutor,
    mutating_executor: ToolExecutor,
    max_round_trips: int,
) -> AgentLoopResult:
    tool_results: list[ToolResultMessage] = []
    total_prompt_tokens = 0
    total_completion_tokens = 0
    tool_call_log: list[dict] = []
    available_tools = tool_schemas_for_model(tool_names)

    for _round in range(max_round_trips):
        step = await provider.step(
            system_prompt=system_prompt, context=context, messages=messages,
            tool_results=tool_results, available_tools=available_tools,
        )
        total_prompt_tokens += step.prompt_tokens
        total_completion_tokens += step.completion_tokens

        if step.final is not None:
            return AgentLoopResult(
                final=step.final, prompt_tokens=total_prompt_tokens, completion_tokens=total_completion_tokens,
                tool_call_log=tool_call_log,
            )

        if not step.tool_calls:
            # No tool calls and no final answer — treat as a graceful dead end rather than loop.
            return AgentLoopResult(final=None, prompt_tokens=total_prompt_tokens, completion_tokens=total_completion_tokens)

        for call in step.tool_calls:
            spec = TOOL_REGISTRY.get(call.name)
            tool_call_log.append({"name": call.name, "arguments": call.arguments, "is_mutating": bool(spec and spec.is_mutating)})
            if spec is None or spec.name not in tool_names:
                result = ToolResultMessage(tool_call_id=call.id, name=call.name, content={"error": "unknown_or_unauthorized_tool"})
            elif spec.is_mutating:
                result = await mutating_executor(call)
            else:
                result = await read_only_executor(call)
            tool_results.append(result)

    return AgentLoopResult(
        final=None, prompt_tokens=total_prompt_tokens, completion_tokens=total_completion_tokens,
        hit_loop_cap=True, tool_call_log=tool_call_log,
    )
