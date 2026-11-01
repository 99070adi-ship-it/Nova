"""Text-to-speech for the NOVA Guide and helping centre, served by self-hosted Kokoro-82M
(https://github.com/hexgrad/kokoro). No API key and no per-request cost: the model runs inside this
backend process (compute and disk are the cost; see backend/README-voice.md).

Same stance as the LLM provider (app/ai/provider.py): an unreliable dependency that is never
load-bearing. If the model is missing, still loading or fails, speech endpoints answer with a clear
status and the frontend carries on in text; nothing else in NOVA depends on this module.

Design points:
- The model is loaded ONCE per process, lazily (or at startup with TTS_PRELOAD), under a lock, off the
  event loop. Loading and inference run on a dedicated single worker thread, so a request can never
  block FastAPI's loop and two requests can never touch the shared model at once.
- The exact WAV bytes are produced in memory and returned whole (Kokoro yields segments, not a
  byte stream; the frontend already chunks long text by sentence). Audio and text are never persisted
  and the spoken text is never logged (only its length and the outcome).
- There is no fallback to any other TTS service.
"""

import asyncio
import io
import math
import os
import struct
import threading
import time
import wave
from abc import ABC, abstractmethod
from collections import defaultdict, deque
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

import structlog

from app.config import Settings, get_settings
from app.errors import SpeechRateLimitedError, SpeechUnavailableError

log = structlog.get_logger()

KOKORO_SAMPLE_RATE = 24000  # Kokoro-82M outputs 24 kHz mono float audio
WAV_MEDIA_TYPE = "audio/wav"


def encode_wav(samples: Any, sample_rate: int = KOKORO_SAMPLE_RATE) -> bytes:
    """16-bit PCM mono WAV from float samples in [-1, 1] (a numpy array, torch tensor or list)."""
    import numpy as np

    arr = np.asarray(samples, dtype=np.float32).reshape(-1)
    pcm = (np.clip(arr, -1.0, 1.0) * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


# ---- provider interface ------------------------------------------------------------------------------


class SpeechProvider(ABC):
    media_type: str = WAV_MEDIA_TYPE

    @abstractmethod
    def stream(self, text: str) -> AsyncIterator[bytes]:
        """Yield audio bytes for `text`. Raises SpeechUnavailableError / SpeechRateLimitedError."""

    @abstractmethod
    def status(self) -> dict:
        """Safe, non-sensitive readiness: {"engine", "state", "ready", ...}."""

    async def warm_up(self) -> dict:
        """Begin loading in the background (idempotent) and return the current status."""
        return self.status()


# ---- Kokoro ------------------------------------------------------------------------------------------


class KokoroEngine:
    """Owns the one KPipeline for this process. `pipeline_factory` is injectable so tests never import
    kokoro, torch or download anything."""

    def __init__(self, settings: Settings, pipeline_factory: Callable[[Settings], Any] | None = None):
        self._settings = settings
        self._factory = pipeline_factory or _default_pipeline_factory
        self._pipeline: Any = None
        self._state = "not_loaded"  # not_loaded | loading | ready | failed
        self._error: str | None = None  # a short, safe reason (no paths, no text)
        self._lock = threading.Lock()
        self._worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="kokoro")
        self._load_future: asyncio.Future | None = None
        self._waiting = 0
        self.load_count = 0  # how many times the model was actually constructed (tests assert 1)
        self.last_load_seconds: float | None = None

    @property
    def state(self) -> str:
        return self._state

    def status(self) -> dict:
        s = self._settings
        out: dict = {
            "engine": "kokoro", "state": self._state, "ready": self._state == "ready",
            "voice": s.kokoro_voice, "lang_code": s.kokoro_lang_code, "sample_rate": KOKORO_SAMPLE_RATE,
        }
        if self._state == "failed":
            out["reason"] = self._error
        return out

    # -- loading (runs on the worker thread) --

    def _load_blocking(self) -> None:
        with self._lock:
            if self._state == "ready":
                return
            self._state = "loading"
            started = time.monotonic()
            try:
                self._pipeline = self._factory(self._settings)
                self.load_count += 1
                self.last_load_seconds = round(time.monotonic() - started, 2)
                self._state = "ready"
                self._error = None
                log.info("tts.model_ready", seconds=self.last_load_seconds)
            except Exception as exc:  # missing package/system lib, download failure, OOM ...
                self._state = "failed"
                self._error = _safe_reason(exc)
                log.error("tts.model_load_failed", kind=type(exc).__name__, reason=self._error)

    def start_loading(self) -> "asyncio.Future":
        """Kick off loading once; every caller shares the same future. Never blocks the event loop."""
        if self._load_future is None:
            if self._state == "not_loaded":
                self._state = "loading"  # visible to status() before the worker thread picks it up
            loop = asyncio.get_running_loop()
            self._load_future = loop.run_in_executor(self._worker, self._load_blocking)
        return self._load_future

    def retry_load(self) -> None:
        """Allow another attempt after a failure (e.g. the operator fixed a missing dependency)."""
        if self._state == "failed":
            self._load_future = None
            self._state = "not_loaded"

    # -- inference (runs on the worker thread, so calls are serialised) --

    def _synthesize_blocking(self, text: str) -> bytes:
        import numpy as np

        s = self._settings
        parts = []
        for result in self._pipeline(text, voice=s.kokoro_voice, speed=s.kokoro_speed, split_pattern=r"\n+"):
            audio = result[2] if isinstance(result, tuple) else getattr(result, "audio", None)
            if audio is not None:
                parts.append(np.asarray(audio, dtype=np.float32).reshape(-1))
        if not parts:
            raise RuntimeError("no audio produced")
        return encode_wav(np.concatenate(parts))

    async def synthesize(self, text: str) -> bytes:
        if self._waiting >= self._settings.tts_max_queue:
            raise SpeechUnavailableError("Voice is busy right now.")
        self._waiting += 1
        deadline = self._settings.tts_timeout_seconds
        try:
            async def run() -> bytes:
                await self.start_loading()
                if self._state != "ready":
                    raise SpeechUnavailableError()
                loop = asyncio.get_running_loop()
                return await loop.run_in_executor(self._worker, self._synthesize_blocking, text)

            return await asyncio.wait_for(run(), timeout=deadline)
        except SpeechUnavailableError:
            raise
        except TimeoutError:
            log.warning("tts.timeout", chars=len(text))
            raise SpeechUnavailableError() from None
        except Exception as exc:
            log.warning("tts.inference_failed", kind=type(exc).__name__, chars=len(text))
            raise SpeechUnavailableError() from None
        finally:
            self._waiting -= 1


