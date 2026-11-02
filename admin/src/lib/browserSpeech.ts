/**
 * NOVA's voice, run in the visitor's browser: the same Kokoro-82M model the backend uses, executed client-side with
 * kokoro-js (ONNX). This is what makes the voice work on a serverless host, where a ~2 GB model cannot run.
 *
 *  - Nothing is uploaded: the text is synthesised locally. The model files (about 90 MB quantised) are downloaded from the
 *    Hugging Face hub on first use and then cached by the browser, so later visits start instantly.
 *  - kokoro-js is imported on demand, so none of it is in the main bundle and people who choose text never download it.
 *  - Inference runs in a worker (never on the page's main thread), one sentence at a time, so typing and animation stay smooth.
 *  - It reports the same states as the server engine (not_loaded / loading / ready / failed), so the Guide treats both alike.
 */

import type { SpeechEngineState, SpeechStatus } from "../api/client";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "af_heart" as const; // the backend's default voice
const ENGINE = "kokoro-browser";

type TtsLike = Awaited<ReturnType<typeof import("kokoro-js").KokoroTTS.from_pretrained>>;

let state: SpeechEngineState = "not_loaded";
let loading: Promise<TtsLike> | null = null;
let queue: Promise<unknown> = Promise.resolve(); // one synthesis at a time

/** Needs WebAssembly and workers; jsdom, very old browsers and locked-down webviews simply report "not supported". */
export function isSupported(): boolean {
  return typeof WebAssembly === "object" && typeof Worker === "function" && typeof window !== "undefined" && typeof window.Audio === "function";
}

export function status(): SpeechStatus {
  return { engine: ENGINE, state, ready: state === "ready" };
}

async function load(): Promise<TtsLike> {
  const [{ KokoroTTS }, { env }] = await Promise.all([import("kokoro-js"), import("@huggingface/transformers")]);
  if (env.backends.onnx.wasm) env.backends.onnx.wasm.proxy = true; // run the model in a worker
  const gpu = await hasUsableWebGpu();
  try {
    return await KokoroTTS.from_pretrained(MODEL_ID, gpu ? { dtype: "fp32", device: "webgpu" } : { dtype: "q8", device: "wasm" });
  } catch (e) {
    if (!gpu) throw e;
    return KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device: "wasm" }); // WebGPU present but unusable: fall back to CPU
  }
}

/** `navigator.gpu` existing is not enough (headless and some drivers expose it without an adapter): only trust a real adapter. */
async function hasUsableWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

/** Starts loading the model in the background (idempotent) and returns the current status at once. */
export function warmUp(): SpeechStatus {
  if (!isSupported()) {
    state = "failed";
  } else if (state === "not_loaded") {
    state = "loading";
    loading = load().then(
      (tts) => { state = "ready"; return tts; },
      (err) => { state = "failed"; loading = null; throw err; },
    );
    loading.catch(() => {}); // the failure is reported through status(); callers of synthesize() see it as a rejection
  }
  return status();
}

/** Returns a WAV for `text`. Rejects on any failure, which the Guide treats as "carry on in text". */
export async function synthesize(text: string, signal?: AbortSignal): Promise<Blob> {
  warmUp();
  if (!loading) throw new Error("Browser voice is not available");
  const tts = await loading;
  const run = queue.then(async () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const audio = await tts.generate(text, { voice: VOICE, speed: 1 });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return audio.toBlob();
  });
  queue = run.catch(() => {});
  return run;
}
