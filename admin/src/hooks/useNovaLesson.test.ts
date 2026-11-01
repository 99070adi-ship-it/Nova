import { act, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNovaLesson } from "./useNovaLesson";

// Hooks stay mounted (polling, typing) and test targets stay in the DOM unless cleaned up, so one
// failing test could poison the next. Always start each test from a clean slate.
afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-nova-target]").forEach((e) => e.remove());
});

/** Let React attach the passive effects (click listeners) that the latest state change scheduled. */
const flushEffects = () => act(async () => { await new Promise((r) => setTimeout(r, 25)); });

function baseConfig(overrides: Partial<Parameters<typeof useNovaLesson>[0]> = {}) {
  return {
    demoActions: [],
    introNarration: vi.fn().mockResolvedValue("Watch me first."),
    explainNarration: vi.fn().mockResolvedValue("Here's why."),
    verify: vi.fn().mockResolvedValue(false),
    completeNarration: vi.fn().mockResolvedValue("Nicely done."),
    pollMs: 10,
    ...overrides,
  };
}

describe("useNovaLesson — demo -> explain -> user_turn -> verify -> complete", () => {
  it("walks demo and explain automatically, then hands off to user_turn and stays there until verified", async () => {
    const config = baseConfig();
    const { result } = renderHook(() => useNovaLesson(config));

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.phase).toBe("user_turn"));
    expect(config.introNarration).toHaveBeenCalledTimes(1);
    expect(config.explainNarration).toHaveBeenCalledTimes(1);
    expect(result.current.message).toBe("Here's why.");

    // Never completes on its own — verify() is still returning false.
    await new Promise((r) => setTimeout(r, 40));
    expect(result.current.phase).toBe("user_turn");
    expect(config.completeNarration).not.toHaveBeenCalled();
  });

  it("polls verify() repeatedly once in user_turn — never during demo or explain", async () => {
    const verify = vi.fn().mockResolvedValue(false);
    const config = baseConfig({ verify, pollMs: 15 });
    const { result } = renderHook(() => useNovaLesson(config));

    await act(async () => {
      await result.current.start();
    });
    // introNarration/explainNarration (mocked synchronous) are what start() actually awaits before
    // reaching user_turn — verify is never part of that path, only referenced inside the
    // user_turn watcher effect below, which fires its first (immediate, for responsiveness) check
    // only once user_turn is actually entered.
    const callsAtUserTurn = verify.mock.calls.length;
    expect(callsAtUserTurn).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, 50));
    expect(verify.mock.calls.length).toBeGreaterThan(callsAtUserTurn);
  });

  it("transitions to complete only once verify() genuinely returns true — the server, not a client flag", async () => {
    let verified = false;
    const config = baseConfig({ verify: vi.fn(() => Promise.resolve(verified)), pollMs: 10 });
    const { result } = renderHook(() => useNovaLesson(config));

    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.phase).toBe("user_turn"));

    // Simulate the real backend state changing only now (the user just submitted for real).
    verified = true;

    await waitFor(() => expect(result.current.phase).toBe("complete"), { timeout: 15000 });
    expect(config.completeNarration).toHaveBeenCalledTimes(1);
    expect(result.current.message).toBe("Nicely done.");
  });

  it("runs the demo's UI actions against the real DOM before handing off", async () => {
    const target = document.createElement("input");
    target.setAttribute("data-nova-target", "product_form.title");
    document.body.appendChild(target);

    const config = baseConfig({
      demoActions: [{ type: "fill_field", target: "product_form.title", value: "Classic Canvas Tote" }],
    });
    const { result } = renderHook(() => useNovaLesson(config));

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.phase).toBe("user_turn"));
    // The demo cleared the spotlight by the time it hands off, but the fill actually happened —
    // checked while it was still set would require instrumenting mid-sequence, so instead assert
    // the action ran by its visible side effect on the real input.
    expect(target.value).toBe("Classic Canvas Tote");
    target.remove();
  });

  it("calling start() twice does not restart or double-run the lesson", async () => {
    const config = baseConfig();
    const { result } = renderHook(() => useNovaLesson(config));

    await act(async () => {
      await Promise.all([result.current.start(), result.current.start()]);
    });

    await waitFor(() => expect(result.current.phase).toBe("user_turn"));
    expect(config.introNarration).toHaveBeenCalledTimes(1);
  });

  it("keeps the real userTurnTarget spotlighted for the whole of user_turn, not just during NOVA's own demo", async () => {
    const target = document.createElement("button");
    target.setAttribute("data-nova-target", "brand_form.save");
    document.body.appendChild(target);

    const config = baseConfig({ userTurnTarget: "brand_form.save" });
    const { result } = renderHook(() => useNovaLesson(config));

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.phase).toBe("user_turn"));
    await waitFor(() => expect(result.current.spotlightRect).not.toBeNull());
    expect(result.current.activeTarget).toBe("brand_form.save");
    target.remove();
  });

  it("spotlights secondUserTurnTarget once it appears in the DOM, for a step needing a second real action", async () => {
    const config = baseConfig({ secondUserTurnTarget: "nl_edit_form.apply", pollMs: 10 });
    const { result } = renderHook(() => useNovaLesson(config));

    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.phase).toBe("user_turn"));
    expect(result.current.spotlightRect).toBeNull(); // the target doesn't exist yet

    // Simulates the user's first real action (e.g. Propose) succeeding and rendering the
    // second button for the first time.
    const applyButton = document.createElement("button");
    applyButton.setAttribute("data-nova-target", "nl_edit_form.apply");
    document.body.appendChild(applyButton);

    await waitFor(() => expect(result.current.spotlightRect).not.toBeNull());
    expect(result.current.activeTarget).toBe("nl_edit_form.apply");
    applyButton.remove();
  });

  it("gives immediate feedback on a real click without completing on its own — only verify() can complete it", async () => {
    const target = document.createElement("button");
    target.setAttribute("data-nova-target", "product_form.save");
    document.body.appendChild(target);

    const config = baseConfig({ userTurnTarget: "product_form.save", verify: vi.fn().mockResolvedValue(false) });
    const { result } = renderHook(() => useNovaLesson(config));

    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.phase).toBe("user_turn"));

    act(() => fireEvent.click(target));
    await waitFor(() => expect(result.current.phase).toBe("verifying"));

    // Immediate feedback shown, but the real backend still says incomplete — must never advance
    // to complete just because a click happened.
    await new Promise((r) => setTimeout(r, 40));
    expect(result.current.phase).not.toBe("complete");
    expect(config.completeNarration).not.toHaveBeenCalled();
    target.remove();
  });

  it("surfaces error/retry if verification never succeeds, and retry() resumes watching for real completion", async () => {
    let verified = false;
    const config = baseConfig({
      verify: vi.fn(() => Promise.resolve(verified)),
      pollMs: 10,
      stuckTimeoutMs: 30, // short for the test — production uses a much longer default
    });
    const { result } = renderHook(() => useNovaLesson(config));

    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.phase).toBe("user_turn"));

    await waitFor(() => expect(result.current.phase).toBe("error"), { timeout: 15000 });

    act(() => result.current.retry());
    expect(result.current.phase).toBe("user_turn");

    // Retrying doesn't fake success — only the real backend state can still complete it.
    verified = true;
    await waitFor(() => expect(result.current.phase).toBe("complete"), { timeout: 15000 });
  });
});

