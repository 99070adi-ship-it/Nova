"""Manual smoke test of the REAL Kokoro model (the automated tests mock it).

  python scripts/kokoro_smoke.py                 # load the model, synthesise sample NOVA narrations, time them
  python scripts/kokoro_smoke.py --download-only # just fetch the model + configured voice into the cache
  python scripts/kokoro_smoke.py --out /tmp/nova-voice   # also write the WAV files so you can listen

Downloads ~330 MB the first time (Hugging Face cache; see KOKORO_CACHE_DIR). Uses the same settings and
the same KokoroEngine the server uses. Run from backend/."""

import argparse
import asyncio
import io
import pathlib
import time
import wave

from app.ai.speech import KokoroEngine
from app.config import get_settings

SAMPLES = [
    "First, your brand. Watch me fill it in.",
    "Check the details, then continue.",
    "Your store has 26 products. Two of them are missing descriptions, so I can write those for you if you like.",
]


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--download-only", action="store_true")
    parser.add_argument("--out", type=pathlib.Path)
    args = parser.parse_args()

    settings = get_settings()
    print(f"voice={settings.kokoro_voice} lang={settings.kokoro_lang_code} device={settings.kokoro_device} repo={settings.kokoro_repo_id}")
    engine = KokoroEngine(settings)
    t = time.monotonic()
    await engine.start_loading()
    print(f"model load: {time.monotonic() - t:.1f}s  state={engine.state}  {engine.status().get('reason', '')}")
    if engine.state != "ready":
        raise SystemExit(1)
    if args.download_only:
        return
    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
    for i in range(2):  # the first call includes one-off warm-up costs; the second is steady state
        for n, text in enumerate(SAMPLES):
            t = time.monotonic()
            wav = await engine.synthesize(text)
            took = time.monotonic() - t
            with wave.open(io.BytesIO(wav)) as w:
                audio_s = w.getnframes() / w.getframerate()
            print(f"pass {i + 1} sample {n + 1}: {len(text):3d} chars -> {audio_s:4.1f}s audio in {took:5.2f}s (x{audio_s / took:.1f} real time)")
            if args.out and i == 1:
                (args.out / f"sample{n + 1}.wav").write_bytes(wav)


asyncio.run(main())
