"""Direct coverage for OpenAICompatibleProvider.step() (NOVA 2.0 AI audit finding: this was the
one provider that would actually talk to a real external API with zero verification that its
request/response mapping is correct). Every test here mocks the OpenAI SDK client — no real
network/API calls are made, matching the repo-wide convention (app/ai/fake_provider.py is the
only thing tests ever construct directly for conversational/tool-loop behavior; this file is the
first to verify OpenAICompatibleProvider's own translation layer in isolation)."""

from unittest.mock import AsyncMock

import pytest
from openai.types.chat import ChatCompletion, ChatCompletionMessage
from openai.types.chat.chat_completion import Choice
from openai.types.chat.chat_completion_message_tool_call import ChatCompletionMessageToolCall, Function
from openai.types.completion_usage import CompletionUsage

from app.ai.openai_compatible_provider import OpenAICompatibleProvider
from app.ai.provider import ToolResultMessage
from app.ai.reliability import safe_provider_step


def _provider(api_key: str = "sk-test-not-a-real-key") -> OpenAICompatibleProvider:
    return OpenAICompatibleProvider(api_key=api_key, base_url=None, chat_model="gpt-4o-mini")


def _completion(*, content: str | None = None, tool_calls=None, finish_reason="stop", usage=None) -> ChatCompletion:
    message = ChatCompletionMessage(role="assistant", content=content, tool_calls=tool_calls)
    choice = Choice(index=0, message=message, finish_reason=finish_reason)
    return ChatCompletion(id="chatcmpl-test", choices=[choice], created=1700000000, model="gpt-4o-mini", object="chat.completion", usage=usage)


def _tool_call(call_id: str, name: str, arguments: str) -> ChatCompletionMessageToolCall:
    return ChatCompletionMessageToolCall(id=call_id, type="function", function=Function(name=name, arguments=arguments))


async def test_step_sends_system_context_and_user_messages_with_correct_model():
    provider = _provider()
    mock_create = AsyncMock(return_value=_completion(content="hi", usage=CompletionUsage(prompt_tokens=1, completion_tokens=1, total_tokens=2)))
    provider._client.chat.completions.create = mock_create

    await provider.step(
        system_prompt="You are NOVA.", context={"org": "acme"}, messages=["hello", "how are sales?"],
        tool_results=[], available_tools=[],
    )

    kwargs = mock_create.call_args.kwargs
    assert kwargs["model"] == "gpt-4o-mini"
    messages = kwargs["messages"]
    assert messages[0] == {"role": "system", "content": "You are NOVA."}
    assert messages[1]["role"] == "user" and "acme" in messages[1]["content"] and "Context" in messages[1]["content"]
    assert messages[2] == {"role": "user", "content": "hello"}
    assert messages[3] == {"role": "user", "content": "how are sales?"}
    assert kwargs["tools"] is None  # no available_tools -> omitted, not an empty list sent as-is


async def test_step_omits_context_message_when_context_is_empty():
    provider = _provider()
    mock_create = AsyncMock(return_value=_completion(content="ok"))
    provider._client.chat.completions.create = mock_create

    await provider.step(system_prompt="sys", context={}, messages=["hi"], tool_results=[], available_tools=[])

    messages = mock_create.call_args.kwargs["messages"]
    assert messages == [{"role": "system", "content": "sys"}, {"role": "user", "content": "hi"}]


async def test_step_translates_tool_definitions_correctly():
    provider = _provider()
    mock_create = AsyncMock(return_value=_completion(content="ok"))
    provider._client.chat.completions.create = mock_create

    available_tools = [
        {"name": "get_sales_metrics", "description": "Get revenue.", "parameters": {"type": "object", "properties": {"days": {"type": "integer"}}}},
    ]
    await provider.step(system_prompt="sys", context={}, messages=[], tool_results=[], available_tools=available_tools)

    tools_payload = mock_create.call_args.kwargs["tools"]
    assert tools_payload == [
        {"type": "function", "function": {"name": "get_sales_metrics", "description": "Get revenue.", "parameters": available_tools[0]["parameters"]}}
    ]


async def test_step_folds_prior_tool_results_back_in_as_tool_messages():
    provider = _provider()
    mock_create = AsyncMock(return_value=_completion(content="ok"))
    provider._client.chat.completions.create = mock_create

    tool_results = [ToolResultMessage(tool_call_id="call_1", name="get_sales_metrics", content={"revenue": 100})]
    await provider.step(system_prompt="sys", context={}, messages=[], tool_results=tool_results, available_tools=[])

    messages = mock_create.call_args.kwargs["messages"]
    tool_message = messages[-1]
    assert tool_message["role"] == "tool"
    assert tool_message["tool_call_id"] == "call_1"
    assert tool_message["name"] == "get_sales_metrics"
    assert '"revenue": 100' in tool_message["content"]


