import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type NovaLessonVoice, useNovaLesson } from "./useNovaLesson";
import { revealFrames } from "../lib/typewriter";

// The lesson drives text and audio together. Here the voice is SCRIPTED: the test decides exactly when
// "audio starts" and how far it has "played", so every assertion about synchronisation is deterministic.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const INTRO = "First, your brand. Watch me fill it in.";
const EXPLAIN = "Check the details, then continue.";

function scriptedVoice() {
  let position: number | null = null;
  let start: ((v: "playing" | "unavailable") => void) | null = null;
  const begin = () =>
    new Promise<"playing" | "unavailable">((resolve) => {
      start = resolve;
    });
  const voice: NovaLessonVoice & { speak: ReturnType<typeof vi.fn>; replay: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } = {
    enabled: () => true,
    speak: vi.fn(() => begin()),
    replay: vi.fn(() => begin()),
    cancel: vi.fn(() => {
      position = null;
      start?.("unavailable");
    }),
    position: () => position,
  };
  return {
    voice,
    /** The audio becomes audible. */
    play() {
      position = 0;
      start?.("playing");
    },
    /** The audio has played up to this many characters of the narration. */
    at(n: number | null) {
      position = n;
    },
    /** The audio cannot start (blocked, failed). */
    cannotStart() {
      start?.("unavailable");
    },
  };
}

const config = (voice: NovaLessonVoice | undefined, extra: Record<string, unknown> = {}) => ({
  demoActions: [],
  introNarration: async () => INTRO,
  explainNarration: async () => EXPLAIN,
  verify: vi.fn().mockResolvedValue(false),
  completeNarration: async () => "Done.",
  pollMs: 1000,
  voice,
  ...extra,
});

/** The text the typewriter should show when `n` characters have been spoken. */
const shownAt = (text: string, n: number) => {
  const frames = revealFrames(text).filter((f) => f <= n);
  return frames.length ? text.slice(0, frames[frames.length - 1]) : "";
};

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

function mount(voice: NovaLessonVoice | undefined, extra: Record<string, unknown> = {}) {
  const cfg = config(voice, extra);
  // Every value the visible text ever took: once a narration is complete the next one replaces it
  // within a frame, so "it was fully shown" is asserted from the history, not from a moment in time.
  const history: string[] = [];
  const hook = renderHook(() => {
    const r = useNovaLesson(cfg as never);
    history.push(r.typedMessage);
    return r;
  });
  act(() => void hook.result.current.start());
  return Object.assign(hook, { history });
}

describe("narration text and audio begin together and move together", () => {
  it("nothing is revealed until the audio is playing; the voice is asked for the very same text", async () => {
    const s = scriptedVoice();
    const { result, history } = mount(s.voice);
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalledWith(INTRO));
    await wait(100);
    expect(result.current.message).toBe(INTRO); // the full text is known at once (assistive tech)
    expect(result.current.typedMessage).toBe(""); // but nothing is shown before the voice starts
    expect(result.current.isTyping).toBe(true);
    act(() => s.play());
    await wait(60);
    expect(result.current.typedMessage).toBe(""); // audio is at 0: still nothing
    act(() => s.at(5));
    await waitFor(() => expect(result.current.typedMessage).toBe(shownAt(INTRO, 5)));
  });

  it("the reveal tracks the audio's playback, not a fixed cadence", async () => {
    const s = scriptedVoice();
    const { result, history } = mount(s.voice);
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalled());
    act(() => s.play());
    const seen: string[] = [];
    for (const n of [4, 11, 18, 26, 33]) {
      act(() => s.at(n));
      await waitFor(() => expect(result.current.typedMessage).toBe(shownAt(INTRO, n)));
      seen.push(result.current.typedMessage);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i].startsWith(seen[i - 1])).toBe(true);
    expect(result.current.phase).toBe("intro"); // still being spoken: the sequence has not moved on
  });

  it("pausing the audio freezes the text; resuming continues it", async () => {
    const s = scriptedVoice();
    const { result, history } = mount(s.voice);
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalled());
    act(() => s.play());
    act(() => s.at(12));
    await waitFor(() => expect(result.current.typedMessage).toBe(shownAt(INTRO, 12)));
    const frozen = result.current.typedMessage;
    await wait(250); // audio paused: position does not move
    expect(result.current.typedMessage).toBe(frozen);
    act(() => s.at(22));
    await waitFor(() => expect(result.current.typedMessage).toBe(shownAt(INTRO, 22)));
  });

  it("the sequence moves on exactly when the audio reaches the end of the narration", async () => {
    const s = scriptedVoice();
    const { result, history } = mount(s.voice);
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalledTimes(1));
    act(() => s.play());
    act(() => s.at(INTRO.length - 4));
    await wait(150);
    expect(result.current.phase).toBe("intro");
    expect(result.current.typedMessage).not.toBe(INTRO);
    act(() => s.at(INTRO.length)); // the audio finished
    await waitFor(() => expect(history).toContain(INTRO));
    // the next narration (the explanation) is then spoken the same way
    await waitFor(() => expect(s.voice.speak).toHaveBeenLastCalledWith(EXPLAIN));
    expect(result.current.message).toBe(EXPLAIN);
    expect(result.current.typedMessage).toBe(""); // new message: waits for its own audio
  });

  it("each narration waits for its own audio: a step change never reuses the previous timeline", async () => {
    const s = scriptedVoice();
    const { result, history } = mount(s.voice);
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalledTimes(1));
    act(() => s.play());
    act(() => s.at(INTRO.length));
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalledTimes(2));
    // the old position (the full intro length) is still what the engine reports until it is replaced...
    act(() => s.at(null)); // ...the new narration's audio has not started: no position
    await wait(150);
    expect(result.current.typedMessage).toBe("");
    act(() => s.play());
    act(() => s.at(5));
    await waitFor(() => expect(result.current.typedMessage).toBe(shownAt(EXPLAIN, 5)));
  });
});

