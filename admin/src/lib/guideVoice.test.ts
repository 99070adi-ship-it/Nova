import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeWav, chunkRanges, loadGuideVoiceMode, NovaVoice, saveGuideVoiceMode, splitIntoChunks, spokenOffset } from "./guideVoice";
import { FakeAudio, installFakeSpeech, type FakeSpeech } from "../test/fakeSpeech";

let speech: FakeSpeech;
let deps: Record<string, unknown>;
let restore: () => void;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
};
const make = () => new NovaVoice(deps as never);

beforeEach(() => {
  ({ speech, deps, restore } = installFakeSpeech());
  FakeAudio.auto = false; // these tests script the audio timeline themselves
});
afterEach(() => restore());

describe("NovaVoice (engine driven against a faked backend + <audio>)", () => {
  it("asks the backend for exactly the given text, plays it, and reports speaking only while audio is playing", async () => {
    const v = make();
    v.speak("Hello there.");
    await settle();
    expect(speech.requested).toEqual(["Hello there."]);
    expect(speech.audio()?.playCalls).toBe(1);
    expect(v.speaking).toBe(false); // play() was requested, but nothing is audible yet
    speech.startPlaying();
    expect(v.speaking).toBe(true);
    speech.finishPlaying();
    await settle();
    expect(v.speaking).toBe(false);
  });

  it("never plays two narrations at once: a new one aborts and silences the previous", async () => {
    const v = make();
    v.speak("First.");
    await settle();
    speech.startPlaying();
    expect(v.speaking).toBe(true);
    v.speak("Second.");
    expect(speech.signals[0].aborted).toBe(true);
    expect(v.speaking).toBe(false);
    await settle();
    expect(speech.requested).toEqual(["First.", "Second."]);
    expect(speech.audio()?.playCalls).toBe(2);
    expect(speech.elements()).toBe(1); // one element is reused for everything
  });

  it("a narration replaced while its audio is still being fetched is never played", async () => {
    const release = speech.hold();
    const v = make();
    v.speak("Slow one.");
    v.speak("Fast one.");
    release();
    await settle();
    expect(speech.audio()?.playCalls).toBe(1);
    expect(v.speaking).toBe(false);
    speech.startPlaying();
    expect(v.speaking).toBe(true);
  });

  it("does not start the same text twice while it is being spoken, but Replay does", async () => {
    const v = make();
    v.speak("Same.");
    v.speak("Same.");
    await settle();
    expect(speech.requested).toEqual(["Same."]);
    v.replay();
    await settle();
    expect(speech.audio()?.playCalls).toBe(2);
  });

  it("replaying a message reuses the audio already fetched (no second request, no extra cost)", async () => {
    const v = make();
    v.speak("Cached.");
    await settle();
    v.replay();
    await settle();
    expect(speech.requested).toEqual(["Cached."]);
    expect(speech.audio()?.playCalls).toBe(2);
  });

  it("cancel stops audio at once and aborts any request in flight", async () => {
    const release = speech.hold();
    const v = make();
    v.speak("Talking.");
    v.cancel();
    expect(speech.signals[0].aborted).toBe(true);
    release();
    await settle();
    expect(speech.audio()?.playCalls ?? 0).toBe(0);
    v.cancel(); // safe to repeat
  });

  it("cancelling during playback pauses the element and clears the speaking state", async () => {
    const v = make();
    v.speak("Talking.");
    await settle();
    speech.startPlaying();
    v.cancel();
    expect(speech.audio()?.paused).toBe(true);
    expect(v.speaking).toBe(false);
  });

  it("a backend failure marks voice failed (text carries on), and a later successful retry works", async () => {
    speech.failWith(new Error("503"));
    const v = make();
    v.speak("One.");
    await settle();
    expect(v.failed).toBe(true);
    const before = speech.requested.length;
    v.speak("Two.");
    await settle();
    expect(speech.requested.length).toBe(before); // does not hammer a failing service
    speech.failWith(null);
    v.resetFailure();
    v.speak("Three.");
    await settle();
    expect(speech.audio()?.playCalls).toBe(1);
  });

  it("an audio element error is a failure (text carries on)", async () => {
    const v = make();
    v.speak("Broken.");
    await settle();
    speech.audio()!.emit("error");
    await settle();
    expect(v.failed).toBe(true);
    expect(v.speaking).toBe(false);
  });

  it("NotAllowedError from play() is 'blocked' and Replay (a click) can recover", async () => {
    const v = make();
    v.speak("Hi.");
    await settle();
    v.cancel();
    const el = speech.audio()!;
    el.rejectWith = new DOMException("blocked", "NotAllowedError");
    v.speak("Needs a click.");
    await settle();
    expect(v.blocked).toBe(true);
    expect(v.failed).toBe(false);
    el.rejectWith = null;
    v.replay();
    await settle();
    speech.startPlaying();
    expect(v.blocked).toBe(false);
    expect(v.speaking).toBe(true);
  });

  it("prefetch fetches audio ahead without playing it, and the later speak() reuses it (no second request)", async () => {
    const v = make();
    v.prefetch("Next line.");
    await settle();
    expect(speech.requested).toEqual(["Next line."]);
    expect(speech.audio()?.playCalls ?? 0).toBe(0);
    v.speak("Next line.");
    await settle();
    expect(speech.requested).toEqual(["Next line."]);
    expect(speech.audio()?.playCalls).toBe(1);
  });

  it("prefetch is silent on failure and does nothing when unsupported or failed", async () => {
    speech.failWith(new Error("down"));
    const v = make();
    expect(() => v.prefetch("x")).not.toThrow();
    await settle();
    expect(v.failed).toBe(false); // a background fetch failing is not a voice failure
    const unsupported = new NovaVoice({ ...(deps as object), isSupported: () => false } as never);
    unsupported.prefetch("y");
    await settle();
    expect(speech.requested).toEqual(["x"]);
  });

  it("is a harmless no-op when the browser cannot play audio", async () => {
    const v = new NovaVoice({ ...(deps as object), isSupported: () => false } as never);
    expect(v.supported).toBe(false);
    v.speak("Nothing.");
    v.replay();
    v.cancel();
    await settle();
    expect(speech.requested).toEqual([]);
  });

  it("long text is requested as sentence-sized chunks, in order, the next while the first plays", async () => {
    const v = make();
    const a = "A".repeat(300) + ".";
    const b = "B".repeat(300) + ".";
    v.speak(`${a} ${b}`);
    await settle();
    expect(speech.requested).toEqual([a, b]); // second is already being prepared
    expect(speech.audio()?.playCalls).toBe(1);
    speech.finishPlaying();
    await settle();
    expect(speech.audio()?.playCalls).toBe(2);
    expect(speech.requested).toEqual([a, b]); // nothing extra requested
  });
});

