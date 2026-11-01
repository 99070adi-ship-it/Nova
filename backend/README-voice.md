# NOVA voice (self-hosted Kokoro TTS)

NOVA's Guide and helping-centre assistant speak using [Kokoro-82M](https://github.com/hexgrad/kokoro)
(Apache-2.0 model + code), run **inside the backend process**. No API key, no third-party TTS service, no
per-request charge. Without it, everything works and the Guide is text-only.

Tested with: `kokoro==0.9.4`, `misaki==0.9.4`, `torch==2.14.1`, Python 3.12 (see `constraints-voice.txt`).
Default voice `af_heart` (American English, female), `KOKORO_LANG_CODE=a`.

## Install and run locally
```bash
cd backend
pip install -e ".[voice]" -c constraints-voice.txt     # kokoro + torch (CPU) — a large download
python scripts/kokoro_smoke.py --download-only          # fetch the model once (~330 MB) into the cache
uvicorn app.main:app --port 8100
```
- **espeak-ng:** Kokoro's phonemizer uses the espeak-ng library bundled in the `espeakng-loader` wheel, so
  nothing system-wide was needed on macOS (arm64). On a platform without that wheel install the system
  package (`brew install espeak-ng` / `apt-get install espeak-ng`). `libsndfile` is only needed for tools
  that write audio files; the server writes WAV itself.
- **First run needs the internet** (model from Hugging Face, plus the `en_core_web_sm` spaCy model, which
  misaki installs on first use; the Dockerfile pre-installs it). After that it runs offline from the cache.
  Set `HF_TOKEN` to avoid anonymous rate limits.
- **Cache:** `KOKORO_CACHE_DIR` (or `HF_HOME`) — put it on a persistent volume in production, or every
  new container downloads the model again. `docker-compose.yml` mounts a `model_cache` volume.
- **Change the voice:** `KOKORO_VOICE=af_bella` (etc.) and restart; `KOKORO_LANG_CODE=b` for British voices.
- **Device:** `KOKORO_DEVICE=cpu` (default), `cuda`, `mps` (experimental) or `auto`.

## How it behaves
- The model loads **once per process**, lazily — the Guide's choice screen calls `POST /ai/speech/warmup`
  so it loads while the person is reading — or at startup with `TTS_PRELOAD=true`.
- Inference runs on one dedicated worker thread: it never blocks the event loop and requests never touch
  the model concurrently (they queue; more than `TTS_MAX_QUEUE` waiting get a "busy" 503).
- `GET /ai/speech/status` (authenticated) and `/readyz` report `not_loaded | loading | ready | failed`. If
  the model cannot load the app stays healthy, the Guide offers text only, and nothing else is affected.
- Audio is returned complete as `audio/wav` (24 kHz, 16-bit mono PCM), never stored; text is never logged.
- Limits: 600 characters per request, 30 requests/minute/user (`TTS_MAX_CHARS`, `TTS_REQUESTS_PER_MINUTE`).

## Resources (measured on an Apple-silicon Mac, CPU only, 10 cores)
| | |
|---|---|
| Disk | model ~330 MB (cache) + torch/kokoro install ≈ 1.5–2 GB |
| Load (model cached) | ~9 s; first-ever run is dominated by the download |
| Speech generation | 0.25–0.7 s for a 33–107 character narration, ≈ 10× faster than real time, steady state |
| RAM | plan for roughly 1–2 GB extra for the voice worker process; **small (≤1 GB) containers will not fit it** — use `WITH_VOICE=0` there |

Concurrency is intentionally 1: capacity is about one narration per ~0.3–0.7 s per worker. Several
simultaneous users on a small CPU host will queue; scale with more workers (each loads its own copy of
the model, so RAM scales with it) or a GPU. Self-hosting still costs compute and storage; only the
per-request API cost is zero.
