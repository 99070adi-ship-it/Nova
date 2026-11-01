import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { framesRevealedBy, narrationTiming, revealFrames, setNarrationTiming, Typewriter } from "./typewriter";

describe("revealFrames — what appears at each tick", () => {
  it("one tick per visible character; a very short message is just a couple of ticks", () => {
    expect(revealFrames("Hi")).toEqual([1, 2]);
    expect(revealFrames("")).toEqual([]);
  });

  it("spaces cost no tick of their own: they arrive together with the next character", () => {
    expect(revealFrames("a b")).toEqual([1, 3]);
    expect(revealFrames("hello world")).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11]);
  });

  it("line breaks are handled like spaces and are preserved in the revealed text", () => {
    const text = "One.\nTwo.";
    const frames = revealFrames(text);
    expect(frames).toHaveLength(8); // O n e . T w o .
    expect(text.slice(0, frames[3])).toBe("One.");
    expect(text.slice(0, frames[4])).toBe("One.\nT"); // the newline lands with the next character
    expect(revealFrames("a\n\n\nb")).toEqual([1, 5]);
  });

  it("punctuation is an ordinary character (no added pauses)", () => {
    expect(revealFrames("Hi, you.")).toEqual([1, 2, 3, 5, 6, 7, 8]);
  });

  it("trailing whitespace is folded into the last tick, so the text always ends exactly complete", () => {
    expect(revealFrames("end  \n")).toEqual([1, 2, 6]);
  });

  it("never splits a character: emoji appear whole", () => {
    const text = "a😀b";
    const frames = revealFrames(text);
    expect(frames).toEqual([1, 3, 4]);
    expect(text.slice(0, frames[1])).toBe("a😀");
  });
});

describe("narration speed", () => {
  it("defaults to 6 characters per second (167 ms per character)", async () => {
    vi.resetModules();
    const fresh = await import("./typewriter"); // a fresh copy, before the test setup shrinks the cadence
    expect(fresh.narrationTiming.charMs).toBe(167);
    expect(Math.round(1000 / fresh.narrationTiming.charMs)).toBe(6);
  });
});