describe("splitIntoChunks", () => {
  it("keeps normal narration whole (one request) and keeps sentences together", () => {
    expect(splitIntoChunks("First, your brand. Watch me fill it in.")).toEqual(["First, your brand. Watch me fill it in."]);
  });
  it("splits only at sentence boundaries and never mid-word", () => {
    const text = "One two three. Four five six. Seven eight nine.";
    expect(splitIntoChunks(text, 30)).toEqual(["One two three. Four five six.", "Seven eight nine."]);
    const long = "word ".repeat(40).trim() + ".";
    const parts = splitIntoChunks(long, 50, 20);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(50);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long);
  });
  it("caps the number of chunks at a whole-sentence boundary", () => {
    const text = Array.from({ length: 10 }, (_, i) => `Sentence number ${i}.`).join(" ");
    const parts = splitIntoChunks(text, 20, 3);
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p.endsWith(".")).toBe(true);
  });
});

// ---- timeline: what has been spoken, from the audio's real playback ----

/** A 16-bit mono WAV: `lead` s of silence, `speech` s of tone, `tail` s of silence. */
function wav(lead: number, speechS: number, tail: number, rate = 8000): Blob {
  const n = (sec: number) => Math.round(sec * rate);
  const samples = new Int16Array(n(lead) + n(speechS) + n(tail));
  for (let i = n(lead); i < n(lead) + n(speechS); i++) samples[i] = Math.round(8000 * Math.sin(i / 5));
  const header = new DataView(new ArrayBuffer(44));
  const w = (o: number, t: string) => [...t].forEach((c, i) => header.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); header.setUint32(4, 36 + samples.byteLength, true); w(8, "WAVE"); w(12, "fmt ");
  header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, rate, true); header.setUint32(28, rate * 2, true); header.setUint16(32, 2, true);
  header.setUint16(34, 16, true); w(36, "data"); header.setUint32(40, samples.byteLength, true);
  return new Blob([header.buffer, samples.buffer], { type: "audio/wav" });
}

