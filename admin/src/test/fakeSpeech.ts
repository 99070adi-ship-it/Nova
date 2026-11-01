import { vi } from "vitest";

/** A stand-in for the backend speech endpoint and the browser's <audio> element. It records what was
 * asked to be spoken and lets a test fire the same events a real element would (playing, ended,
 * error). It is a MOCK: it proves how NOVA drives the voice pipeline, not that any audio is produced
 * (that needs the real provider and a real browser, checked separately). */
export class FakeAudio {
  static instances: FakeAudio[] = [];
  /** When true (default) play() behaves like a real element: "playing" fires, currentTime advances and
   * "ended" follows. Tests that need to script the timeline themselves set it to false. */
  static auto = true;
  static autoDurationMs = 100;
  src = "";
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 2;
  playCalls = 0;
  /** What play() does: resolve (default), or reject with this error (e.g. NotAllowedError). */
  rejectWith: Error | null = null;
  private handlers = new Map<string, Set<() => void>>();
  private ticker: ReturnType<typeof setInterval> | null = null;
  constructor() {
    FakeAudio.instances.push(this);
  }
  addEventListener(name: string, fn: () => void) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name)!.add(fn);
  }
  removeEventListener(name: string, fn: () => void) {
    this.handlers.get(name)?.delete(fn);
  }
  play() {
    this.playCalls += 1;
    if (this.rejectWith) return Promise.reject(this.rejectWith);
    this.paused = false;
    this.ended = false;
    this.currentTime = 0;
    if (FakeAudio.auto) this.autoPlay();
    return Promise.resolve();
  }
  private autoPlay() {
    this.stopTicker();
    setTimeout(() => {
      if (this.paused) return;
      this.emit("playing");
      const steps = 10;
      let n = 0;
      this.ticker = setInterval(() => {
        n += 1;
        this.currentTime = (this.duration * n) / steps;
        if (n >= steps) this.finish();
      }, FakeAudio.autoDurationMs / steps);
    }, 0);
  }
  /** What a real element does at the end: paused becomes true, "pause" then "ended" fire. */
  finish() {
    this.stopTicker();
    this.currentTime = this.duration;
    this.ended = true;
    this.paused = true;
    this.emit("pause");
    this.emit("ended");
  }
  private stopTicker() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }
  pause() {
    this.stopTicker();
    this.paused = true;
  }
  removeAttribute() {
    this.src = "";
  }
  load() {
    this.stopTicker();
  }
  emit(name: string) {
    for (const fn of [...(this.handlers.get(name) ?? [])]) fn();
  }
}

export interface FakeSpeech {
  /** Every text the app asked the backend to turn into speech, in order. */
  requested: string[];
  fetchAudio: ReturnType<typeof vi.fn>;
  signals: AbortSignal[];
  /** The one audio element the engine plays through (undefined until something is played). */
  audio: () => FakeAudio | undefined;
  elements: () => number;
  /** Make backend requests fail (or succeed again with null). */
  failWith: (err: Error | null) => void;
  /** Hold backend responses until the returned function releases them (simulated latency). */
  hold: () => () => void;
  /** Fire "playing" / "ended" the way a real element does. */
  startPlaying: () => void;
  finishPlaying: () => void;
}

export function installFakeSpeech(): { speech: FakeSpeech; deps: Record<string, unknown>; restore: () => void } {
  FakeAudio.instances = [];
  FakeAudio.auto = true;
  const requested: string[] = [];
  const signals: AbortSignal[] = [];
  let failure: Error | null = null;
  let gate: Promise<void> | null = null;
  const fetchAudio = vi.fn(async (text: string, signal: AbortSignal) => {
    requested.push(text);
    signals.push(signal);
    if (gate) await gate;
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    if (failure) throw failure;
    return new Blob([text], { type: "audio/mpeg" });
  });
  const speech: FakeSpeech = {
    requested,
    fetchAudio,
    signals,
    audio: () => FakeAudio.instances[0],
    elements: () => FakeAudio.instances.length,
    failWith: (e) => (failure = e),
    hold: () => {
      let release!: () => void;
      gate = new Promise<void>((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
    startPlaying: () => speech.audio()?.emit("playing"),
    finishPlaying: () => speech.audio()?.finish(),
  };
  const prevAudio = window.Audio;
  const prevCreate = URL.createObjectURL;
  const prevRevoke = URL.revokeObjectURL;
  let n = 0;
  (window as unknown as { Audio: unknown }).Audio = FakeAudio;
  URL.createObjectURL = () => `blob:fake-${++n}`;
  URL.revokeObjectURL = () => {};
  return {
    speech,
    deps: {
      fetchAudio,
      createAudio: () => new FakeAudio() as unknown as HTMLAudioElement,
      createObjectURL: () => `blob:fake-${++n}`,
      revokeObjectURL: () => {},
      isSupported: () => true,
      analyze: async () => null,
    },
    restore: () => {
      (window as unknown as { Audio: unknown }).Audio = prevAudio;
      URL.createObjectURL = prevCreate;
      URL.revokeObjectURL = prevRevoke;
    },
  };
}
