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

export async function warmUpAuto(first: boolean): Promise<SpeechStatus> {
  if (resolved === "browser") return browser.warmUp();
  const server = () => (first ? warmUpSpeech() : getSpeechStatus());
  if (resolved === "server") return server();
  try {
    const s = await server();
    if (s.state === "failed" && useBrowser()) return browser.warmUp(); // the backend has no voice model: use the browser's
    return s;
  } catch (e) {
    if (useBrowser()) return browser.warmUp();
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
