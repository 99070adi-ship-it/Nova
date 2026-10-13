import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getOnboardingProgress, postMessage, startConversation } from "../api/client";
import { getLessonStep, primaryActionTarget, type LessonStep } from "../lib/novaLessons";
import { getTarget, waitForTarget } from "../lib/novaUiActions";
import { useNovaLesson } from "../hooks/useNovaLesson";
import NovaFace from "./NovaFace";
import NovaSpotlight from "./NovaSpotlight";

const SPRING_EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const BOX_MOVE_TRANSITION = `left 550ms ${SPRING_EASING}, top 550ms ${SPRING_EASING}, width 550ms ${SPRING_EASING}`;
const MARGIN = 24;
const BOX_WIDTH = 320;
const BOX_HEIGHT_ESTIMATE = 150;

interface DockRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PHASE_LABEL: Record<string, string> = {
  idle: "GETTING READY",
  demo: "DEMONSTRATING",
  explain: "EXPLAINING",
  user_turn: "WAITING FOR YOU",
  verifying: "CHECKING…",
  error: "NEED ANOTHER TRY",
  complete: "DONE",
};

// The structured "Next: Click X" instruction is shown from EXPLAIN onward — by then NOVA has
// already said why, so showing exactly which real button to press reinforces it rather than
// pre-empting the demo itself.
const SHOWS_NEXT_ACTION: Record<string, boolean> = {
  explain: true,
  user_turn: true,
  verifying: true,
  error: true,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Where the floating guide box sits: tracking the field it's currently spotlighting (so it
 * never sits on top of the real element it's demonstrating), or resting just above NOVA's own
 * dock corner once there's nothing specific to point at (explain/verifying/complete). */
function boxPosition(rect: DOMRect | null): { left: number; top: number } {
  if (!rect) {
    return {
      left: window.innerWidth - BOX_WIDTH - MARGIN,
      top: window.innerHeight - BOX_HEIGHT_ESTIMATE - MARGIN - 80,
    };
  }
  let left = rect.right + 16;
  if (left + BOX_WIDTH > window.innerWidth - MARGIN) left = rect.left - BOX_WIDTH - 16;
  left = clamp(left, MARGIN, window.innerWidth - BOX_WIDTH - MARGIN);
  const top = clamp(
    rect.top + rect.height / 2 - BOX_HEIGHT_ESTIMATE / 2,
    MARGIN,
    window.innerHeight - BOX_HEIGHT_ESTIMATE - MARGIN,
  );
  return { left, top };
}

/** Runs one lesson step to completion against the real page (navigating there first if needed),
 * then calls onDone — see hooks/useNovaLesson.ts for the demo -> explain -> user_turn -> verify ->
 * complete (-> error/retry) state machine this drives. A fresh instance mounts per step
 * (NovaGuideWidget keys it by step.key), so each step gets its own clean run.
 *
 * Spatial continuity: `dockOrigin` is the real bottom-right launcher's last measured position —
 * on mount, the box paints there first (no transition), then two animation frames later animates
 * to its real spotlight-relative target, so it visibly springs out from the exact launcher it
 * came from rather than just appearing. The mirror image happens on genuine completion: once
 * `lesson.phase === "complete"` and the brief beat on the completion message has played, the box
 * animates back down to that same dock position/size before `onDone` actually swaps it out for
 * the real docked bubble — it never retracts just because the page navigated, since navigation
 * doesn't touch `lesson.phase` at all. */
function LessonRunner({
  step,
  conversationId,
  dockOrigin,
  autoNavigate,
  onDone,
}: {
  step: LessonStep;
  conversationId: React.MutableRefObject<string | null>;
  dockOrigin: DockRect | null;
  /** True when the Guide may take the visitor to this step's page by itself: right after signing
   * in, or right after the previous step finished. False on a plain page load/refresh somewhere
   * else — then the Guide waits for the visitor to choose to continue, so direct route access and
   * refreshes are never hijacked. */
  autoNavigate: boolean;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const startedRef = useRef(false);
  const [springingIn, setSpringingIn] = useState(!!dockOrigin);
  const [retracting, setRetracting] = useState(false);
  const [targetMissing, setTargetMissing] = useState(false);
  // The sequence (count, order, titles) comes from the server's progress payload, never from this
  // file's lesson list — see lib/novaLessons.ts. Same query key the rest of the app polls.
  const { data: progress } = useQuery({ queryKey: ["onboarding-progress"], queryFn: getOnboardingProgress });
  const away = !location.pathname.startsWith(step.path);
  const awayRef = useRef(away);
  awayRef.current = away;
  const [held, setHeld] = useState(!autoNavigate && away);

  async function narrate(prompt: string): Promise<string> {
    if (!conversationId.current) {
      const conversation = await startConversation({ agent_key: "nova_guide", context: {} });
      conversationId.current = conversation.id;
    }
    const result = await postMessage(conversationId.current, prompt);
    return result.assistant_text;
  }

  const userTurnTarget = primaryActionTarget(step);

  const lesson = useNovaLesson({
    demoActions: step.demoActions,
    demoNarration: () => narrate(step.demoPrompt),
    explainNarration: () => narrate(step.explainPrompt),
    verify: async () => {
      const progress = await getOnboardingProgress();
      return progress.steps.find((s) => s.key === step.key)?.status === "completed";
    },
    completeNarration: () => narrate(step.completePrompt),
    userTurnTarget,
    secondUserTurnTarget: step.secondUserTurnTarget,
    isAway: () => awayRef.current,
  });

  // Pre-flight: never start a demo that would silently spotlight nothing. If the real control
  // this lesson needs still isn't on the page after navigating and waiting, say so plainly, log
  // why for debugging, and offer a real retry — this is requirement 2's "do not pretend the step
  // is ready", not the user_turn verification failure path (that's the hook's own error/retry).
  async function attemptStart() {
    setTargetMissing(false);
    if (!location.pathname.startsWith(step.path)) navigate(step.path);
    if (userTurnTarget) await waitForTarget(userTurnTarget);
    if (userTurnTarget && !getTarget(userTurnTarget)) {
      // eslint-disable-next-line no-console
      console.error(
        `[NovaGuide] Could not find data-nova-target="${userTurnTarget}" for step "${step.key}" on ${step.path} after navigating — the lesson cannot demonstrate this action.`,
      );
      setTargetMissing(true);
      return;
    }
    void lesson.start();
  }

  useEffect(() => {
    if (startedRef.current || held) return;
    startedRef.current = true;
    void attemptStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held]);

  // Held on a page that isn't this step's: if the visitor gets to the step's page on their own,
  // the tour simply continues from there.
  useEffect(() => {
    if (held && !away) setHeld(false);
  }, [held, away]);

  // Spring-in: painted at the dock's exact position/size on the first frame (no transition —
  // nothing to animate yet, it just needs to start there), then two frames later flips to false,
  // which switches the rendered left/top/width to the real target with the transition now active,
  // so the browser animates smoothly from the launcher to wherever the lesson needs it.
  const rafRef = useRef(0);
  useEffect(() => {
    if (!dockOrigin) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => setSpringingIn(false));
    });
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (lesson.phase !== "complete") return;
    const beatTimer = setTimeout(() => setRetracting(true), 2200);
    return () => clearTimeout(beatTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.phase]);

  useEffect(() => {
    if (!retracting) return;
    // Matches BOX_MOVE_TRANSITION's duration — only actually swap to the docked bubble once the
    // retract animation has had time to finish playing.
    const timer = setTimeout(onDone, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retracting]);

  const atDock = (retracting || springingIn) && dockOrigin;
  const pos = atDock ? { left: dockOrigin.left, top: dockOrigin.top } : boxPosition(lesson.spotlightRect);
  const width = atDock ? dockOrigin.width : BOX_WIDTH;
  const serverIndex = progress ? progress.steps.findIndex((s) => s.key === step.key) : -1;
  const stepNumber = serverIndex >= 0 ? serverIndex + 1 : null;
  const stepTotal = progress?.total_steps ?? null;
  const stepTitle = (serverIndex >= 0 ? progress?.steps[serverIndex].title : undefined) ?? step.title;
  const showReturn = away && !retracting && ["explain", "user_turn", "verifying", "error"].includes(lesson.phase);

  const currentActionLabel =
    lesson.activeTarget && lesson.activeTarget === step.secondUserTurnTarget
      ? step.secondActionLabel ?? step.nextActionLabel
      : step.nextActionLabel;

  if (held) {
    return (
      <div
        className="fixed bottom-6 right-6 z-50 w-80 rounded-lg border border-neutral-200 bg-white p-4 shadow-xl"
        data-testid="guide-held"
      >
        <div className="flex items-start gap-3">
          <NovaFace look="center" />
          <div className="flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-amber-600">GUIDED TOUR PAUSED</p>
            <p className="mt-0.5 text-sm text-neutral-700">
              {stepNumber && stepTotal ? `Next up, step ${stepNumber} of ${stepTotal}: ` : "Next up: "}
              {stepTitle}. Look around freely; I'll pick up whenever you're ready.
            </p>
            <button
              onClick={() => {
                setHeld(false);
                navigate(step.path);
              }}
              className="mt-2 rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white"
            >
              Continue the tour
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <NovaSpotlight
        rect={retracting || targetMissing || away ? null : lesson.spotlightRect}
        mode={lesson.phase === "demo" ? "focus" : "cue"}
      />
      <div
        className="fixed z-50 overflow-hidden rounded-lg border border-neutral-200 bg-white p-4 shadow-xl"
        style={{
          left: pos.left,
          top: pos.top,
          width,
          transition: springingIn ? "none" : BOX_MOVE_TRANSITION,
        }}
      >
        {targetMissing ? (
          <div className="flex items-start gap-3">
            <NovaFace talking look="center" />
            <div className="flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-red-600">CAN'T FIND THAT YET</p>
              <p className="mt-0.5 text-sm text-neutral-700">
                I can't find the right control on this page yet — it may still be loading.
              </p>
              <button
                onClick={() => void attemptStart()}
                className="mt-2 rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-100"
              >
                Try again
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <NovaFace
                talking={lesson.phase === "demo" || lesson.phase === "explain" || lesson.phase === "verifying" || lesson.phase === "complete"}
                look={lesson.phase === "demo" ? "down" : "center"}
              />
              <div className="flex-1">
                <p
                  className={
                    lesson.phase === "error"
                      ? "text-[11px] font-medium uppercase tracking-wide text-red-600"
                      : "text-[11px] font-medium uppercase tracking-wide text-amber-600"
                  }
                >
                  {PHASE_LABEL[lesson.phase] ?? ""}
                </p>
                <p className="mt-0.5 text-sm text-neutral-700">
                  {lesson.phase === "error"
                    ? "That doesn't seem to have gone through yet — check the form for anything NOVA can't fill in for you, then try again."
                    : lesson.message ?? step.title}
                </p>
              </div>
            </div>

            {SHOWS_NEXT_ACTION[lesson.phase] && (
              <div className="mt-3 border-t border-neutral-100 pt-2">
                <p className="text-xs font-medium text-neutral-800">
                  Next: click <span className="font-semibold">"{currentActionLabel}"</span>
                </p>
                <p className="mt-0.5 text-[11px] text-neutral-400">{step.afterActionHint}</p>
                {lesson.phase === "error" && (
                  <button
                    onClick={lesson.retry}
                    className="mt-2 rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-100"
                  >
                    Try again
                  </button>
                )}
              </div>
            )}

            {showReturn && (
              <div className="mt-3 border-t border-neutral-100 pt-2" data-testid="guide-return">
                <p className="text-xs text-neutral-600">You've stepped away from this step. Your progress is saved.</p>
                <button
                  onClick={() => navigate(step.path)}
                  className="mt-1.5 rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white"
                >
                  Return to step{stepNumber ? ` ${stepNumber}` : ""}
                </button>
              </div>
            )}

            {stepNumber !== null && stepTotal !== null && (
              <p className="mt-3 border-t border-neutral-100 pt-2 text-[11px] font-medium text-neutral-400">
                Step {stepNumber} of {stepTotal} — {stepTitle}
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** NOVA's always-on-screen presence (NOVA 2.0 Guide redesign) — docked as a small chat bubble
 * bottom-right by default, so it's never in the way on an ordinary page. The instant a real
 * onboarding step becomes available, it bounces up off the dock into the full guide box
 * (LessonRunner above) and walks that one step — demonstrating on the real page with VELORA's own
 * data already filled in, explaining why, then waiting for the visitor to press the real button
 * themselves. The moment that step's real backend state shows it's done, NOVA docks back down,
 * then immediately bounces back up for the next step the SERVER reports — so every onboarding step
 * (see lib/novaLessons.ts; steps already satisfied by seeded data are skipped) plays consecutively,
 * across every page they live on. The app is never locked while it runs: the visitor can navigate
 * anywhere, and the Guide offers "Return to step" until they come back. Once there's no current step left, NOVA stays docked for good, and the same bubble
 * becomes an ordinary help/FAQ chat — a real AIConversation with the `assistant` agent. */
export default function NovaGuideWidget() {
  const queryClient = useQueryClient();
  const [faqOpen, setFaqOpen] = useState(false);
  const [faqInput, setFaqInput] = useState("");
  const [faqReply, setFaqReply] = useState<string | null>(null);
  const [faqSending, setFaqSending] = useState(false);
  const guideConversationId = useRef<string | null>(null);
  const faqConversationId = useRef<string | null>(null);
  const [activeStepKey, setActiveStepKey] = useState<string | null>(null);
  // May the Guide navigate by itself to the next step's page? Yes right after signing in (the auth
  // pages pass `beginTour`) and after each completed step; no on a plain load/refresh elsewhere.
  const location = useLocation();
  const navigate = useNavigate();
  const autoNavigateRef = useRef(false);
  useEffect(() => {
    if ((location.state as { beginTour?: boolean } | null)?.beginTour) {
      autoNavigateRef.current = true;
      // Consume it, so a later refresh of this same history entry doesn't count as signing in again.
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);
  // The real launcher button's last-measured position/size — captured while it's actually
  // mounted (docked), reused as both the spring-out's origin and the retract's target, since the
  // launcher itself unmounts for the whole time a lesson is active and can't be re-measured then.
  const dockRectRef = useRef<DockRect | null>(null);
  const measureDock = (el: HTMLButtonElement | null) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    dockRectRef.current = { left: r.left, top: r.top, width: r.width, height: r.height };
  };

  const { data: progress } = useQuery({
    queryKey: ["onboarding-progress"],
    queryFn: getOnboardingProgress,
    refetchInterval: activeStepKey ? false : 4000,
  });

  // The step that just finished. The progress cache can still say it is current for a moment after
  // (or already say the NEXT step while this one was still running, because pages invalidate the
  // query on submit), so a step is never restarted straight after it completed.
  const justDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeStepKey) return; // a lesson is already running — it polls its own completion
    const currentStep = progress?.current_step ?? null;
    if (currentStep !== justDoneRef.current) justDoneRef.current = null;
    if (currentStep && currentStep !== justDoneRef.current && getLessonStep(currentStep)) setActiveStepKey(currentStep);
    // Re-evaluates when a lesson ends too (activeStepKey -> null), not only when the server's
    // current step changes: otherwise a cache that already shows the next step never starts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.current_step, activeStepKey]);

  async function sendFaq(text: string) {
    setFaqSending(true);
    try {
      if (!faqConversationId.current) {
        const conversation = await startConversation({ agent_key: "assistant", context: {} });
        faqConversationId.current = conversation.id;
      }
      const result = await postMessage(faqConversationId.current, text);
      setFaqReply(result.assistant_text);
    } catch {
      setFaqReply("Sorry — I couldn't reach NOVA just now. Try again in a moment.");
    } finally {
      setFaqSending(false);
    }
  }

  const activeStep = activeStepKey ? getLessonStep(activeStepKey) : undefined;

  if (activeStep) {
    return (
      <LessonRunner
        step={activeStep}
        conversationId={guideConversationId}
        dockOrigin={dockRectRef.current}
        autoNavigate={autoNavigateRef.current}
        onDone={() => {
          autoNavigateRef.current = true;
          justDoneRef.current = activeStep.key;
          setActiveStepKey(null);
          void queryClient.invalidateQueries({ queryKey: ["onboarding-progress"] });
        }}
      />
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {faqOpen && (
        <div className="nova-pop-in absolute bottom-full right-0 mb-2 w-80 rounded-lg border border-neutral-200 bg-white p-3 shadow-xl">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">NOVA HELP</p>
          {faqReply && <p className="mb-2 text-sm text-neutral-700">{faqReply}</p>}
          {!faqReply && <p className="mb-2 text-xs text-neutral-400">Ask about your store, products, or storefront.</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const text = faqInput.trim();
              if (!text || faqSending) return;
              setFaqInput("");
              void sendFaq(text);
            }}
            className="flex gap-2"
          >
            <input
              value={faqInput}
              onChange={(e) => setFaqInput(e.target.value)}
              placeholder="Ask NOVA…"
              className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm"
            />
            <button
              type="submit"
              disabled={faqSending}
              className="rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {faqSending ? "…" : "Send"}
            </button>
          </form>
        </div>
      )}
      <button
        ref={measureDock}
        onClick={() => setFaqOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600 shadow-lg hover:bg-neutral-50"
      >
        <NovaFace size={26} talking={faqSending || !!faqReply} />
        <span>{faqOpen ? "Hide" : "Ask me anything"}</span>
      </button>
    </div>
  );
}
