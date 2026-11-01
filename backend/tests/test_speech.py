"""Text-to-speech via self-hosted Kokoro. The Kokoro pipeline is MOCKED everywhere in this file: no model
is downloaded, no torch/kokoro import happens and no network is used. So these prove the integration
(request handling, model lifecycle, serialisation, errors, format), not the sound of the real voice.
The real model is covered by the separate manual smoke test (scripts/kokoro_smoke.py)."""

import asyncio
import io
import threading
import time
import wave

import numpy as np
import pytest

from app.ai import speech
from app.ai.speech import (
    FakeSpeechProvider, KokoroEngine, KokoroSpeechProvider, SpeechProvider, encode_wav,
)
from app.config import get_settings
from app.errors import SpeechRateLimitedError
from app.main import app


async def _headers(client, seeded_owner):
    res = await client.post("/api/v1/auth/login", json={"email": seeded_owner["email"], "password": seeded_owner["password"]})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


class FakePipeline:
    """Stands in for kokoro.KPipeline: yields (graphemes, phonemes, audio) segments like the real one."""

    def __init__(self, seconds: float = 0.2, delay: float = 0.0, raises: Exception | None = None):
        self.calls: list[dict] = []
        self.seconds, self.delay, self.raises = seconds, delay, raises
        self.in_use = 0
        self.max_in_use = 0
        self._lock = threading.Lock()

    def __call__(self, text, voice, speed, split_pattern):
        with self._lock:
            self.in_use += 1
            self.max_in_use = max(self.max_in_use, self.in_use)
        try:
            self.calls.append({"text": text, "voice": voice, "speed": speed})
            if self.delay:
                time.sleep(self.delay)
            if self.raises:
                raise self.raises
            n = int(24000 * self.seconds)
            tone = (0.2 * np.sin(2 * np.pi * 440 * np.arange(n) / 24000)).astype(np.float32)
            yield ("g1", "p1", tone[: n // 2])
            yield ("g2", "p2", tone[n // 2 :])
        finally:
            with self._lock:
                self.in_use -= 1


@pytest.fixture(autouse=True)
def _reset():
    speech._recent.clear()
    yield
    app.dependency_overrides.pop(speech.get_speech_provider, None)
    speech._recent.clear()


def _engine(pipeline=None, factory=None):
    pipeline = pipeline or FakePipeline()
    calls = {"n": 0}

    def default_factory(settings):
        calls["n"] += 1
        return pipeline

    engine = KokoroEngine(get_settings(), factory or default_factory)
    engine.factory_calls = calls
    return engine, pipeline


def _use(provider: SpeechProvider):
    app.dependency_overrides[speech.get_speech_provider] = lambda: provider


def _kokoro(pipeline=None, factory=None):
    engine, pipeline = _engine(pipeline, factory)
    provider = KokoroSpeechProvider(engine)
    _use(provider)
    return engine, pipeline, provider


async def _say(client, headers, text="Hello there."):
    return await client.post("/api/v1/ai/speech", json={"text": text}, headers=headers)


# ---- success / format ----


async def test_speech_returns_a_real_wav_with_the_right_content_type(client, seeded_owner):
    engine, pipeline, _ = _kokoro()
    res = await _say(client, await _headers(client, seeded_owner), "  Check the details, then continue.  ")
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"  # not mislabelled as mp3
    assert res.headers["cache-control"] == "no-store"
    assert res.content[:4] == b"RIFF" and res.content[8:12] == b"WAVE"
    with wave.open(io.BytesIO(res.content)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, 24000)
        assert w.getnframes() == int(24000 * 0.2)  # both segments joined
    s = get_settings()
    assert pipeline.calls == [{"text": "Check the details, then continue.", "voice": s.kokoro_voice, "speed": s.kokoro_speed}]


def test_encode_wav_clips_and_converts_float_samples():
    data = encode_wav([2.0, -2.0, 0.0])
    with wave.open(io.BytesIO(data)) as w:
        frames = np.frombuffer(w.readframes(3), dtype="<i2")
    assert list(frames) == [32767, -32767, 0]


def test_defaults_name_the_official_model_and_a_natural_voice():
    s = get_settings()
    assert s.kokoro_repo_id == "hexgrad/Kokoro-82M" and s.kokoro_voice == "af_heart" and s.kokoro_lang_code == "a"
    assert s.tts_provider == "kokoro"


def test_no_openai_or_other_remote_tts_is_referenced():
    import inspect

    src = inspect.getsource(speech)
    assert "import openai" not in src and "api.openai" not in src and "OPENAI" not in src


# ---- model lifecycle ----


async def test_the_model_is_loaded_once_and_reused_across_requests(client, seeded_owner):
    engine, _, _ = _kokoro()
    h = await _headers(client, seeded_owner)
    for _ in range(3):
        assert (await _say(client, h)).status_code == 200
    assert engine.factory_calls["n"] == 1 and engine.load_count == 1 and engine.state == "ready"


async def test_concurrent_first_requests_still_load_the_model_once(client, seeded_owner):
    engine, _, _ = _kokoro()
    h = await _headers(client, seeded_owner)
    results = await asyncio.gather(*[_say(client, h, f"Line {i}.") for i in range(4)])
    assert all(r.status_code == 200 for r in results)
    assert engine.load_count == 1


async def test_model_load_failure_is_a_safe_503_and_never_leaks_detail(client, seeded_owner):
    def boom(settings):
        raise RuntimeError("CUDA OOM at /Users/secret/path with token hf_abcdef")

    engine, _, _ = _kokoro(factory=boom)
    res = await _say(client, await _headers(client, seeded_owner))
    assert res.status_code == 503 and res.json()["error"]["code"] == "speech_unavailable"
    assert "secret" not in res.text and "hf_abcdef" not in res.text
    assert engine.state == "failed"
    status = (await client.get("/api/v1/ai/speech/status", headers=await _headers(client, seeded_owner))).json()
    assert status["state"] == "failed" and status["ready"] is False
    assert "secret" not in str(status) and "hf_abcdef" not in str(status)


async def test_a_missing_kokoro_package_has_a_clear_operator_reason(client, seeded_owner):
    def missing(settings):
        raise ModuleNotFoundError("No module named 'kokoro'")

    engine, _, _ = _kokoro(factory=missing)
    h = await _headers(client, seeded_owner)
    assert (await _say(client, h)).status_code == 503
    status = (await client.get("/api/v1/ai/speech/status", headers=h)).json()
    assert "not installed" in status["reason"]


async def test_normal_functionality_survives_a_failed_voice_engine(client, seeded_owner):
    _kokoro(factory=lambda s: (_ for _ in ()).throw(RuntimeError("x")))
    h = await _headers(client, seeded_owner)
    assert (await _say(client, h)).status_code == 503
    assert (await client.get("/healthz")).status_code == 200
    assert (await client.get("/api/v1/products", headers=h)).status_code == 200
    ready = await client.get("/readyz")
    assert ready.status_code == 200 and ready.json()["status"] == "ready"


async def test_readyz_reports_voice_state_without_loading_the_model(client):
    engine, _, _ = _kokoro()
    ready = (await client.get("/readyz")).json()
    assert ready["status"] == "ready" and ready["voice"]["engine"] == "kokoro"
    assert engine.load_count == 0  # reading readiness never loads it


async def test_warmup_returns_immediately_then_the_engine_becomes_ready(client, seeded_owner):
    engine, _, _ = _kokoro(pipeline=FakePipeline(), factory=None)
    slow_started = threading.Event()

    def slow_factory(settings):
        slow_started.set()
        time.sleep(0.3)
        return FakePipeline()

    engine._factory = slow_factory
    h = await _headers(client, seeded_owner)
    t = time.monotonic()
    res = await client.post("/api/v1/ai/speech/warmup", headers=h)
    assert res.status_code == 202 and time.monotonic() - t < 0.25  # did not wait for the load
    assert res.json()["state"] == "loading"
    for _ in range(40):
        if (await client.get("/api/v1/ai/speech/status", headers=h)).json()["ready"]:
            break
        await asyncio.sleep(0.05)
    assert engine.state == "ready" and engine.load_count == 1


async def test_status_and_warmup_require_authentication(client):
    _kokoro()
    assert (await client.get("/api/v1/ai/speech/status")).status_code == 401
    assert (await client.post("/api/v1/ai/speech/warmup")).status_code == 401


# ---- inference errors ----


async def test_inference_exception_is_a_safe_503_and_the_engine_recovers(client, seeded_owner):
    pipeline = FakePipeline(raises=RuntimeError("tensor blew up on: my secret narration"))
    engine, _, _ = _kokoro(pipeline=pipeline)
    h = await _headers(client, seeded_owner)
    res = await _say(client, h, "my secret narration")
    assert res.status_code == 503 and res.json()["error"]["code"] == "speech_unavailable"
    assert "secret" not in res.text
    pipeline.raises = None
    assert engine.state == "ready"  # one bad request does not take the voice down
    assert (await _say(client, h)).status_code == 200


async def test_empty_inference_output_is_unavailable_not_a_500(client, seeded_owner):
    class Silent(FakePipeline):
        def __call__(self, text, voice, speed, split_pattern):
            return iter(())

    _kokoro(pipeline=Silent())
    assert (await _say(client, await _headers(client, seeded_owner))).status_code == 503


async def test_inference_timeout_is_a_503(client, seeded_owner, monkeypatch):
    monkeypatch.setattr(get_settings(), "tts_timeout_seconds", 0.2)
    _kokoro(pipeline=FakePipeline(delay=0.6))
    res = await _say(client, await _headers(client, seeded_owner))
    assert res.status_code == 503


# ---- concurrency ----


async def test_concurrent_requests_never_run_inference_at_the_same_time(client, seeded_owner):
    _, pipeline, _ = _kokoro(pipeline=FakePipeline(delay=0.05))
    h = await _headers(client, seeded_owner)
    results = await asyncio.gather(*[_say(client, h, f"Sentence {i}.") for i in range(5)])
    assert all(r.status_code == 200 for r in results)
    assert pipeline.max_in_use == 1  # the shared model is only ever used by one thread
    assert sorted(c["text"] for c in pipeline.calls) == [f"Sentence {i}." for i in range(5)]
    # each caller got a complete, valid WAV (no interleaved/corrupted state)
    assert all(r.content[:4] == b"RIFF" for r in results)


async def test_the_event_loop_is_not_blocked_while_the_model_runs(client, seeded_owner):
    _kokoro(pipeline=FakePipeline(delay=0.5))
    h = await _headers(client, seeded_owner)
    ticks = 0

    async def ticker():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.02)
            ticks += 1

    task = asyncio.create_task(ticker())
    await _say(client, h)
    task.cancel()
    assert ticks >= 10  # the loop kept running during ~0.5 s of inference


async def test_too_many_waiting_requests_get_a_busy_503_instead_of_piling_up(client, seeded_owner, monkeypatch):
    monkeypatch.setattr(get_settings(), "tts_max_queue", 2)
    monkeypatch.setattr(get_settings(), "tts_requests_per_minute", 100)
    _kokoro(pipeline=FakePipeline(delay=0.3))
    h = await _headers(client, seeded_owner)
    results = await asyncio.gather(*[_say(client, h, f"Line {i}.") for i in range(5)])
    codes = sorted(r.status_code for r in results)
    assert codes.count(200) == 2 and codes.count(503) == 3


# ---- validation / auth / limits (unchanged contract) ----


async def test_speech_requires_authentication(client):
    _kokoro()
    assert (await client.post("/api/v1/ai/speech", json={"text": "hi"})).status_code == 401
    bad = await client.post("/api/v1/ai/speech", json={"text": "hi"}, headers={"Authorization": "Bearer nope"})
    assert bad.status_code == 401


@pytest.mark.parametrize("payload", [{}, {"text": ""}, {"text": "   "}, {"text": 5}, {"text": "x" * 4001}])
async def test_speech_validates_input(client, seeded_owner, payload):
    _, pipeline, _ = _kokoro()
    res = await client.post("/api/v1/ai/speech", json=payload, headers=await _headers(client, seeded_owner))
    assert res.status_code == 422
    assert pipeline.calls == []  # nothing reached the model


async def test_speech_rejects_text_over_the_configured_limit(client, seeded_owner):
    _, pipeline, _ = _kokoro()
    h = await _headers(client, seeded_owner)
    limit = get_settings().tts_max_chars
    res = await _say(client, h, "a" * (limit + 1))
    assert res.status_code == 422 and res.json()["error"]["code"] == "validation_error"
    assert pipeline.calls == []
    assert (await _say(client, h, "a" * limit)).status_code == 200


async def test_per_user_rate_limit(client, seeded_owner, monkeypatch):
    monkeypatch.setattr(get_settings(), "tts_requests_per_minute", 2)
    _kokoro()
    h = await _headers(client, seeded_owner)
    assert (await _say(client, h, "one")).status_code == 200
    assert (await _say(client, h, "two")).status_code == 200
    third = await _say(client, h, "three")
    assert third.status_code == 429 and third.json()["error"]["code"] == "speech_rate_limited"


def test_rate_limit_window_slides():
    s = get_settings()
    old = s.tts_requests_per_minute
    s.tts_requests_per_minute = 1
    try:
        speech.check_rate_limit("u", now=0)
        with pytest.raises(SpeechRateLimitedError):
            speech.check_rate_limit("u", now=30)
        speech.check_rate_limit("u", now=61)
    finally:
        s.tts_requests_per_minute = old


async def test_empty_provider_stream_is_unavailable_not_a_500(client, seeded_owner):
    class Empty(SpeechProvider):
        async def stream(self, text):
            return
            yield b""  # pragma: no cover

        def status(self):
            return {"state": "ready"}

    _use(Empty())
    assert (await _say(client, await _headers(client, seeded_owner))).status_code == 503


async def test_the_text_is_never_logged(client, seeded_owner):
    from structlog.testing import capture_logs

    _kokoro(pipeline=FakePipeline(raises=RuntimeError("boom")))
    with capture_logs() as logs:
        await _say(client, await _headers(client, seeded_owner), "TOP SECRET CUSTOMER NOTE")
    assert logs and "TOP SECRET CUSTOMER NOTE" not in str(logs)


async def test_fake_provider_is_available_for_local_dev(client, seeded_owner):
    _use(FakeSpeechProvider())
    h = await _headers(client, seeded_owner)
    res = await _say(client, h)
    assert res.status_code == 200 and res.content == FakeSpeechProvider.FAKE_AUDIO and res.headers["content-type"] == "audio/wav"
    assert (await client.get("/api/v1/ai/speech/status", headers=h)).json()["ready"] is True