def _safe_reason(exc: Exception) -> str:
    if isinstance(exc, ModuleNotFoundError):
        return "The Kokoro voice package is not installed on this server."
    if isinstance(exc, MemoryError):
        return "Not enough memory to load the voice model."
    return "The voice model could not be loaded."


def _default_pipeline_factory(settings: Settings) -> Any:
    """Constructs the real kokoro KPipeline. Imported here so a server without the optional `voice`
    dependencies still starts and serves everything else."""
    if settings.kokoro_cache_dir:
        os.environ.setdefault("HF_HOME", settings.kokoro_cache_dir)
        os.environ.setdefault("HF_HUB_CACHE", os.path.join(settings.kokoro_cache_dir, "hub"))
    from kokoro import KPipeline  # type: ignore[import-not-found]

    device = settings.kokoro_device
    if device == "auto":
        import torch

        device = "cuda" if torch.cuda.is_available() else "cpu"
    pipeline = KPipeline(lang_code=settings.kokoro_lang_code, repo_id=settings.kokoro_repo_id, device=device)
    # Fetch the configured voice now, so a bad voice name fails at load time, not on the first request.
    pipeline.load_voice(settings.kokoro_voice)
    return pipeline


class KokoroSpeechProvider(SpeechProvider):
    def __init__(self, engine: KokoroEngine):
        self.engine = engine

    async def stream(self, text: str) -> AsyncIterator[bytes]:
        yield await self.engine.synthesize(text)

    def status(self) -> dict:
        return self.engine.status()

    async def warm_up(self) -> dict:
        if self.engine.state == "not_loaded":
            self.engine.start_loading()
        return self.engine.status()


# ---- fake (local dev / tests) -----------------------------------------------------------------------


def _tone_wav(seconds: float = 0.6, hz: int = 440, rate: int = 16000) -> bytes:
    n = int(seconds * rate)
    frames = b"".join(struct.pack("<h", int(2500 * math.sin(2 * math.pi * hz * i / rate))) for i in range(n))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames)
    return buf.getvalue()


class FakeSpeechProvider(SpeechProvider):
    """A short quiet tone, not speech: exercises the browser playback path without the model."""

    FAKE_AUDIO = _tone_wav()

    async def stream(self, text: str) -> AsyncIterator[bytes]:
        yield self.FAKE_AUDIO

    def status(self) -> dict:
        return {"engine": "fake", "state": "ready", "ready": True}


# ---- wiring -------------------------------------------------------------------------------------------

_provider: SpeechProvider | None = None


def build_speech_provider() -> SpeechProvider:
    s = get_settings()
    if s.tts_provider == "fake":
        return FakeSpeechProvider()
    return KokoroSpeechProvider(KokoroEngine(s))


def get_speech_provider() -> SpeechProvider:
    """FastAPI dependency (one provider, hence one model, per process); tests override it."""
    global _provider
    if _provider is None:
        _provider = build_speech_provider()
    return _provider


def peek_speech_status() -> dict:
    """The voice engine's state without building it (so reading readiness never loads the model)."""
    return _provider.status() if _provider is not None else {"state": "not_loaded"}


# ---- per-user rate limit (in-process: bounds load from one account; not a distributed quota) -------------

_recent: dict[str, deque[float]] = defaultdict(deque)


def check_rate_limit(user_key: str, *, now: float | None = None) -> None:
    limit = get_settings().tts_requests_per_minute
    t = time.monotonic() if now is None else now
    q = _recent[user_key]
    while q and t - q[0] > 60:
        q.popleft()
    if len(q) >= limit:
        raise SpeechRateLimitedError()
    q.append(t)
