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

// ---- Download progress (for the "setting up NOVA's voice" bar) -----------------------------------------------------------
export interface VoiceProgress {
  state: SpeechEngineState;
  /** 0-100, or null until the first byte count is known (show an indeterminate bar). Never goes backwards. */
  percent: number | null;
  loadedBytes: number;
  totalBytes: number;
}
let progress: VoiceProgress = { state: "not_loaded", percent: null, loadedBytes: 0, totalBytes: 0 };
const listeners = new Set<() => void>();
const files = new Map<string, { loaded: number; total: number }>();
/** Files are announced one by one, so the real total only becomes known late. Dividing by the size we expect keeps the bar from
 * leaping to ~100% when a tiny first file finishes. Set once the device (and therefore the model variant) is known. */
let expectedBytes = 0;
export function setExpectedBytes(bytes: number): void {
  expectedBytes = bytes;
}
const MB = 1024 * 1024;
const EXPECTED_WASM_BYTES = 88 * MB; // q8 model + voices, as measured
const EXPECTED_WEBGPU_BYTES = 330 * MB; // fp32
const publish = (patch: Partial<VoiceProgress>) => {
  progress = { ...progress, ...patch }; // a new object each time: useSyncExternalStore compares by identity
  listeners.forEach((l) => l());
};
const setState = (next: SpeechEngineState) => {
  state = next;
  publish({ state: next, ...(next === "ready" ? { percent: 100 } : {}) });
};
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const getProgress = (): VoiceProgress => progress;

/** transformers.js reports one event stream per file; fold them into one overall percentage. Exported for tests. */
export function onDownloadEvent(e: { status?: string; file?: string; loaded?: number; total?: number }): void {
  if (!e.file) return;
  if (e.status === "progress" && typeof e.loaded === "number" && typeof e.total === "number" && e.total > 0) {
    files.set(e.file, { loaded: e.loaded, total: e.total });
  } else if (e.status === "done") {
    const f = files.get(e.file);
    if (f) files.set(e.file, { loaded: f.total, total: f.total });
  } else {
    return;
  }
  let loaded = 0;
  let total = 0;
  files.forEach((f) => { loaded += f.loaded; total += f.total; });
  if (total === 0) return;
  const whole = Math.max(total, expectedBytes);
  publish({ loadedBytes: loaded, totalBytes: whole, percent: Math.max(progress.percent ?? 0, Math.min(99, Math.round((loaded / whole) * 100))) });
}

/** Test hook: forget everything between tests. */
export function resetForTests(): void {
  state = "not_loaded";
  loading = null;
  expectedBytes = 0;
  files.clear();
  progress = { state: "not_loaded", percent: null, loadedBytes: 0, totalBytes: 0 };
}
let queue: Promise<unknown> = Promise.resolve(); // one synthesis at a time

/** Needs WebAssembly and workers; jsdom, very old browsers and locked-down webviews simply report "not supported". */
export function isSupported(): boolean {
  return typeof WebAssembly === "object" && typeof Worker === "function" && typeof window !== "undefined" && typeof window.Audio === "function";
}

export function status(): SpeechStatus {
  const now = isSupported() ? state : "failed"; // an unsupported browser can never speak: say so without downloading anything
  return { engine: ENGINE, state: now, ready: now === "ready" };
}

async function load(): Promise<TtsLike> {
  const [{ KokoroTTS }, { env }] = await Promise.all([import("kokoro-js"), import("@huggingface/transformers")]);
  if (env.backends.onnx.wasm) env.backends.onnx.wasm.proxy = true; // run the model in a worker
  const gpu = await hasUsableWebGpu();
  setExpectedBytes(gpu ? EXPECTED_WEBGPU_BYTES : EXPECTED_WASM_BYTES);
  const tts = await loadModel(KokoroTTS, gpu);
  // The first synthesis pays one-off start-up costs: do it now, while the setup screen is showing, not on NOVA's first sentence.
  try {
    await tts.generate("Hello.", { voice: VOICE, speed: 1 });
  } catch {
    // warming up is best effort: a real request will report any real problem
  }
  return tts;
}

async function loadModel(KokoroTTS: typeof import("kokoro-js").KokoroTTS, gpu: boolean): Promise<TtsLike> {
  try {
    return await KokoroTTS.from_pretrained(MODEL_ID, {
      ...(gpu ? { dtype: "fp32" as const, device: "webgpu" as const } : { dtype: "q8" as const, device: "wasm" as const }),
      progress_callback: onDownloadEvent,
    });
  } catch (e) {
    if (!gpu) throw e;
    files.clear(); // the WebGPU attempt may have fetched a different (larger) set of files
    return KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device: "wasm", progress_callback: onDownloadEvent }); // WebGPU present but unusable: fall back to CPU
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
    setState("failed");
  } else if (state === "not_loaded") {
    setState("loading");
    loading = load().then(
      (tts) => { setState("ready"); return tts; },
      (err) => { setState("failed"); loading = null; throw err; },
    );
    loading.catch(() => {}); // the failure is reported through status(); callers of synthesize() see it as a rejection
  }
  return status();
}

/** Returns a WAV for `text`. Rejects on any failure, which the Guide treats as "carry on in text". */
export async function synthesize(text: string, signal?: AbortSignal): Promise<Blob> {
  warmUp();
  if (!loading) throw new Error("Browser voice is not available");
  const asked = performance.now();
  const tts = await loading;
  const run = queue.then(async () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const began = performance.now();
    const audio = await tts.generate(text, { voice: VOICE, speed: 1 });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (import.meta.env?.DEV) {
      console.debug(`[voice] "${text.slice(0, 28)}" waited ${Math.round(began - asked)} ms, synthesised in ${Math.round(performance.now() - began)} ms`);
    }
    return audio.toBlob();
  });
  queue = run.catch(() => {});
  return run;
}
