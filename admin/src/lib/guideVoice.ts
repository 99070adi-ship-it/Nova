/**
 * Voice for the NOVA Guide: natural speech for the SAME concise narration the Guide shows, plus the
 * small per-user preference that records how a person wants to be guided. The audio comes from Kokoro
 * text-to-speech, from the backend (POST /ai/speech) or run in the browser itself (see speechSource.ts), and is played
 * with an ordinary <audio> element. Nothing here touches onboarding completion or any AI tool.
 *
 * Rules the engine enforces:
 *  - Audio never starts on its own. It only speaks when asked to, and the Guide only asks after the
 *    person explicitly chose "Voice + text" (that click is also the user activation browsers require).
 *  - One utterance at a time. A new narration cancels the previous one before it speaks, and a
 *    cancelled utterance's late events can never change the state of the next one.
 *  - The same text already being spoken is not started twice (a re-render cannot double the voice).
 *  - Failure never blocks anything: if speech errors or is unavailable the engine goes quiet, reports
 *    `failed`, and the Guide carries on in text.
 *  - Speech is requested for the whole message, or for sentence-sized chunks when it is long (never per
 *    word or character), so intonation stays natural; chunk N+1 is fetched while chunk N plays.
 *  - The engine also keeps a TIMELINE of what has been spoken (`position()`): the audio's real playback
 *    time, mapped onto the narration's text with punctuation-aware weights. The Guide's typewriter
 *    reads it so the words appear as they are spoken (see Typewriter.playSynced).
 */

import { fetchSpeechAuto } from "./speechSource";

export type GuideVoiceMode = "voice" | "text";

// ---- Preference ------------------------------------------------------------------------------------

const PREF_PREFIX = "nova.guide.voice.v1:";

/** Stored per signed-in user (never one global value), so a shared device does not carry one person's
 * choice over to the next. Unset means the person has not chosen yet. */
export function loadGuideVoiceMode(userKey: string): GuideVoiceMode | null {
  try {
    const v = window.localStorage.getItem(PREF_PREFIX + userKey);
    return v === "voice" || v === "text" ? v : null;
  } catch {
    return null; // storage blocked: behave as "not chosen yet" and ask again
  }
}

export function saveGuideVoiceMode(userKey: string, mode: GuideVoiceMode): void {
  try {
    window.localStorage.setItem(PREF_PREFIX + userKey, mode);
  } catch {
    // best effort: the choice still holds for this page session
  }
}

// ---- Timeline helpers ---------------------------------------------------------------------------------

export interface Range {
  start: number;
  end: number;
}

/** Longest chunk sent for synthesis (the server allows 600). Narration is one or two sentences, so it
 * is normally a single request; only long help-centre replies are split. */
const MAX_CHUNK_CHARS = 480;
/** A very long reply is spoken up to the last whole sentence that fits in this many chunks. */
const MAX_CHUNKS = 6;
const CACHE_LIMIT = 16;

/** Where each chunk lives in the ORIGINAL text. Split at sentence boundaries (and, for one enormous
 * sentence, at a word boundary), never mid-word; whitespace at the edges is excluded. */
export function chunkRanges(text: string, maxChars = MAX_CHUNK_CHARS, maxChunks = MAX_CHUNKS): Range[] {
  const trim = (start: number, end: number): Range | null => {
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    return end > start ? { start, end } : null;
  };
  const sentences: Range[] = [];
  const boundary = /(?<=[.!?…])\s+/g;
  let from = 0;
  for (let m = boundary.exec(text); m; m = boundary.exec(text)) {
    const r = trim(from, m.index);
    if (r) sentences.push(r);
    from = m.index + m[0].length;
  }
  const lastSentence = trim(from, text.length);
  if (lastSentence) sentences.push(lastSentence);

  const pieces: Range[] = [];
  for (const sentence of sentences) {
    let start = sentence.start;
    while (sentence.end - start > maxChars) {
      let cut = text.lastIndexOf(" ", start + maxChars);
      if (cut <= start) cut = start + maxChars; // one unbroken run longer than the limit: nothing better to do
      const piece = trim(start, cut);
      if (piece) pieces.push(piece);
      start = cut;
      while (start < sentence.end && /\s/.test(text[start])) start += 1;
    }
    if (start < sentence.end) pieces.push({ start, end: sentence.end });
  }
  const chunks: Range[] = [];
  for (const piece of pieces) {
    const last = chunks[chunks.length - 1];
    if (last && piece.end - last.start <= maxChars) last.end = piece.end;
    else chunks.push({ ...piece });
  }
  return chunks.slice(0, maxChunks);
}