describe("analyzeWav", () => {
  it("finds the clip's duration and where the speech actually starts and ends", async () => {
    const info = await analyzeWav(wav(0.2, 0.5, 0.3));
    expect(info!.duration).toBeCloseTo(1.0, 2);
    expect(info!.start).toBeGreaterThan(0.13);
    expect(info!.start).toBeLessThan(0.2);
    expect(info!.end).toBeGreaterThan(0.7);
    expect(info!.end).toBeLessThan(0.78);
  });
  it("returns null for anything that is not a 16-bit PCM WAV (callers fall back to the element's duration)", async () => {
    expect(await analyzeWav(new Blob(["not audio"]))).toBeNull();
  });
});

describe("spokenOffset — placing text within a clip", () => {
  const text = "One two. Three four five.";
  it("is 0 at the start and the full length at the end, and never goes backwards", () => {
    expect(spokenOffset(text, 0)).toBe(0);
    expect(spokenOffset(text, 1)).toBe(text.length);
    let last = 0;
    for (let f = 0; f <= 1; f += 0.01) {
      const o = spokenOffset(text, f);
      expect(o).toBeGreaterThanOrEqual(last);
      last = o;
    }
  });
  it("accounts for the pause at a sentence end: the first sentence is complete before the second begins", () => {
    // Weights: "One two." is 7.4 of 27.6 units, then a 5-unit pause before "Three" (which starts at 12.8).
    expect(text.slice(0, spokenOffset(text, 0.3)).trimEnd()).toBe("One two.");
    expect(text.slice(0, spokenOffset(text, 0.45)).trimEnd()).toBe("One two."); // inside the pause: nothing new appears
    expect(text.slice(0, spokenOffset(text, 0.8)).startsWith("One two. Three")).toBe(true);
  });
  it("a comma pause delays the words after it, and a trailing full stop adds no dead time at the end", () => {
    const t = "Hi, you there.";
    expect(spokenOffset(t, 0.99)).toBeLessThanOrEqual(t.length);
    expect(spokenOffset(t, 1)).toBe(t.length);
  });
});

describe("chunkRanges", () => {
  it("indexes into the ORIGINAL text (newlines and double spaces intact) and trims the edges", () => {
    const text = "  First one.\n\nSecond   one. ";
    const ranges = chunkRanges(text, 14);
    expect(ranges.map((r) => text.slice(r.start, r.end))).toEqual(["First one.", "Second   one."]);
  });
});