describe("Typewriter", () => {
  let updates: Array<[string, boolean]>;
  let tw: Typewriter;
  const text = () => updates[updates.length - 1]?.[0] ?? "";

  beforeEach(() => {
    vi.useFakeTimers();
    setNarrationTiming({ charMs: 167 });
    updates = [];
    tw = new Typewriter((typed, typing) => updates.push([typed, typing]));
  });
  afterEach(() => {
    vi.useRealTimers();
    setNarrationTiming({ charMs: 1 });
    vi.unstubAllGlobals();
  });

  it("starts at once and then adds one character every 167 ms (6 characters per second)", async () => {
    void tw.play("Hello world");
    expect(text()).toBe("H"); // available immediately, no initial delay
    await vi.advanceTimersByTimeAsync(166);
    expect(text()).toBe("H");
    await vi.advanceTimersByTimeAsync(1);
    expect(text()).toBe("He");
    // One second in: the first character plus six ticks = 7 characters ("Hello w").
    await vi.advanceTimersByTimeAsync(1000 - 167);
    expect(text().replace(/\s/g, "").length).toBe(6);
  });

  it("finishes exactly when the last character appears; no delay is added after it", async () => {
    let done = false;
    void tw.play("Hello").then(() => (done = true));
    await vi.advanceTimersByTimeAsync(667);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1); // 4 ticks after the first character (4 × 167 = 668 ms)
    expect(done).toBe(true);
    expect(updates[updates.length - 1]).toEqual(["Hello", false]);
  });

  it("a very short message finishes quickly", async () => {
    let done = false;
    void tw.play("Hi").then(() => (done = true));
    await vi.advanceTimersByTimeAsync(167);
    expect(done).toBe(true);
    let single = false;
    void tw.play("Z").then(() => (single = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(single).toBe(true); // one character: done immediately
  });

  it("reveals every prefix exactly once and in order: no duplicated or skipped characters", async () => {
    void tw.play("Hi there\nbye");
    await vi.advanceTimersByTimeAsync(10000);
    const shown = updates.filter(([, typing]) => typing).map(([t]) => t);
    const expected = revealFrames("Hi there\nbye").map((n) => "Hi there\nbye".slice(0, n));
    expect(shown.slice(0, expected.length - 1)).toEqual(expected.slice(0, -1));
    expect(new Set(shown).size).toBe(shown.length); // no repeated frames
    expect(text()).toBe("Hi there\nbye");
  });

  it("a long message takes proportionally longer (visible characters × 167 ms)", async () => {
    const long = "word ".repeat(10).trim(); // 40 visible characters
    let doneAt = -1;
    const t0 = Date.now();
    void tw.play(long).then(() => (doneAt = Date.now() - t0));
    await vi.advanceTimersByTimeAsync(20000);
    expect(doneAt).toBe((40 - 1) * 167);
  });

  it("replacing the message cancels the old reveal: no stale characters, no mixing", async () => {
    const first = tw.play("AAAAAAAAAA");
    await vi.advanceTimersByTimeAsync(334);
    expect(text()).toBe("AAA");
    const second = tw.play("Brand new");
    expect(await first).toBe(false); // the replaced reveal is released, not left hanging
    expect(text()).toBe("B");
    await vi.advanceTimersByTimeAsync(10000);
    expect(await second).toBe(true);
    expect(text()).toBe("Brand new");
    // At no point did any frame contain characters from both messages.
    for (const [t] of updates.slice(updates.findIndex(([x]) => x === "B"))) expect(t).not.toMatch(/A/);
  });

  it("cancel() stops all pending work: nothing is typed afterwards and waiters are released", async () => {
    const p = tw.play("Hello world");
    await vi.advanceTimersByTimeAsync(167);
    tw.cancel();
    expect(await p).toBe(false);
    const countAfter = updates.length;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(updates.length).toBe(countAfter);
  });

  it("a message that grows continues in place; it does not restart or repeat what was already shown", async () => {
    void tw.play("Hello");
    await vi.advanceTimersByTimeAsync(334);
    expect(text()).toBe("Hel");
    const grown = tw.play("Hello, world");
    await vi.advanceTimersByTimeAsync(10000);
    expect(await grown).toBe(true);
    const shown = updates.filter(([, typing]) => typing).map(([t]) => t);
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown.indexOf("Hel")).toBe(shown.lastIndexOf("Hel"));
    expect(text()).toBe("Hello, world");
  });

  it("the same text again is not retyped", async () => {
    void tw.play("Hello");
    await vi.advanceTimersByTimeAsync(2000);
    const count = updates.length;
    expect(await tw.play("Hello")).toBe(true);
    expect(updates.length).toBe(count);
  });

  it("respects reduced motion: the full text appears at once and the sequence continues immediately", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    let done = false;
    void tw.play("A whole sentence appears together.").then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(text()).toBe("A whole sentence appears together.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("skip() reveals the rest at once and releases the sequence (no waiting out a slow message)", async () => {
    let done = false;
    void tw.play("A fairly long sentence to type.").then((v) => (done = v));
    await vi.advanceTimersByTimeAsync(500);
    expect(done).toBe(false);
    tw.skip();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(text()).toBe("A fairly long sentence to type.");
    expect(vi.getTimerCount()).toBe(0);
    tw.skip(); // harmless when nothing is pending
  });

  it("the only timing the narration has is the per-character cadence: no reading, settle or beat timers", () => {
    expect(Object.keys(narrationTiming)).toEqual(["charMs"]);
  });
});