export function splitIntoChunks(text: string, maxChars = MAX_CHUNK_CHARS, maxChunks = MAX_CHUNKS): string[] {
  return chunkRanges(text, maxChars, maxChunks).map((r) => text.slice(r.start, r.end));
}

// How long speech takes, in "letter equivalents": a letter is 1, a space a little, and the pauses a
// speaker makes at punctuation are worth several letters. Used only to place the text within a clip
// whose real duration is known, so it only has to get the proportions right.
const SPACE_WEIGHT = 0.4;
const PAUSE_WEIGHT: Record<string, number> = { ",": 2, ";": 3, ":": 3, "—": 2, "–": 1.5, ".": 5, "!": 5, "?": 5, "…": 5, "\n": 4 };

/** The speech weight accumulated BEFORE each character (a pause counts once more speech follows, so
 * the next word starts after it), and the total (trailing silence is trimmed from the audio window, so it
 * is not part of it). */
function weightsOf(text: string): { starts: number[]; total: number } {
  const starts: number[] = [];
  let total = 0;
  let pendingPause = 0;
  for (const ch of text) {
    const space = /\s/.test(ch);
    if (!space && pendingPause) {
      total += pendingPause;
      pendingPause = 0;
    }
    for (let i = 0; i < ch.length; i++) starts.push(total);
    total += space ? (ch === "\n" ? 0 : SPACE_WEIGHT) : 1;
    pendingPause = Math.max(pendingPause, PAUSE_WEIGHT[ch] ?? 0);
  }
  return { starts, total };
}

/** How many characters of `text` have been spoken once `fraction` (0..1) of its speech window has played. */
export function spokenOffset(text: string, fraction: number): number {
  if (fraction <= 0 || !text) return 0;
  if (fraction >= 1) return text.length;
  const { starts, total } = weightsOf(text);
  const target = fraction * total;
  let n = 0;
  while (n < starts.length && starts[n] < target) n += 1;
  return n;
}

export interface ClipInfo {
  /** Seconds of audio, and the window in it that actually contains speech (leading and trailing silence trimmed). */
  duration: number;
  start: number;
  end: number;
}

const blobBytes = (blob: Blob): Promise<ArrayBuffer> =>
  typeof blob.arrayBuffer === "function"
    ? blob.arrayBuffer()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      });

/** Reads a 16-bit PCM WAV (what the voice server returns) to find its duration and where the speech
 * starts and ends. Returns null for anything else; callers then fall back to the element's own duration. */