describe("when the audio cannot start", () => {
  it("falls back to typing at the normal pace; the voice is never waited for", async () => {
    const s = scriptedVoice();
    const { result, history } = mount(s.voice);
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalled());
    act(() => s.cannotStart()); // e.g. blocked by the browser: do not animate as if audio were playing
    await waitFor(() => expect(history).toContain(INTRO));
    await waitFor(() => expect(result.current.phase).toBe("explain"));
  });

  it("gives up on audio that never arrives after the start grace, cancels it, and types normally", async () => {
    const s = scriptedVoice();
    const { result, history } = mount(s.voice, { voiceStartTimeoutMs: 120 });
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalled());
    await wait(60);
    expect(result.current.typedMessage).toBe(""); // still waiting for audio
    await waitFor(() => expect(history).toContain(INTRO));
    expect(s.voice.cancel).toHaveBeenCalled(); // a late start can no longer talk over the text
  });

  it("audio that fails mid-way does not strand the text: the rest types on from where it was, nothing repeated", async () => {
    const s = scriptedVoice();
    const { result, history } = mount(s.voice);
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalled());
    act(() => s.play());
    act(() => s.at(10));
    await waitFor(() => expect(result.current.typedMessage).toBe(shownAt(INTRO, 10)));
    act(() => s.at(null)); // the audio is gone
    await waitFor(() => expect(history).toContain(INTRO));
    // every value was a growing prefix of the message: nothing repeated or restarted
    const own = history.slice(history.indexOf(shownAt(INTRO, 10)));
    const intro = own.slice(0, own.indexOf(INTRO) + 1);
    for (let i = 1; i < intro.length; i++) expect(intro[i].startsWith(intro[i - 1])).toBe(true);
  });

  it("muting mid-narration (voice cancelled) lets the text finish by itself", async () => {
    const s = scriptedVoice();
    const { result, history } = mount(s.voice);
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalled());
    act(() => s.play());
    act(() => s.at(8));
    await waitFor(() => expect(result.current.typedMessage).toBe(shownAt(INTRO, 8)));
    act(() => s.voice.cancel()); // what muting does
    await waitFor(() => expect(history).toContain(INTRO));
  });
});

describe("Text only and reduced motion", () => {
  it("without voice the typing is independent, and nothing is ever spoken", async () => {
    const voice = scriptedVoice().voice;
    voice.enabled = () => false;
    const { result, history } = mount(voice);
    await waitFor(() => expect(history).toContain(INTRO));
    expect(voice.speak).not.toHaveBeenCalled();
  });

  it("a lesson with no voice at all is unchanged", async () => {
    const { result, history } = mount(undefined);
    await waitFor(() => expect(history).toContain(INTRO));
  });

  it("under reduced motion the whole text is shown at once while the voice speaks it; nothing waits for the audio", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    const s = scriptedVoice(); // audio never starts
    const { result, history } = mount(s.voice);
    await waitFor(() => expect(history).toContain(INTRO));
    expect(s.voice.speak).toHaveBeenCalledWith(INTRO);
    await waitFor(() => expect(result.current.phase).toBe("user_turn")); // both messages passed without waiting for audio
    expect(s.voice.speak).toHaveBeenCalledWith(EXPLAIN);
  });
});