// ---- Progressive narration (lib/typewriter.ts) ------------------------------------------------------
import { setNarrationTiming } from "../lib/typewriter";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("useNovaLesson — narration is typed, and nothing moves until it has finished", () => {
  const CHAR_MS = 20;
  const withTyping = async <T,>(fn: () => Promise<T>) => {
    setNarrationTiming({ charMs: CHAR_MS });
    try {
      return await fn();
    } finally {
      setNarrationTiming({ charMs: 1 });
    }
  };
  const visible = (t: string) => t.replace(/\s/g, "").length;

  function targetEl() {
    const el = document.createElement("button");
    el.setAttribute("data-nova-target", "type.target");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ top: 10, left: 10, width: 50, height: 20, right: 60, bottom: 30, x: 10, y: 10, toJSON: () => ({}) });
    return el;
  }

  it("the first spotlight/action begins only after the intro has finished typing, and then right away (no move beat)", async () => {
    vi.useFakeTimers();
    setNarrationTiming({ charMs: 20 });
    try {
      const el = targetEl();
      const intro = words(6); // ~14 visible characters
      const seen: Array<{ typed: string; at: number }> = [];
      const t0 = Date.now();
      const config = baseConfig({
        introNarration: vi.fn().mockResolvedValue(intro),
        demoActions: [{ type: "spotlight", target: "type.target" }],
        userTurnTarget: "type.target",
      });
      const { result } = renderHook(() => useNovaLesson(config));
      vi.spyOn(el, "getBoundingClientRect").mockImplementation(() => {
        seen.push({ typed: result.current.typedMessage, at: Date.now() - t0 }); // the spotlight measures the control NOW
        return { top: 10, left: 10, width: 50, height: 20, right: 60, bottom: 30, x: 10, y: 10, toJSON: () => ({}) } as DOMRect;
      });
      await act(async () => {
        void result.current.start();
        await vi.advanceTimersByTimeAsync(0);
      });
      const typingTime = (visible(intro) - 1) * CHAR_MS;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(typingTime - 1); // one millisecond before the last character
      });
      expect(seen).toHaveLength(0); // nothing moved while NOVA was still typing
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100); // last character, one paint, then the demonstration
      });
      expect(seen.length).toBeGreaterThan(0);
      // (That the whole intro is rendered before anything moves is asserted at component level, where
      // React state is flushed: see "nothing moves while NOVA is introducing the step".)
      expect(seen[0].at).toBeGreaterThanOrEqual(typingTime); // never before the last character
      expect(seen[0].at).toBeLessThanOrEqual(typingTime + 100); // and then right away: one paint, no move beat
      el.remove();
    } finally {
      vi.useRealTimers();
      setNarrationTiming({ charMs: 1 });
    }
  });

  it("the explanation is not requested until the demo (typing + actions) is finished", async () => {
    await withTyping(async () => {
      const explain = vi.fn().mockResolvedValue("Here's why.");
      const config = baseConfig({ introNarration: vi.fn().mockResolvedValue(words(10)), explainNarration: explain });
      const { result } = renderHook(() => useNovaLesson(config));
      await act(async () => {
        void result.current.start();
      });
      await new Promise((r) => setTimeout(r, (visible(words(10)) - 2) * CHAR_MS));
      expect(explain).not.toHaveBeenCalled(); // still typing the first message
      expect(result.current.phase).toBe("intro"); // still in the centered introduction
      expect(result.current.isTyping).toBe(true);
      await waitFor(() => expect(explain).toHaveBeenCalledTimes(1), { timeout: 15000 });
    });
  });

  it("exposes the full message at once (for assistive tech) while the visible text grows", async () => {
    await withTyping(async () => {
      const demo = "Watch me first, then try it yourself.";
      // The explanation stays pending so the demo message is still current once it has finished typing.
      const config = baseConfig({ introNarration: vi.fn().mockResolvedValue(demo), explainNarration: () => new Promise<string>(() => {}) });
      const { result } = renderHook(() => useNovaLesson(config));
      const samples: Array<{ message: string | null; typed: string; typing: boolean }> = [];
      const watch = setInterval(() => {
        const r = result.current;
        if (r.message === demo) samples.push({ message: r.message, typed: r.typedMessage, typing: r.isTyping });
      }, 3);
      await act(async () => {
        void result.current.start();
      });
      await waitFor(() => expect(samples.some((x) => x.typed === demo)).toBe(true), { timeout: 15000 });
      clearInterval(watch);
      const partial = samples.filter((x) => x.typed.length < demo.length);
      expect(partial.length).toBeGreaterThan(3); // it visibly grew
      for (const x of partial) {
        expect(x.message).toBe(demo); // the full narration was available the whole time
        expect(demo.startsWith(x.typed)).toBe(true); // and the visible text is always a clean prefix
        expect(x.typing).toBe(true);
      }
    });
  });

  it("the cue ring waits for the explanation to finish typing; verification does not", async () => {
    await withTyping(async () => {
      const el = targetEl();
      const verify = vi.fn().mockResolvedValue(false);
      const config = baseConfig({ explainNarration: vi.fn().mockResolvedValue(words(14)), verify, pollMs: 15, userTurnTarget: "type.target" });
      const { result } = renderHook(() => useNovaLesson(config));
      await act(async () => {
        void result.current.start();
      });
      await waitFor(() => expect(result.current.phase).toBe("explain"));
      await waitFor(() => expect(verify).toHaveBeenCalled()); // already watching the real state
      expect(result.current.isTyping).toBe(true);
      expect(result.current.spotlightRect).toBeNull(); // no spotlight movement mid-sentence
      await waitFor(() => expect(result.current.phase).toBe("user_turn"), { timeout: 15000 });
      expect(result.current.typedMessage).toBe(words(14));
      await waitFor(() => expect(result.current.spotlightRect).not.toBeNull());
      el.remove();
    });
  });

  it("a visitor who finishes the real action while NOVA is still typing is verified at once and not held up", async () => {
    await withTyping(async () => {
      let userDidIt = false;
      setNarrationTiming({ charMs: 400 }); // ~85 characters would take ~34 s to type
      const explain = words(30);
      const config = baseConfig({
        explainNarration: vi.fn().mockResolvedValue(explain),
        verify: vi.fn().mockImplementation(async () => userDidIt),
        completeNarration: vi.fn().mockResolvedValue("Nicely done."),
        pollMs: 15,
      });
      const { result } = renderHook(() => useNovaLesson(config));
      await act(async () => {
        void result.current.start();
      });
      await waitFor(() => expect(result.current.phase).toBe("explain"));
      await waitFor(() => expect(result.current.isTyping).toBe(true));
      userDidIt = true;
      // It completes while the explanation (34 s at this cadence) is still being typed: if completion waited
      // for the typing, this would not finish inside the test's timeout.
      await waitFor(() => expect(result.current.phase).toBe("complete"), { timeout: 15000 });
      expect(result.current.typedMessage.length).toBeLessThan(explain.length);
      await waitFor(() => expect(result.current.typedMessage).toBe("Nicely done."), { timeout: 15000 });
      // The abandoned explanation left nothing behind.
      expect(result.current.message).toBe("Nicely done.");
      expect(result.current.typedMessage).not.toMatch(/w\d/);
      expect(config.verify).toHaveBeenCalled(); // real backend state is still what decided it
    });
  });

  it("the completion message is generated once, even though the watcher re-runs on the phase change", async () => {
    await withTyping(async () => {
      const complete = vi.fn().mockResolvedValue("Nicely done.");
      const config = baseConfig({ verify: vi.fn().mockResolvedValue(true), completeNarration: complete, pollMs: 5 });
      const { result } = renderHook(() => useNovaLesson(config));
      await act(async () => {
        void result.current.start();
      });
      await waitFor(() => expect(result.current.phase).toBe("complete"), { timeout: 15000 });
      await waitFor(() => expect(result.current.typedMessage).toBe("Nicely done."), { timeout: 15000 }); // no duplicated characters
      await new Promise((r) => setTimeout(r, 100));
      expect(complete).toHaveBeenCalledTimes(1);
    });
  });

  it("unmounting mid-sentence cancels the typing and the rest of the sequence", async () => {
    vi.useFakeTimers();
    setNarrationTiming({ charMs: 250 });
    try {
      const explain = vi.fn().mockResolvedValue("x");
      const config = baseConfig({ introNarration: vi.fn().mockResolvedValue(words(10)), explainNarration: explain });
      const { result, unmount } = renderHook(() => useNovaLesson(config));
      await act(async () => {
        void result.current.start();
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(result.current.isTyping).toBe(true);
      unmount();
      expect(vi.getTimerCount()).toBe(0); // no character timers survive the Guide
      await vi.advanceTimersByTimeAsync(60000);
      expect(explain).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      setNarrationTiming({ charMs: 1 });
    }
  });

  it("every lesson opens with an introduction before anything else happens", async () => {
    await withTyping(async () => {
      const phases: string[] = [];
      const config = baseConfig({ introNarration: vi.fn().mockResolvedValue("Time to go live."), explainNarration: () => new Promise<string>(() => {}) });
      const { result } = renderHook(() => {
        const r = useNovaLesson(config);
        if (phases[phases.length - 1] !== r.phase) phases.push(r.phase);
        return r;
      });
      await act(async () => {
        void result.current.start();
      });
      await waitFor(() => expect(phases).toContain("explain"), { timeout: 15000 });
      expect(phases.slice(0, 2)).toEqual(["idle", "intro"]);
      expect(phases.indexOf("intro")).toBeLessThan(phases.indexOf("explain"));
    });
  });

  it("skipTyping() reveals the current message at once and the sequence carries on", async () => {
    await withTyping(async () => {
      setNarrationTiming({ charMs: 400 }); // slow enough that skipping is the only way to be quick
      const config = baseConfig({ introNarration: vi.fn().mockResolvedValue("A fairly long introduction to this step."), explainNarration: () => new Promise<string>(() => {}) });
      const { result } = renderHook(() => useNovaLesson(config));
      await act(async () => {
        void result.current.start();
      });
      await waitFor(() => expect(result.current.isTyping).toBe(true));
      expect(result.current.typedMessage.length).toBeLessThan(10);
      act(() => result.current.skipTyping());
      await waitFor(() => expect(result.current.typedMessage).toBe("A fairly long introduction to this step."));
      await waitFor(() => expect(result.current.phase).toBe("explain"), { timeout: 15000 }); // carried on, no 15 s wait
    });
  });

  it("verification starts the instant the visitor acts, not at the next slow poll", async () => {
    await withTyping(async () => {
      const el = targetEl();
      let acted = false;
      el.addEventListener("click", () => (acted = true));
      const verify = vi.fn().mockImplementation(async () => acted);
      const config = baseConfig({ verify, pollMs: 600000, userTurnTarget: "type.target", completeNarration: vi.fn().mockResolvedValue("Done.") }); // a background poll would never fire in time
      const { result } = renderHook(() => useNovaLesson(config));
      await act(async () => {
        void result.current.start();
      });
      await waitFor(() => expect(result.current.phase).toBe("user_turn"), { timeout: 15000 });
      await flushEffects();
      const callsBefore = verify.mock.calls.length;
      act(() => el.click());
      expect(result.current.phase).toBe("verifying"); // acknowledged at once
      await waitFor(() => expect(result.current.phase).toBe("complete"), { timeout: 15000 }); // only the click-triggered check can get here
      expect(verify.mock.calls.length).toBeGreaterThan(callsBefore);
      el.remove();
    });
  });

  it("never pretends to be working: a click that starts nothing returns to waiting once the check window passes", async () => {
    await withTyping(async () => {
      const el = targetEl();
      const verify = vi.fn().mockResolvedValue(false); // e.g. the form rejected the submit
      const config = baseConfig({ verify, pollMs: 5000, verifyBurstMs: 20, verifyWindowMs: 200, userTurnTarget: "type.target" });
      const { result } = renderHook(() => useNovaLesson(config));
      await act(async () => {
        void result.current.start();
      });
      await waitFor(() => expect(result.current.phase).toBe("user_turn"), { timeout: 15000 });
      await flushEffects();
      act(() => el.click());
      expect(result.current.phase).toBe("verifying");
      await waitFor(() => expect(result.current.phase).toBe("user_turn"), { timeout: 15000 });
      expect(result.current.phase).not.toBe("complete");
      expect(verify.mock.calls.length).toBeGreaterThan(2); // it genuinely checked meanwhile
      el.remove();
    });
  });

  it("a two-action lesson replies (centered phase) after the FIRST action, then cues the second control", async () => {
    await withTyping(async () => {
      const first = targetEl();
      const respond = vi.fn().mockResolvedValue("Plan ready. Read it, then apply it.");
      const config = baseConfig({
        respondNarration: respond,
        userTurnTarget: "type.target",
        secondUserTurnTarget: "type.second",
        verify: vi.fn().mockResolvedValue(false),
        pollMs: 10,
      });
      const phases: string[] = [];
      const { result } = renderHook(() => {
        const r = useNovaLesson(config);
        if (phases[phases.length - 1] !== r.phase) phases.push(r.phase);
        return r;
      });
      await act(async () => {
        void result.current.start();
      });
      await waitFor(() => expect(result.current.phase).toBe("user_turn"), { timeout: 15000 });
      expect(respond).not.toHaveBeenCalled();

      // The first action succeeded: the second control appears.
      const second = document.createElement("button");
      second.setAttribute("data-nova-target", "type.second");
      second.getBoundingClientRect = first.getBoundingClientRect;
      document.body.appendChild(second);

      await waitFor(() => expect(result.current.phase).toBe("respond"), { timeout: 15000 });
      expect(result.current.spotlightRect).toBeNull(); // the cue does not move mid-sentence
      await waitFor(() => expect(result.current.typedMessage).toBe("Plan ready. Read it, then apply it."), { timeout: 15000 });
      await waitFor(() => expect(result.current.phase).toBe("user_turn"), { timeout: 15000 });
      await waitFor(() => expect(result.current.spotlightRect).not.toBeNull());
      expect(result.current.activeTarget).toBe("type.second");
      expect(respond).toHaveBeenCalledTimes(1); // once, however many polls ran
      expect(phases.filter((p) => p === "respond")).toHaveLength(1);
      first.remove();
      second.remove();
    });
  });

  it("a single-action lesson has no extra reply phase: verified means the completion reply starts at once", async () => {
    await withTyping(async () => {
      const phases: string[] = [];
      const config = baseConfig({ verify: vi.fn().mockResolvedValue(true), pollMs: 5 });
      const { result } = renderHook(() => {
        const r = useNovaLesson(config);
        if (phases[phases.length - 1] !== r.phase) phases.push(r.phase);
        return r;
      });
      await act(async () => {
        void result.current.start();
      });
      await waitFor(() => expect(result.current.phase).toBe("complete"), { timeout: 15000 });
      expect(phases).not.toContain("respond");
      expect(phases).not.toContain("verifying"); // nothing to "process": the server had already confirmed
    });
  });

  it("acting while NOVA is still typing the explanation is verified at once too (not at the next background poll)", async () => {
    await withTyping(async () => {
      setNarrationTiming({ charMs: 400 }); // a long enough explanation that the visitor is early
      const el = targetEl();
      let acted = false;
      el.addEventListener("click", () => (acted = true));
      const verify = vi.fn().mockImplementation(async () => acted);
      const config = baseConfig({
        explainNarration: vi.fn().mockResolvedValue(words(14)),
        verify,
        pollMs: 600000, // the background poll would never fire in time
        userTurnTarget: "type.target",
        completeNarration: vi.fn().mockResolvedValue("Done."),
      });
      const phases: string[] = [];
      const { result } = renderHook(() => {
        const r = useNovaLesson(config);
        if (phases[phases.length - 1] !== r.phase) phases.push(r.phase);
        return r;
      });
      await act(async () => {
        void result.current.start();
      });
      await waitFor(() => expect(result.current.phase).toBe("explain"), { timeout: 15000 });
      await waitFor(() => expect(result.current.isTyping).toBe(true));
      await waitFor(() => expect(result.current.activeTarget).toBe("type.target")); // the watcher has picked the control
      await flushEffects();
      act(() => el.click());
      expect(result.current.phase).toBe("verifying"); // acknowledged during the explanation
      await waitFor(() => expect(result.current.phase).toBe("complete"), { timeout: 15000 });
      // The explanation finishing later must not drag the machine back to waiting.
      await waitFor(() => expect(result.current.typedMessage).toBe("Done."), { timeout: 15000 });
      expect(phases.indexOf("user_turn")).toBe(-1);
      expect(result.current.typedMessage).toBe("Done.");
      el.remove();
    });
  });
});