export async function analyzeWav(blob: Blob): Promise<ClipInfo | null> {
  try {
    const view = new DataView(await blobBytes(blob));
    const tag = (o: number) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
    if (view.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
    let rate = 0;
    let channels = 1;
    let pcm16 = false;
    for (let o = 12; o + 8 <= view.byteLength; ) {
      const id = tag(o);
      const size = view.getUint32(o + 4, true);
      if (id === "fmt ") {
        pcm16 = view.getUint16(o + 8, true) === 1 && view.getUint16(o + 22, true) === 16;
        channels = view.getUint16(o + 10, true);
        rate = view.getUint32(o + 12, true);
      } else if (id === "data") {
        if (!pcm16 || !rate) return null;
        const frames = Math.floor(Math.min(size, view.byteLength - o - 8) / (2 * channels));
        const duration = frames / rate;
        const win = Math.max(1, Math.round(rate * 0.01)); // 10 ms windows
        const threshold = 0.015 * 32768;
        let first = -1;
        let last = -1;
        for (let w = 0; w * win < frames; w++) {
          let peak = 0;
          for (let f = w * win; f < Math.min(frames, (w + 1) * win); f++) {
            peak = Math.max(peak, Math.abs(view.getInt16(o + 8 + f * 2 * channels, true)));
          }
          if (peak >= threshold) {
            if (first < 0) first = w;
            last = w;
          }
        }
        if (first < 0) return { duration, start: 0, end: duration };
        const pad = 0.03; // a hair of margin so the first word is never late and the last never cut
        return { duration, start: Math.max(0, first * 0.01 - pad), end: Math.min(duration, (last + 1) * 0.01 + pad) };
      }
      o += 8 + size + (size % 2);
    }
    return null;
  } catch {
    return null;
  }
}

export interface VoiceDeps {
  /** Returns audio (WAV) for `text`; rejects on any failure. Defaults to the backend. */
  fetchAudio: (text: string, signal: AbortSignal) => Promise<Blob>;
  createAudio: () => HTMLAudioElement;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  isSupported: () => boolean;
  analyze: (blob: Blob) => Promise<ClipInfo | null>;
}

function defaultDeps(): VoiceDeps {
  return {
    fetchAudio: (text, signal) => fetchSpeechAuto(text, signal),
    createAudio: () => new window.Audio(),
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
    isSupported: () => typeof window !== "undefined" && typeof window.Audio === "function" && typeof URL.createObjectURL === "function",
    analyze: analyzeWav,
  };
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Resolves "playing" the moment audio is audibly playing, or "unavailable" if it never will (failed,
 * blocked by the browser, cancelled, replaced). Lets the Guide start the text exactly with the voice. */
export type SpeechStart = "playing" | "unavailable";

interface Timeline {
  text: string;
  chunks: Range[];
  clips: (ClipInfo | null | undefined)[];
  index: number;
  done: boolean;
}

export class NovaVoice {
  private readonly deps: VoiceDeps;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private abort: AbortController | null = null;
  /** Bumped by every speak/cancel. Every async step re-checks it, so a replaced or cancelled
   * narration can never touch the state, or the sound, that now belongs to the next one. */
  private generation = 0;
  private active = false;
  private currentText = "";
  private cache = new Map<string, Promise<Blob>>();
  private listeners = new Set<() => void>();
  private timeline: Timeline | null = null;
  private audible = false;
  private started: Promise<SpeechStart> = Promise.resolve("unavailable");
  private settleStarted: ((v: SpeechStart) => void) | null = null;
  /** True only while audio is really playing: it drives the speaking indicator. */
  speaking = false;
  /** Speech could not be produced (provider down, no credentials, network); the Guide stays in text. */
  failed = false;
  /** The browser wants a click before it will play audio (autoplay policy). Replay is a click. */
  blocked = false;
  lastText = "";

  constructor(deps: Partial<VoiceDeps> = {}) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  get supported(): boolean {
    return this.deps.isSupported();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private notify() {
    for (const fn of [...this.listeners]) fn();
  }
  private setSpeaking(value: boolean) {
    if (this.speaking === value) return;
    this.speaking = value;
    this.notify();
  }
  private setFlag(flag: "failed" | "blocked", value: boolean) {
    if (this[flag] === value) return;
    this[flag] = value;
    this.notify();
  }
  private settle(value: SpeechStart) {
    const done = this.settleStarted;
    this.settleStarted = null;
    done?.(value);
  }

  /** Speak `text` now, replacing anything being spoken. The returned promise says when audio is really
   * playing ("playing") or that it will not be ("unavailable"). No-op when unsupported, failed, or
   * already speaking/preparing exactly this text (unless `force`, used by Replay). */
  speak(text: string, { force = false }: { force?: boolean } = {}): Promise<SpeechStart> {
    const clean = text.trim();
    this.lastText = clean;
    if (!clean || !this.supported || this.failed) return Promise.resolve("unavailable");
    if (!force && this.active && this.currentText === clean) return this.started;

    this.stopCurrent();
    this.active = true;
    this.currentText = clean;
    this.started = new Promise<SpeechStart>((resolve) => (this.settleStarted = resolve));
    const generation = this.generation;
    const abort = (this.abort = new AbortController());
    // The timeline is anchored to the text exactly as the Guide shows it (its offsets index that string).
    const shown = text;
    const chunks = chunkRanges(shown);
    this.timeline = { text: shown, chunks, clips: [], index: 0, done: false };
    const started = this.started;
    void this.run(shown, chunks, generation, abort.signal);
    return started;
  }

  /** Start fetching the audio for a narration that is about to be spoken, so it begins without a gap. Cheap
   * and silent: nothing plays, and a later speak() of the same text reuses the audio. Never throws. */
  prefetch(text: string): void {
    const clean = text.trim();
    if (!clean || !this.supported || this.failed) return;
    const signal = new AbortController().signal; // never cancelled: the audio is wanted soon
    for (const r of chunkRanges(clean).slice(0, 2)) this.fetchChunk(clean.slice(r.start, r.end), signal).catch(() => {});
  }

  /** Speak the most recent narration again from the start. */
  replay(text?: string): Promise<SpeechStart> {
    return this.speak(text ?? this.lastText, { force: true });
  }

  /** Stop speaking immediately. Safe to call at any time. */
  cancel(): void {
    this.stopCurrent();
  }

  /** Forget a past failure or block so the person can try voice again. */
  resetFailure(): void {
    this.setFlag("failed", false);
    this.setFlag("blocked", false);
  }

  /** How many characters of the narration being spoken have been spoken so far, from the audio's real
   * playback time; `null` when no audio is playing this narration (not started yet, cancelled,
   * failed). Holds still while the audio is paused or between chunks, and equals the text length once
   * it has finished. */
  position(): number | null {
    const tl = this.timeline;
    if (!tl || !this.audible) return null;
    if (tl.done) return tl.text.length;
    const range = tl.chunks[tl.index];
    if (!range || !this.audio) return null;
    const clip = tl.clips[tl.index];
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : clip?.duration ?? 0;
    const start = clip?.start ?? 0;
    const end = clip?.end ?? duration;
    const fraction = end > start ? (this.audio.currentTime - start) / (end - start) : 0;
    return range.start + spokenOffset(tl.text.slice(range.start, range.end), Math.min(1, Math.max(0, fraction)));
  }

  private fetchChunk(text: string, signal: AbortSignal): Promise<Blob> {
    const hit = this.cache.get(text);
    if (hit) return hit;
    const request = this.deps.fetchAudio(text, signal);
    this.cache.set(text, request);
    // A failed or aborted request must not be remembered.
    request.catch(() => this.cache.delete(text));
    while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value as string);
    return request;
  }

  private async run(text: string, chunks: Range[], generation: number, signal: AbortSignal): Promise<void> {
    const current = () => generation === this.generation;
    const part = (i: number) => text.slice(chunks[i].start, chunks[i].end);
    try {
      let next: Promise<Blob> | null = this.fetchChunk(part(0), signal);
      for (let i = 0; i < chunks.length; i++) {
        const blob = (await next) as Blob;
        if (!current()) return;
        const clip = await this.deps.analyze(blob);
        if (!current()) return;
        // While this chunk plays, the next is already being prepared.
        next = i + 1 < chunks.length ? this.fetchChunk(part(i + 1), signal) : null;
        next?.catch(() => {}); // surfaced when awaited; never an unhandled rejection meanwhile
        if (this.timeline) {
          this.timeline.clips[i] = clip;
          this.timeline.index = i;
        }
        await this.play(blob, generation);
        if (!current()) return;
      }
      if (this.timeline) this.timeline.done = true;
      this.active = false;
      this.setSpeaking(false);
    } catch (e) {
      if (!current() || isAbort(e)) return;
      this.active = false;
      this.timeline = null;
      this.audible = false;
      this.setSpeaking(false);
      this.settle("unavailable");
      if (e instanceof DOMException && e.name === "NotAllowedError") this.setFlag("blocked", true);
      else this.setFlag("failed", true);
    }
  }

  private play(blob: Blob, generation: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const audio = (this.audio ??= this.deps.createAudio());
      if (this.objectUrl) this.deps.revokeObjectURL(this.objectUrl);
      const url = (this.objectUrl = this.deps.createObjectURL(blob));
      const done = () => {
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
        audio.removeEventListener("playing", onPlaying);
        audio.removeEventListener("pause", onPause);
      };
      const onPlaying = () => {
        if (generation !== this.generation) return;
        this.setFlag("blocked", false);
        this.audible = true;
        this.setSpeaking(true);
        this.settle("playing"); // text and voice begin from this same moment
      };
      // Paused by something other than NOVA (media key, headphones): the voice, and so the text that
      // follows it, simply hold; "playing" resumes both.
      const onPause = () => {
        if (generation === this.generation && !audio.ended) this.setSpeaking(false);
      };
      const onEnded = () => {
        done();
        resolve();
      };
      const onError = () => {
        done();
        reject(new Error("audio-error"));
      };
      audio.addEventListener("playing", onPlaying);
      audio.addEventListener("pause", onPause);
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);
      audio.src = url;
      // Rejects with NotAllowedError when the browser needs a click first; AbortError if replaced.
      audio.play().catch((e) => {
        done();
        reject(e);
      });
      this.stopHooks.add(() => {
        done();
        resolve(); // cancelled: let the loop notice the generation changed and stop
      });
    });
  }
  private stopHooks = new Set<() => void>();

  private stopCurrent() {
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
    this.active = false;
    this.currentText = "";
    this.timeline = null;
    this.audible = false;
    this.settle("unavailable"); // anyone waiting for this narration to start stops waiting
    for (const hook of [...this.stopHooks]) hook();
    this.stopHooks.clear();
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.removeAttribute("src");
        this.audio.load?.();
      } catch {
        // nothing to stop
      }
    }
    if (this.objectUrl) {
      this.deps.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.setSpeaking(false);
  }
}