describe("Replay, Skip, and stale work", () => {
  it("Replay resets the text and the audio together, then they run together again; the lesson still completes the step normally", async () => {
    const s = scriptedVoice();
    const { result, history } = mount(s.voice);
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalledTimes(1));
    act(() => s.play());
    act(() => s.at(20));
    await waitFor(() => expect(result.current.typedMessage).toBe(shownAt(INTRO, 20)));

    await act(async () => void result.current.replay());
    expect(s.voice.replay).toHaveBeenCalledWith(INTRO);
    expect(result.current.typedMessage).toBe(""); // the text went back with the audio
    await wait(100);
    expect(result.current.typedMessage).toBe(""); // waiting for the replayed audio to actually start
    act(() => s.play());
    act(() => s.at(7));
    await waitFor(() => expect(result.current.typedMessage).toBe(shownAt(INTRO, 7)));
    act(() => s.at(INTRO.length));
    await waitFor(() => expect(history).toContain(INTRO));
    await waitFor(() => expect(s.voice.speak).toHaveBeenLastCalledWith(EXPLAIN)); // sequence continued
  });

  it("Replay while the audio has not started yet is ignored (it is about to be spoken from the start anyway)", async () => {
    const s = scriptedVoice();
    const { result, history } = mount(s.voice);
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalled());
    await act(async () => void result.current.replay());
    expect(s.voice.replay).not.toHaveBeenCalled();
  });

  it("if replayed audio is blocked, the text is typed again at the normal pace instead of pretending", async () => {
    const s = scriptedVoice();
    const { result, history } = mount(s.voice);
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalledTimes(1));
    act(() => s.play());
    act(() => s.at(INTRO.length));
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalledTimes(2));
    act(() => s.at(null));
    act(() => s.play());
    act(() => s.at(EXPLAIN.length));
    await waitFor(() => expect(history).toContain(EXPLAIN));
    await act(async () => void result.current.replay());
    expect(result.current.typedMessage).toBe("");
    act(() => s.cannotStart());
    await waitFor(() => expect(history).toContain(EXPLAIN));
  });

  it("Skip shows the whole message at once and silences the voice, even before the audio began", async () => {
    const s = scriptedVoice();
    const { result, history } = mount(s.voice);
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalled());
    act(() => result.current.skipTyping()); // audio has not started yet
    expect(s.voice.cancel).toHaveBeenCalled();
    await waitFor(() => expect(history).toContain(INTRO));
    await waitFor(() => expect(result.current.phase).toBe("explain"));
  });

  it("Skip while following the audio reveals the rest and stops the audio", async () => {
    const s = scriptedVoice();
    const { result, history } = mount(s.voice);
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalled());
    act(() => s.play());
    act(() => s.at(9));
    await waitFor(() => expect(result.current.typedMessage).toBe(shownAt(INTRO, 9)));
    act(() => result.current.skipTyping());
    await waitFor(() => expect(history).toContain(INTRO));
    expect(s.voice.cancel).toHaveBeenCalled();
  });

  it("unmounting stops following the audio and cancels it; a late position can no longer update anything", async () => {
    const s = scriptedVoice();
    const hook = mount(s.voice);
    await waitFor(() => expect(s.voice.speak).toHaveBeenCalled());
    act(() => s.play());
    act(() => s.at(6));
    await waitFor(() => expect(hook.result.current.typedMessage).toBe(shownAt(INTRO, 6)));
    const calls = vi.spyOn(s.voice, "position");
    hook.unmount();
    expect(s.voice.cancel).toHaveBeenCalled();
    calls.mockClear();
    s.at(30);
    await new Promise((r) => setTimeout(r, 150));
    expect(calls).not.toHaveBeenCalled(); // nothing is polling the old narration any more
  });

  it("toggling voice on mid-typing can restart text and audio together (replay with resetText)", async () => {
    const voice = scriptedVoice();
    let enabled = false;
    voice.voice.enabled = () => enabled;
    const { result, history } = mount(voice.voice);
    await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
    await waitFor(() => expect(result.current.isTyping || result.current.typedMessage === INTRO).toBe(true));
    enabled = true;
    await act(async () => void result.current.replay({ resetText: true }));
    expect(voice.voice.replay).toHaveBeenCalledWith(INTRO);
  });
});
