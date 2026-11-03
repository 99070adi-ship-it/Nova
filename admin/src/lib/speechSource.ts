/**
 * Where NOVA's voice audio comes from. `VITE_VOICE_ENGINE`:
 *   "browser"  Kokoro runs in the visitor's browser (see browserSpeech.ts). Use this on a serverless host.
 *   "server"   the backend's /ai/speech only.
 *   "auto"     (default) try the backend first; if it cannot produce speech, switch to the browser engine for good.
 * The Guide's voice engine and hook only ever call the functions below, so they behave the same either way.
 */

import { fetchSpeech, getSpeechStatus, warmUpSpeech, type SpeechStatus } from "../api/client";
import * as browser from "./browserSpeech";

type Configured = "browser" | "server" | "auto";
const CONFIGURED: Configured = (import.meta.env?.VITE_VOICE_ENGINE as Configured | undefined) ?? "auto";
let resolved: "browser" | "server" | null = CONFIGURED === "auto" ? null : CONFIGURED;

function useBrowser(): boolean {
  if (!browser.isSupported()) return false;
  resolved = "browser";
  return true;
}

/**
 * `committed` is whether the person has actually chosen voice. The server engine is cheap to warm early (so it is ready by the
 * first sentence); the browser engine is a ~90 MB download, so it only starts once they have chosen voice, never for someone
 * who picks text.
 */
export async function warmUpAuto(first: boolean, committed = true): Promise<SpeechStatus> {
  const browserWarm = () => (committed ? browser.warmUp() : browser.status());
  if (resolved === "browser") return browserWarm();
  const server = () => (first ? warmUpSpeech() : getSpeechStatus());
  if (resolved === "server") return server();
  try {
    const s = await server();
    if (s.state === "failed" && useBrowser()) return browserWarm(); // the backend has no voice model: use the browser's
    return s;
  } catch (e) {
    if (useBrowser()) return browserWarm();
    throw e;
  }
}

export async function fetchSpeechAuto(text: string, signal?: AbortSignal): Promise<Blob> {
  if (resolved === "browser") return browser.synthesize(text, signal);
  if (resolved === "server") return fetchSpeech(text, signal);
  try {
    return await fetchSpeech(text, signal);
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) throw e;
    if (useBrowser()) return browser.synthesize(text, signal);
    throw e;
  }
}

/**
 * How the Guide should pace speech for the engine in use. The server returns audio in well under a second, so it takes whole
 * messages. The browser synthesises on the visitor's CPU (roughly real time), and returns a chunk only when it is complete, so
 * it works sentence by sentence (the first words start after one sentence, not after the whole message) and is given longer to
 * produce the first audio before the Guide gives up on it and just types.
 */
export function voiceTuning(): { chunkChars: number; maxChunks: number; startGraceMs: number | undefined; prefetchChunks: number } {
  return resolved === "browser"
    ? { chunkChars: 110, maxChunks: 12, startGraceMs: 20000, prefetchChunks: 0 } // one synthesis at a time: a prefetch would queue AHEAD of the line being spoken (or delay its later chunks)
    : { chunkChars: 480, maxChunks: 6, startGraceMs: undefined, prefetchChunks: 2 };
}

/** Whether speech is (or is configured to be) synthesised in the browser, i.e. there is a model to wait for. */
export function usesBrowserVoice(): boolean {
  return resolved === "browser";
}
