import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useNovaLesson } from "./useNovaLesson";

function baseConfig(overrides: Partial<Parameters<typeof useNovaLesson>[0]> = {}) {
  return {
    demoActions: [],
    demoNarration: vi.fn().mockResolvedValue("Watch me first."),
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
    expect(config.demoNarration).toHaveBeenCalledTimes(1);
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
    // demoNarration/explainNarration (mocked synchronous) are what start() actually awaits before
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

    await waitFor(() => expect(result.current.phase).toBe("complete"), { timeout: 2000 });
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
    expect(config.demoNarration).toHaveBeenCalledTimes(1);
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

    await waitFor(() => expect(result.current.phase).toBe("error"), { timeout: 2000 });

    act(() => result.current.retry());
    expect(result.current.phase).toBe("user_turn");

    // Retrying doesn't fake success — only the real backend state can still complete it.
    verified = true;
    await waitFor(() => expect(result.current.phase).toBe("complete"), { timeout: 2000 });
  });
});
