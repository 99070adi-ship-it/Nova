"""CloudflareSpeechProvider (app/ai/speech.py): the HTTP call is mocked, so the suite never reaches Cloudflare."""

import base64
import json

import httpx
import pytest

from app.ai.speech import CloudflareSpeechProvider, build_speech_provider
from app.config import get_settings
from app.errors import SpeechRateLimitedError, SpeechUnavailableError

_REAL_CLIENT = httpx.AsyncClient
WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 20


def _provider(monkeypatch, handler, *, configured=True):
    s = get_settings()
    monkeypatch.setattr(s, "cloudflare_account_id", "acct" if configured else None)
    monkeypatch.setattr(s, "cloudflare_api_token", "tok" if configured else None)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: _REAL_CLIENT(transport=httpx.MockTransport(handler), **kw))
    return CloudflareSpeechProvider(s)


async def _bytes(provider, text="Hello there."):
    return b"".join([c async for c in provider.stream(text)])


async def test_returns_the_wav_and_sends_the_text_with_the_secret_in_a_header(monkeypatch):
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"], seen["auth"], seen["body"] = str(req.url), req.headers["authorization"], json.loads(req.content)
        return httpx.Response(200, json={"result": {"audio": base64.b64encode(WAV).decode()}, "success": True})

    audio = await _bytes(_provider(monkeypatch, handler))
    assert audio == WAV
    assert seen["url"].endswith("/accounts/acct/ai/run/@cf/myshell-ai/melotts")
    assert seen["auth"] == "Bearer tok" and "tok" not in seen["url"]
    assert seen["body"] == {"prompt": "Hello there.", "lang": "en"}


@pytest.mark.parametrize("response", [
    httpx.Response(500, json={"errors": [{"message": "secret vendor detail"}]}),
    httpx.Response(200, json={"result": {"audio": base64.b64encode(b"not a wav").decode()}}),
    httpx.Response(200, json={"result": None}),
])
async def test_bad_answers_become_a_plain_unavailable_error(monkeypatch, response):
    with pytest.raises(SpeechUnavailableError) as err:
        await _bytes(_provider(monkeypatch, lambda req: response))
    assert "vendor" not in err.value.message


async def test_rate_limit_and_network_errors(monkeypatch):
    with pytest.raises(SpeechRateLimitedError):
        await _bytes(_provider(monkeypatch, lambda req: httpx.Response(429)))

    def boom(req):
        raise httpx.ConnectError("down")

    with pytest.raises(SpeechUnavailableError):
        await _bytes(_provider(monkeypatch, boom))


def test_status_reports_ready_only_when_configured(monkeypatch):
    assert _provider(monkeypatch, lambda r: httpx.Response(200)).status()["ready"] is True
    unconfigured = _provider(monkeypatch, lambda r: httpx.Response(200), configured=False).status()
    assert unconfigured["state"] == "failed" and "token" not in json.dumps(unconfigured).lower()


def test_selected_by_tts_provider(monkeypatch):
    monkeypatch.setattr(get_settings(), "tts_provider", "cloudflare")
    assert isinstance(build_speech_provider(), CloudflareSpeechProvider)
