import { act, renderHook, waitFor } from "@testing-library/react";
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

  it("only polls verify() once in user_turn — never during demo or explain", async () => {
    const verify = vi.fn().mockResolvedValue(false);
    const config = baseConfig({ verify, pollMs: 15 });
    const { result } = renderHook(() => useNovaLesson(config));

    const startPromise = act(async () => {
      await result.current.start();
    });
    // While start() is still resolving demo/explain, no verify polling should have run yet —
    // verified implicitly by start() completing before any poll interval could fire given the
    // synchronous mocked narration calls above.
    await startPromise;
    expect(verify).not.toHaveBeenCalled();

    await new Promise((r) => setTimeout(r, 50));
    expect(verify.mock.calls.length).toBeGreaterThan(0);
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
});
