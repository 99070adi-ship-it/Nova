import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getOnboardingProgress, postMessage, startConversation } from "../api/client";
import { getLessonStep, LESSON_STEPS, type LessonStep } from "../lib/novaLessons";
import { waitForTarget } from "../lib/novaUiActions";
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
  demo: "DEMONSTRATING",
  explain: "EXPLAINING",
  user_turn: "YOUR TURN",
  verifying: "CHECKING…",
  complete: "DONE",
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
 * complete state machine this drives. A fresh instance mounts per step (NovaGuideWidget keys it
 * by step.key), so each step gets its own clean run.
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
  onDone,
}: {
  step: LessonStep;
  conversationId: React.MutableRefObject<string | null>;
  dockOrigin: DockRect | null;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const startedRef = useRef(false);
  const [springingIn, setSpringingIn] = useState(!!dockOrigin);
  const [retracting, setRetracting] = useState(false);

  async function narrate(prompt: string): Promise<string> {
    if (!conversationId.current) {
      const conversation = await startConversation({ agent_key: "nova_guide", context: {} });
      conversationId.current = conversation.id;
    }
    const result = await postMessage(conversationId.current, prompt);
    return result.assistant_text;
  }

  const lesson = useNovaLesson({
    demoActions: step.demoActions,
    demoNarration: () => narrate(step.demoPrompt),
    explainNarration: () => narrate(step.explainPrompt),
    verify: async () => {
      const progress = await getOnboardingProgress();
      return progress.steps.find((s) => s.key === step.key)?.status === "completed";
    },
    completeNarration: () => narrate(step.completePrompt),
    midTurnSpotlightTarget: step.midTurnSpotlightTarget,
  });

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    (async () => {
      if (!location.pathname.startsWith(step.path)) navigate(step.path);
      const firstTarget = step.demoActions.find((a) => a.target)?.target;
      if (firstTarget) await waitForTarget(firstTarget);
      if (!cancelled) void lesson.start();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const stepIndex = LESSON_STEPS.findIndex((s) => s.key === step.key);

  return (
    <>
      <NovaSpotlight rect={retracting ? null : lesson.spotlightRect} />
      <div
        className="fixed z-50 overflow-hidden rounded-lg border border-neutral-200 bg-white p-4 shadow-xl"
        style={{
          left: pos.left,
          top: pos.top,
          width,
          transition: springingIn ? "none" : BOX_MOVE_TRANSITION,
        }}
      >
        <div className="flex items-start gap-3">
          <NovaFace
            talking={lesson.phase === "demo" || lesson.phase === "explain" || lesson.phase === "verifying" || lesson.phase === "complete"}
            look={lesson.phase === "demo" ? "down" : "center"}
          />
          <div className="flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-amber-600">
              {PHASE_LABEL[lesson.phase] ?? ""}
            </p>
            <p className="mt-0.5 text-sm text-neutral-700">{lesson.message ?? "Let's get started."}</p>
          </div>
        </div>
        {stepIndex >= 0 && (
          <p className="mt-3 border-t border-neutral-100 pt-2 text-[11px] font-medium text-neutral-400">
            Step {stepIndex + 1} of {LESSON_STEPS.length} — {step.key.replace("_", " ")}
          </p>
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
 * then immediately bounces back up for the next step — so all ten onboarding steps (minus
 * `collections`/`preview`, which the backend completes automatically — see lib/novaLessons.ts)
 * play consecutively, across every page they live on, with no manual "what do I click next"
 * hand-off. Once there's no current step left, NOVA stays docked for good, and the same bubble
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

  useEffect(() => {
    if (activeStepKey) return; // a lesson is already running — it polls its own completion
    const currentStep = progress?.current_step ?? null;
    if (currentStep && getLessonStep(currentStep)) setActiveStepKey(currentStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.current_step]);

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
        onDone={() => {
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
