import { useEffect, useRef, useState } from "react";
import { type UIAction, getTarget, runUIActions } from "../lib/novaUiActions";

/** The exact loop NOVA 2.0's Guide redesign asks for: NOVA demonstrates (never persisting a real
 * mutation itself), explains why, hands control to the user, verifies the user's own real result
 * against the server, then unlocks. The server (via `verify`) is always the source of truth for
 * completion — this hook holds no completion state of its own beyond what `verify` just
 * confirmed, and nothing here touches localStorage. */
export type NovaLessonPhase = "idle" | "demo" | "explain" | "user_turn" | "verifying" | "complete";

export interface NovaLessonConfig {
  demoActions: UIAction[];
  demoNarration: () => Promise<string>;
  explainNarration: () => Promise<string>;
  /** Polled while phase === "user_turn". Must check real, persisted state — never client state. */
  verify: () => Promise<boolean>;
  completeNarration: () => Promise<string>;
  /** Optional — for a user_turn that needs more than one real action from the user (e.g.
   * nl_edit: propose a Change Plan, then separately apply it). Checked on the same poll cadence
   * as `verify`; the instant this target actually exists in the DOM (meaning the user's first
   * real action already succeeded and produced it — e.g. the "Apply to draft" button only
   * rendering once a real plan exists), NOVA spotlights it so the user knows what to do next,
   * without ever clicking it for them. */
  midTurnSpotlightTarget?: string;
  pollMs?: number;
  /** Milliseconds paced between each demo action — tunable so tests don't need real wall-clock
   * seconds; production code relies on the default. */
  actionPaceMs?: number;
}

export function useNovaLesson(config: NovaLessonConfig) {
  const [phase, setPhase] = useState<NovaLessonPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  const startedRef = useRef(false);

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

    setPhase("user_turn");
  }

  useEffect(() => {
    if (phase !== "user_turn") return;
    let cancelled = false;

    const interval = setInterval(async () => {
      if (config.midTurnSpotlightTarget && !cancelled) {
        const el = getTarget(config.midTurnSpotlightTarget);
        setSpotlightRect(el ? el.getBoundingClientRect() : null);
      }

      let verified = false;
      try {
        verified = await config.verify();
      } catch {
        verified = false;
      }
      if (verified && !cancelled) {
        cancelled = true;
        clearInterval(interval);
        setSpotlightRect(null);
        setPhase("verifying");
        try {
          setMessage(await config.completeNarration());
        } catch {
          setMessage("Done — nicely handled.");
        }
        setPhase("complete");
      }
    }, config.pollMs ?? 1500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return { phase, message, spotlightRect, start };
}
