import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type NovaLessonVoice, useNovaLesson } from "./useNovaLesson";

afterEach(() => cleanup());

const BEATS = ["Hey, I'm NOVA.", "I run your store.", "Let's go."];
const INTRO = "Meet VELORA.";

const config = (extra: Record<string, unknown> = {}) => ({
  demoActions: [],
  introNarration: async () => INTRO,
  explainNarration: async () => "Your turn.",
  verify: vi.fn().mockResolvedValue(false),
  completeNarration: async () => "Done.",
  pollMs: 1000,
  beatGapMs: 5,
  ...extra,
});

function mount(extra: Record<string, unknown> = {}) {
  const cfg = config(extra);
  const messages: string[] = [];
  const beats: Array<{ index: number; total: number } | null> = [];
  const hook = renderHook(() => {
    const r = useNovaLesson(cfg as never);
    if (messages[messages.length - 1] !== r.message && r.message) messages.push(r.message);
    if (JSON.stringify(beats[beats.length - 1]) !== JSON.stringify(r.beat)) beats.push(r.beat);
    return r;
  });
  act(() => void hook.result.current.start());
  return Object.assign(hook, { messages, beats, cfg });
}

describe("NOVA's opening, beat by beat, before the step's own introduction", () => {
  it("shows each beat in order, then the step intro, then the rest of the step; the opening is reported done once", async () => {
    const onPreambleDone = vi.fn();
    const { result, messages, beats } = mount({ preamble: BEATS, onPreambleDone });
    await waitFor(() => expect(result.current.phase).toBe("user_turn"));
    expect(messages.slice(0, 5)).toEqual([...BEATS, INTRO, "Your turn."]);
    expect(beats.filter(Boolean).map((b) => b!.index)).toEqual([0, 1, 2]); // 1 of 3, 2 of 3, 3 of 3
    expect(beats[beats.length - 1]).toBeNull(); // the opening is over once the step begins
    expect(onPreambleDone).toHaveBeenCalledTimes(1);
  });

  it("each beat is typed in full before the next begins (nothing overlaps or is skipped)", async () => {
    const typed: string[] = [];
    const cfg = config({ preamble: BEATS });
    const hook = renderHook(() => {
      const r = useNovaLesson(cfg as never);
      if (r.typedMessage && typed[typed.length - 1] !== r.typedMessage) typed.push(r.typedMessage);
      return r;
    });
    act(() => void hook.result.current.start());
    await waitFor(() => expect(hook.result.current.phase).toBe("user_turn"));
    for (const beat of BEATS) expect(typed).toContain(beat);
  });

  it("Skip intro ends the opening at once: the current beat completes and the step begins", async () => {
    const onPreambleDone = vi.fn();
    const { result, messages } = mount({ preamble: BEATS, onPreambleDone, beatGapMs: 2000 });
    await waitFor(() => expect(messages).toContain(BEATS[0]));
    act(() => result.current.skipPreamble());
    await waitFor(() => expect(result.current.phase).toBe("user_turn"), { timeout: 8000 });
    expect(messages).not.toContain(BEATS[2]); // the remaining beats never played
    expect(messages).toContain(INTRO);
    expect(onPreambleDone).toHaveBeenCalledTimes(1);
  });

  it("without a preamble the lesson starts exactly as before", async () => {
    const { result, messages, beats } = mount();
    await waitFor(() => expect(result.current.phase).toBe("user_turn"));
    expect(messages[0]).toBe(INTRO);
    expect(beats.filter(Boolean)).toHaveLength(0);
  });

  it("with voice, the next beat's audio is fetched while the current one plays, so beats follow without a gap", async () => {
    const prefetched: string[] = [];
    const voice: NovaLessonVoice = {
      enabled: () => true,
      speak: vi.fn(() => new Promise<"playing" | "unavailable">(() => {})), // never starts: we only look at the order of requests
      replay: vi.fn(),
      cancel: vi.fn(),
      prefetch: (t: string) => prefetched.push(t),
      position: () => null,
    };
    mount({ preamble: BEATS, voice, voiceStartTimeoutMs: 5000 });
    await waitFor(() => expect(prefetched).toEqual([BEATS[1]]));
  });

  it("with voice, every beat is spoken in order and the text follows the audio (no extra Text-only gap)", async () => {
    let position: number | null = null;
    let resolveStart: ((v: "playing" | "unavailable") => void) | null = null;
    const spoken: string[] = [];
    const voice: NovaLessonVoice = {
      enabled: () => true,
      speak: vi.fn((t: string) => {
        spoken.push(t);
        position = null;
        return new Promise<"playing" | "unavailable">((r) => (resolveStart = r));
      }),
      replay: vi.fn(),
      cancel: vi.fn(),
      position: () => position,
    };
    const { result } = mount({ preamble: BEATS, voice });
    for (const beat of BEATS) {
      await waitFor(() => expect(spoken[spoken.length - 1]).toBe(beat));
      act(() => {
        position = 0;
        resolveStart?.("playing");
      });
      act(() => {
        position = beat.length; // the audio reached the end of this beat
      });
    }
    await waitFor(() => expect(spoken[spoken.length - 1]).toBe(INTRO));
    expect(spoken.slice(0, 3)).toEqual(BEATS);
    void result;
  });
});