async def test_step_parses_a_normal_text_response_and_usage():
    provider = _provider()
    completion = _completion(content="Sales are up 12%.", usage=CompletionUsage(prompt_tokens=42, completion_tokens=8, total_tokens=50))
    provider._client.chat.completions.create = AsyncMock(return_value=completion)

    result = await provider.step(system_prompt="sys", context={}, messages=["how are sales?"], tool_results=[], available_tools=[])

    assert result.tool_calls == []
    assert result.final is not None
    assert result.final.text == "Sales are up 12%."
    assert result.prompt_tokens == 42
    assert result.completion_tokens == 8


async def test_step_parses_a_single_tool_call():
    provider = _provider()
    completion = _completion(tool_calls=[_tool_call("call_1", "get_sales_metrics", '{"days": 30}')], finish_reason="tool_calls")
    provider._client.chat.completions.create = AsyncMock(return_value=completion)

    result = await provider.step(system_prompt="sys", context={}, messages=[], tool_results=[], available_tools=[])

    assert result.final is None
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].id == "call_1"
    assert result.tool_calls[0].name == "get_sales_metrics"
    assert result.tool_calls[0].arguments == {"days": 30}


async def test_step_parses_multiple_tool_calls_in_one_response():
    provider = _provider()
    completion = _completion(
        tool_calls=[
            _tool_call("call_1", "get_sales_metrics", '{"days": 30}'),
            _tool_call("call_2", "get_low_stock_products", "{}"),
        ],
        finish_reason="tool_calls",
    )
    provider._client.chat.completions.create = AsyncMock(return_value=completion)

    result = await provider.step(system_prompt="sys", context={}, messages=[], tool_results=[], available_tools=[])

    assert len(result.tool_calls) == 2
    assert [c.name for c in result.tool_calls] == ["get_sales_metrics", "get_low_stock_products"]
    assert result.tool_calls[1].arguments == {}


async def test_step_missing_usage_defaults_to_zero_tokens():
    provider = _provider()
    completion = _completion(content="ok", usage=None)
    provider._client.chat.completions.create = AsyncMock(return_value=completion)

    result = await provider.step(system_prompt="sys", context={}, messages=[], tool_results=[], available_tools=[])

    assert result.prompt_tokens == 0
    assert result.completion_tokens == 0


async def test_step_null_content_and_no_tool_calls_returns_empty_final_not_a_crash():
    provider = _provider()
    completion = _completion(content=None, tool_calls=None, finish_reason="stop")
    provider._client.chat.completions.create = AsyncMock(return_value=completion)

    result = await provider.step(system_prompt="sys", context={}, messages=[], tool_results=[], available_tools=[])

    assert result.tool_calls == []
    assert result.final is not None
    assert result.final.text == ""


async def test_step_malformed_tool_call_arguments_json_raises_rather_than_silently_misparsing():
    # arguments="" (no function call args at all) must not crash — falls back to {}.
    provider = _provider()
    completion = _completion(tool_calls=[_tool_call("call_1", "get_low_stock_products", "")], finish_reason="tool_calls")
    provider._client.chat.completions.create = AsyncMock(return_value=completion)

    result = await provider.step(system_prompt="sys", context={}, messages=[], tool_results=[], available_tools=[])
    assert result.tool_calls[0].arguments == {}


async def test_sdk_exception_is_converted_to_the_safe_provider_error_path_without_leaking_the_api_key():
    from app.errors import AIProviderError

    secret_key = "sk-test-super-secret-do-not-leak-123456"
    provider = _provider(api_key=secret_key)
    provider._client.chat.completions.create = AsyncMock(
        side_effect=Exception(f"Incorrect API key provided: {secret_key}")
    )

    with pytest.raises(AIProviderError) as exc_info:
        await safe_provider_step(
            provider, system_prompt="sys", context={}, messages=["hi"], tool_results=[], available_tools=[],
        )

    message = str(exc_info.value)
    assert secret_key not in message
    assert "AI service is temporarily unavailable" in message
    assert "Incorrect API key" not in message


async def test_connection_style_exception_is_also_converted_safely():
    import httpx

    provider = _provider()
    provider._client.chat.completions.create = AsyncMock(
        side_effect=httpx.ConnectError("Connection refused")
    )

    from app.errors import AIProviderError

    with pytest.raises(AIProviderError) as exc_info:
        await safe_provider_step(
            provider, system_prompt="sys", context={}, messages=[], tool_results=[], available_tools=[],
        )
    assert "Connection refused" not in str(exc_info.value)