describe("NovaVoice timeline and start signal", () => {
  const narration = "Check the details, then continue.";
  const analyze = (info: { duration: number; start: number; end: number }) => async () => info;

  it("speak() resolves 'playing' only when the audio is actually playing — the moment text and voice both begin", async () => {
    const v = make();
    const started = v.speak(narration);
    let result: string | null = null;
    void started.then((r) => (result = r));
    await settle();
    expect(result).toBeNull(); // play() was called, but nothing is audible yet
    expect(v.position()).toBeNull();
    speech.startPlaying();
    await settle();
    expect(result).toBe("playing");
    expect(v.position()).toBe(0);
  });

  it("position() follows the audio's playback time through the narration and holds while it is paused", async () => {
    const v = new NovaVoice({ ...(deps as object), analyze: analyze({ duration: 3, start: 0.2, end: 2.8 }) } as never);
    v.speak(narration);
    await settle();
    const audio = speech.audio()!;
    audio.duration = 3;
    speech.startPlaying();
    audio.currentTime = 0.1; // still in the leading silence
    expect(v.position()).toBe(0);
    audio.currentTime = 1.5;
    const mid = v.position()!;
    expect(mid).toBeGreaterThan(5);
    expect(mid).toBeLessThan(narration.length);
    expect(narration.slice(0, mid).length).toBe(mid);
    // paused by something other than NOVA: the indicator stops, the position holds
    audio.paused = true;
    audio.emit("pause");
    expect(v.speaking).toBe(false);
    expect(v.position()).toBe(mid);
    audio.paused = false;
    speech.startPlaying();
    expect(v.speaking).toBe(true);
    audio.currentTime = 2.9;
    expect(v.position()).toBe(narration.length);
  });

  it("after the audio ends, position is the full text, so the text can complete exactly with the voice", async () => {
    const v = make();
    v.speak(narration);
    await settle();
    speech.startPlaying();
    speech.finishPlaying();
    await settle();
    expect(v.position()).toBe(narration.length);
  });

  it("is continuous across chunk boundaries: never backwards, no jump, no duplicated words, ends at the end", async () => {
    const v = new NovaVoice({ ...(deps as object), analyze: analyze({ duration: 2, start: 0, end: 2 }) } as never);
    const a = "A".repeat(300) + ".";
    const b = "B".repeat(300) + ".";
    const text = `${a} ${b}`;
    v.speak(text);
    await settle();
    const audio = speech.audio()!;
    speech.startPlaying();
    const seen: number[] = [];
    for (const t of [0, 0.5, 1.0, 1.9, 2.0]) {
      audio.currentTime = t;
      seen.push(v.position()!);
    }
    expect(seen[0]).toBe(0);
    expect(seen[4]).toBe(a.length); // end of the first chunk, before the second begins
    speech.finishPlaying(); // first chunk ends...
    await settle(); // ...second starts loading
    expect(v.position()).toBe(a.length + 1); // holds at the start of chunk 2 (after the space) while it loads
    expect(audio.playCalls).toBe(2);
    speech.startPlaying();
    audio.currentTime = 1.0;
    const mid = v.position()!;
    expect(mid).toBeGreaterThan(a.length + 1);
    expect(mid).toBeLessThan(text.length);
    speech.finishPlaying();
    await settle();
    expect(v.position()).toBe(text.length);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(speech.requested).toEqual([a, b]);
  });

  it("cancelling, replacing or failing ends the timeline: position is null and the start signal says 'unavailable'", async () => {
    const v = make();
    const first = v.speak(narration);
    await settle();
    speech.startPlaying();
    expect(v.position()).not.toBeNull();
    const second = v.speak("Something else.");
    expect(await first).toBe("playing"); // it did start; replacing it later does not change that
    expect(v.position()).toBeNull(); // the old timeline is gone; the new one has not started
    v.cancel();
    expect(await second).toBe("unavailable");

    speech.failWith(new Error("503"));
    const failing = v.speak("Will fail.");
    expect(await failing).toBe("unavailable");
    await settle();
    expect(v.failed).toBe(true);
    expect(v.position()).toBeNull();
  });

  it("a browser autoplay block reports 'unavailable' (text must not pretend the voice is playing)", async () => {
    const v = make();
    const el = new FakeAudio();
    el.rejectWith = new DOMException("blocked", "NotAllowedError");
    const blocked = new NovaVoice({ ...(deps as object), createAudio: () => el as never } as never);
    expect(await blocked.speak(narration)).toBe("unavailable");
    expect(blocked.blocked).toBe(true);
    expect(blocked.position()).toBeNull();
    expect(v.position()).toBeNull();
  });

  it("Replay restarts the timeline from the beginning", async () => {
    const v = make();
    v.speak(narration);
    await settle();
    speech.startPlaying();
    speech.audio()!.currentTime = 1;
    const replaying = v.replay();
    await settle();
    expect(v.position()).toBeNull(); // not playing again yet: the text must wait too
    speech.startPlaying();
    expect(await replaying).toBe("playing");
    expect(v.position()).toBe(0);
  });
});

describe("voice preference storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("is unset until chosen, then remembered", () => {
    expect(loadGuideVoiceMode("u1")).toBeNull();
    saveGuideVoiceMode("u1", "voice");
    expect(loadGuideVoiceMode("u1")).toBe("voice");
  });

  it("is per user: another person on the same device does not inherit it", () => {
    saveGuideVoiceMode("u1", "voice");
    expect(loadGuideVoiceMode("u2")).toBeNull();
    saveGuideVoiceMode("u2", "text");
    expect(loadGuideVoiceMode("u1")).toBe("voice");
  });

  it("treats a malformed stored value as not chosen", () => {
    window.localStorage.setItem("nova.guide.voice.v1:u1", "loud");
    expect(loadGuideVoiceMode("u1")).toBeNull();
  });

  it("survives blocked storage without throwing", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadGuideVoiceMode("u1")).toBeNull();
    expect(() => saveGuideVoiceMode("u1", "voice")).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});