describe("Typewriter driven by the audio (playSynced)", () => {
  let updates: Array<[string, boolean]>;
  let tw: Typewriter;
  let position: number | null;
  const text = () => updates[updates.length - 1]?.[0] ?? "";
  const speech = "Check the details, then continue.";

  beforeEach(() => {
    vi.useFakeTimers();
    setNarrationTiming({ charMs: 167 });
    updates = [];
    position = 0;
    tw = new Typewriter((typed, typing) => updates.push([typed, typing]));
  });
  afterEach(() => {
    vi.useRealTimers();
    setNarrationTiming({ charMs: 1 });
    vi.unstubAllGlobals();
  });
  const tick = (ms = 40) => vi.advanceTimersByTimeAsync(ms);

  it("shows exactly the part that has been spoken: the text follows the audio, not a fixed cadence", async () => {
    void tw.playSynced(speech, () => position);
    await tick();
    expect(text()).toBe("");
    position = 5;
    await tick();
    expect(text()).toBe("Check");
    position = 18; // "Check the details,"
    await tick();
    expect(text()).toBe("Check the details,");
    // a whole second passes with no audio progress: no text appears by itself
    await tick(1000);
    expect(text()).toBe("Check the details,");
  });

  it("is independent of the 6 cps cadence: a fast clip reveals fast, a slow clip slowly", async () => {
    void tw.playSynced(speech, () => position);
    position = speech.length; // the whole clip "played" in an instant
    await tick();
    expect(text()).toBe(speech);
  });

  it("finishes with the audio: resolves true when the audio reaches the end, never before", async () => {
    let done = false;
    void tw.playSynced(speech, () => position).then((r) => (done = r));
    position = speech.length - 3;
    await tick();
    expect(done).toBe(false);
    expect(text()).not.toBe(speech);
    position = speech.length;
    await tick();
    expect(done).toBe(true);
    expect(updates[updates.length - 1]).toEqual([speech, false]);
  });

  it("pause freezes the text and resume continues it from the same place", async () => {
    void tw.playSynced(speech, () => position);
    position = 11;
    await tick();
    const frozen = text();
    await tick(3000); // audio paused: position does not move
    expect(text()).toBe(frozen);
    position = 20;
    await tick();
    expect(text().length).toBeGreaterThan(frozen.length);
    expect(speech.startsWith(text())).toBe(true);
  });

  it("never goes backwards, even if the reported position momentarily does", async () => {
    void tw.playSynced(speech, () => position);
    position = 18;
    await tick();
    const before = text();
    position = 4;
    await tick();
    expect(text()).toBe(before);
  });

  it("if the audio goes away mid-way (muted, failed) the rest types at the normal pace from where it was, with no restart or duplication", async () => {
    let done = false;
    void tw.playSynced(speech, () => position).then((r) => (done = r));
    position = 18;
    await tick();
    const reached = text();
    position = null;
    await tick(10);
    expect(speech.startsWith(text())).toBe(true);
    expect(text().length).toBeGreaterThanOrEqual(reached.length);
    expect(done).toBe(false);
    await tick(167 * 40); // ordinary cadence finishes it
    expect(done).toBe(true);
    expect(text()).toBe(speech);
    // every update was a prefix of the message, and lengths never decreased: nothing repeated
    let last = 0;
    for (const [t] of updates) {
      expect(speech.startsWith(t)).toBe(true);
      expect(t.length).toBeGreaterThanOrEqual(last);
      last = t.length;
    }
  });

  it("hold() waits for the audio: nothing is revealed until playSynced is called", async () => {
    tw.hold();
    expect(updates[updates.length - 1]).toEqual(["", true]);
    await tick(2000);
    expect(text()).toBe("");
    expect(tw.active).toBe(true);
  });

  it("a replaced reveal releases its waiter with false and never updates the screen again", async () => {
    const first = tw.playSynced(speech, () => position);
    position = 5;
    await tick();
    const second = tw.playSynced("Next one.", () => 9);
    await expect(first).resolves.toBe(false);
    await tick();
    expect(text()).toBe("Next one.");
    await expect(second).resolves.toBe(true);
    const count = updates.length;
    position = 30; // the old narration's audio position can no longer touch the UI
    await tick(500);
    expect(updates.length).toBe(count);
  });

  it("cancel() stops following the audio at once", async () => {
    const waiting = tw.playSynced(speech, () => position);
    position = 5;
    await tick();
    tw.cancel();
    await expect(waiting).resolves.toBe(false);
    const count = updates.length;
    position = 30;
    await tick(500);
    expect(updates.length).toBe(count);
  });

  it("skip() reveals everything and resolves, even while following the audio", async () => {
    const waiting = tw.playSynced(speech, () => position);
    position = 5;
    await tick();
    tw.skip();
    await expect(waiting).resolves.toBe(true);
    expect(text()).toBe(speech);
  });

  it("restart() + resume() is Replay: the text goes back to empty and follows the new playback; the original waiter still completes", async () => {
    let done = false;
    void tw.playSynced(speech, () => position).then((r) => (done = r));
    position = 18;
    await tick();
    expect(text()).toBe("Check the details,");
    tw.restart();
    expect(text()).toBe("");
    expect(done).toBe(false);
    position = 0;
    void tw.resume(() => position);
    await tick();
    expect(text()).toBe("");
    position = 5;
    await tick();
    expect(text()).toBe("Check");
    position = speech.length;
    await tick();
    expect(text()).toBe(speech);
    expect(done).toBe(true);
  });

  it("resume(null) after restart types the same text again at the normal pace (Replay without audio)", async () => {
    void tw.play("Hi there");
    await tick(167 * 10);
    tw.restart();
    expect(text()).toBe("");
    const finished = tw.resume(null);
    await tick(167 * 10);
    await expect(finished).resolves.toBe(true);
    expect(text()).toBe("Hi there");
  });

  it("under reduced motion the whole text appears at once", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    const waiting = tw.playSynced(speech, () => 0);
    await expect(waiting).resolves.toBe(true);
    expect(text()).toBe(speech);
  });

  it("framesRevealedBy counts whole reveal frames up to a spoken position", () => {
    const frames = revealFrames("a bc");
    expect(framesRevealedBy(frames, 0)).toBe(0);
    expect(framesRevealedBy(frames, 1)).toBe(1);
    expect(framesRevealedBy(frames, 2)).toBe(1); // the space arrives together with "b", not on its own
    expect(framesRevealedBy(frames, 3)).toBe(2);
    expect(framesRevealedBy(frames, 4)).toBe(3);
  });
});
