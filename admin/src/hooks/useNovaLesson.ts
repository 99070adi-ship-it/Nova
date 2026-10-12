import { useEffect, useRef, useState } from "react";
import { type UIAction, getTarget, runUIActions } from "../lib/novaUiActions";

/** The loop NOVA 2.0's Guide redesign asks for: NOVA demonstrates (never persisting a real
 * mutation itself), explains why, hands control to the user, spotlights the real control the
 * whole time it's waiting (not just during its own demo), verifies the user's own real result
 * against the server, then unlocks — surfacing a retryable error if the real backend state never
 * confirms. The server (via `verify`) is always the source of truth for completion — this hook
 * holds no completion state of its own beyond what `verify` just confirmed, and nothing here
 * touches localStorage. */
export type NovaLessonPhase = "idle" | "demo" | "explain" | "user_turn" | "verifying" | "error" | "complete";

export interface NovaLessonConfig {
  demoActions: UIAction[];
  demoNarration: () => Promise<string>;
  explainNarration: () => Promise<string>;
  /** Polled throughout user_turn/verifying. Must check real, persisted state — never client
   * state — this is the only thing that can ever advance a lesson to "complete". */
  verify: () => Promise<boolean>;
  completeNarration: () => Promise<string>;
  /** The real control the user needs to act on — kept spotlighted for the whole user_turn phase
   * (not just NOVA's own demo), so there is always a visible cue pointing at what to click. */
  userTurnTarget?: string;
  /** For a lesson needing a second real action after the first succeeds (e.g. nl_edit: propose a
   * Change Plan, then separately apply it; run_business: check Store Health, then Fix what you
   * can) — the instant this target actually exists in the DOM (meaning the first action already
   * succeeded and produced it), the spotlight switches to it and a fresh user_turn begins for it,
   * still gated on the same real `verify`. */
  secondUserTurnTarget?: string;
  pollMs?: number;
  /** Milliseconds paced between each demo action — tunable so tests don't need real wall-clock
   * seconds; production code relies on the default. */
  actionPaceMs?: number;
  /** How long to wait after entering user_turn (or after a click resets the clock) with no
   * successful verification before surfacing the error/retry state — a generous backstop, not a
   * strict per-click timer, so normal network/LLM latency never trips it. */
  stuckTimeoutMs?: number;
}

const DEFAULT_STUCK_TIMEOUT_MS = 20000;

export function useNovaLesson(config: NovaLessonConfig) {
  const [phase, setPhase] = useState<NovaLessonPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const startedRef = useRef(false);
  const prevTargetRef = useRef<string | null>(null);

  async function start() {
    if (startedRef.current) return;
    startedRef.current = true;

    setPhase("demo");
    try {
      setMessage(await config.demoNarration());
    } catch {
      setMessage("Watch me first.");
    }
    await runUIActions(config.demoActions, { onSpotlight: setSpotlightRect }, config.actionPaceMs);
    setSpotlightRect(null);

    setPhase("explain");
    try {
      setMessage(await config.explainNarration());
    } catch {
      setMessage("Now it's your turn — go ahead and try it yourself.");
    }

    prevTargetRef.current = config.userTurnTarget ?? null;
    setActiveTarget(config.userTurnTarget ?? null);
    setPhase("user_turn");
  }

  /** Surfaced for the "ERROR/RETRY" state (NOVA 2.0 Guide redesign, interaction state machine) —
   * dismisses the error and resumes watching the same target with a fresh grace period. Never
   * re-runs the demo or re-narrates; the real backend state is still exactly what it was. */
  function retry() {
    setPhase("user_turn");
  }

  // The watcher loop — runs for the whole time a lesson is waiting on the user (user_turn) or
  // showing the brief "a click just happened" feedback (verifying), covering both: picking which
  // real target to spotlight right now (switching to secondUserTurnTarget the instant it exists,
  // and handing that a fresh user_turn/click-feedback cycle of its own), and the actual
  // never-trust-the-frontend verification against the server.
  useEffect(() => {
    if (phase !== "user_turn" && phase !== "verifying") return;
    let cancelled = false;
    const startedAt = Date.now();
    const stuckMs = config.stuckTimeoutMs ?? DEFAULT_STUCK_TIMEOUT_MS;

    const tick = async () => {
      if (cancelled) return;
      const secondEl = config.secondUserTurnTarget ? getTarget(config.secondUserTurnTarget) : null;
      const current = secondEl ? config.secondUserTurnTarget! : config.userTurnTarget ?? null;
      if (current !== prevTargetRef.current) {
        prevTargetRef.current = current;
        setActiveTarget(current);
        // The target just changed (almost always: the first action succeeded and revealed the
        // second control) — give it its own clean waiting state rather than staying on whatever
        // cosmetic "verifying" the first click left behind.
        setPhase((p) => (p === "verifying" ? "user_turn" : p));
      }
      const el = current ? getTarget(current) : null;
      setSpotlightRect(el ? el.getBoundingClientRect() : null);

      let verified = false;
      try {
        verified = await config.verify();
      } catch {
        verified = false;
      }
      if (cancelled) return;
      if (verified) {
        cancelled = true;
        setSpotlightRect(null);
        setPhase("verifying");
        try {
          setMessage(await config.completeNarration());
        } catch {
          setMessage("Done — nicely handled.");
        }
        setPhase("complete");
        return;
      }
      if (Date.now() - startedAt > stuckMs) {
        cancelled = true;
        setPhase("error");
      }
    };

    void tick();
    const interval = setInterval(tick, config.pollMs ?? 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Immediate feedback the instant the user actually clicks the real, currently-spotlighted
  // control (NOVA 2.0 Guide redesign, requirement 3) — purely cosmetic: it flips the visible
  // phase to "verifying" right away rather than waiting for the next poll tick, but the watcher
  // loop above is what actually decides success, failure, or the stuck/error backstop regardless
  // of whether a click was ever observed (e.g. submitting a form via Enter still works).
  useEffect(() => {
    if (phase !== "user_turn" || !activeTarget) return;
    const el = getTarget(activeTarget);
    if (!el) return;
    const onClick = () => setPhase((p) => (p === "user_turn" ? "verifying" : p));
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [phase, activeTarget]);

  return { phase, message, spotlightRect, activeTarget, start, retry };
}
