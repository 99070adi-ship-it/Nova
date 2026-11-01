import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSessionFocus } from "../lib/sessionFocus";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ApiError, getOnboardingProgress, postMessage, startConversation } from "../api/client";
import { getLessonStep, LESSON_STEPS, primaryActionTarget, type LessonStep } from "../lib/novaLessons";
import { loadIntroSeen, saveIntroSeen } from "../lib/guideIntro";
import { VERIFIED_LINES } from "../lib/novaObservations";
import { NOVA_INTRO_BEATS, ASSISTANT_EMPTY_HINT, ASSISTANT_ERROR } from "../lib/novaScript";
import { getTarget, waitForTarget } from "../lib/novaUiActions";
import { useNovaLesson, type NovaLessonVoice } from "../hooks/useNovaLesson";
import { useGuideVoice, type GuideVoice } from "../hooks/useGuideVoice";
import { useCurrentUserKey } from "../lib/auth";
import AiStatusNote from "./AiStatusNote";
import GuideVoiceChoice from "./GuideVoiceChoice";
import GuideVoiceControls from "./GuideVoiceControls";
import NovaFace from "./NovaFace";
import NovaSpotlight from "./NovaSpotlight";

const SPRING_EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
// Brief on purpose: the panel's travel is never something the visitor waits for.
const BOX_MOVE_MS = 420;
const BOX_MOVE_TRANSITION = `left ${BOX_MOVE_MS}ms ${SPRING_EASING}, top ${BOX_MOVE_MS}ms ${SPRING_EASING}, width ${BOX_MOVE_MS}ms ${SPRING_EASING}`;
const MARGIN = 24;
const BOX_WIDTH = 320;
// The centered presentation at the start of every step.
const CENTER_WIDTH = 460;
// Used only until the box has been measured (see LessonRunner's boxRef).
const BOX_HEIGHT_ESTIMATE = 150;

interface DockRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PHASE_LABEL: Record<string, string> = {
  idle: "GETTING READY",
  intro: "INTRODUCING",
  respond: "RESPONDING",
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
function boxPosition(rect: DOMRect | null, height: number): { left: number; top: number } {
  if (!rect) {
    return {
      left: window.innerWidth - BOX_WIDTH - MARGIN,
      top: Math.max(MARGIN, window.innerHeight - height - MARGIN - 80),
    };
  }
  let left = rect.right + 16;
  if (left + BOX_WIDTH > window.innerWidth - MARGIN) left = rect.left - BOX_WIDTH - 16;
  left = clamp(left, MARGIN, window.innerWidth - BOX_WIDTH - MARGIN);
  const top = clamp(
    rect.top + rect.height / 2 - height / 2,
    MARGIN,
    window.innerHeight - height - MARGIN,
  );
  return { left, top };
}

/** The Guide's narration, written out inside the panel as NOVA "types" it.
 *
 *  - The full text is rendered invisibly underneath, so the panel is already its final size and does
 *    not jump or re-wrap as characters arrive.
 *  - The visible, progressively revealed layer is hidden from assistive tech: a screen reader never
 *    hears individual characters.
 *  - A polite live region carries the complete message, announced once when the message changes
 *    (and always available to read), regardless of how far the typing has got.
 *  - `whitespace-pre-line` keeps line breaks in the narration as line breaks.
 *  - The caret is the only "typing" indicator; under reduced motion the text is shown in full at once
 *    (lib/typewriter.ts) and the caret does not pulse (index.css).
 */
function NarrationText({
  full,
  typed,
  typing,
  size = "md",
  onSkip,
  spoken = false,
}: {
  full: string;
  typed: string;
  typing: boolean;
  size?: "md" | "lg";
  onSkip?: () => void;
  /** NOVA is also speaking this message aloud: the screen reader then stays quiet rather than read it a second time. */
  spoken?: boolean;
}) {
  return (
    <div className={clsx("mt-0.5 leading-relaxed text-fg", size === "lg" ? "text-base" : "text-sm")} data-typing={typing || undefined}>
      <div className="relative">
        <p aria-hidden="true" className="invisible whitespace-pre-line">
          {full}
        </p>
        <p aria-hidden="true" data-testid="guide-typed" className="absolute inset-0 whitespace-pre-line">
          {typed}
          {typing && <span data-testid="guide-caret" className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-corona" />}
        </p>
      </div>
      <p role="status" aria-live={spoken ? "off" : "polite"} className="sr-only" data-testid="guide-message">
        {full}
      </p>
      {typing && onSkip && (
        <button
          onClick={onSkip}
          className="mt-1.5 rounded px-1 text-[11px] text-fg-3 transition-colors duration-instant hover:text-fg"
          aria-label="Show the full message now"
        >
          Skip
        </button>
      )}
    </div>
  );
}

/** Runs one lesson step to completion against the real page (navigating there first if needed),
 * then hands over to the next step. See hooks/useNovaLesson.ts for the WATCH -> UNDERSTAND -> DO ->
 * VERIFY state machine this drives. A fresh instance mounts per step (the widget keys it by step.key).
 *
 * Spatial continuity: the panel is ONE element that grows out of where it was (the launcher for the
 * first step, the previous step's panel for every later one) into the centered presentation, then
 * travels to the control. It does not dock between steps: it only retracts into the launcher when
 * the whole tour is genuinely complete (the server reports no further step). */
function LessonRunner({
  step,
  origin,
  dockOrigin,
  autoNavigate,
  voice,
  introBeats,
  onIntroSeen,
  onDone,
}: {
  step: LessonStep;
  /** NOVA's opening, for the first lesson of a person who has not seen it yet. */
  introBeats?: string[];
  onIntroSeen?: () => void;
  voice: GuideVoice;
  /** Where the panel grows out of: the launcher, or the previous step's panel on a hand-off. */
  origin: DockRect | null;
  /** The launcher, which the panel retracts into when the whole tour is complete. */
  dockOrigin: DockRect | null;
  /** True when the Guide may take the visitor to this step's page by itself: right after signing
   * in, or right after the previous step finished. False on a plain page load/refresh somewhere
   * else — then the Guide waits for the visitor to choose to continue, so direct route access and
   * refreshes are never hijacked. */
  autoNavigate: boolean;
  /** Called exactly once. `next` is the step the SERVER says is current after this one was
   * verified (null when the tour is complete); `from` is this panel's last position, for the
   * hand-off. */
  onDone: (next: string | null, from: DockRect | null) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const startedRef = useRef(false);
  const [springingIn, setSpringingIn] = useState(!!origin);
  const doneOnceRef = useRef(false);
  const nextKeyRef = useRef<string | null>(null);
  const boxElRef = useRef<HTMLDivElement | null>(null);
  const [retracting, setRetracting] = useState(false);
  const [targetMissing, setTargetMissing] = useState(false);
  // The sequence (count, order, titles) comes from the server's progress payload, never from this
  // file's lesson list — see lib/novaLessons.ts. Same query key the rest of the app polls.
  const { data: progress } = useQuery({ queryKey: ["onboarding-progress"], queryFn: getOnboardingProgress });
  const away = !location.pathname.startsWith(step.path);
  const awayRef = useRef(away);
  awayRef.current = away;
  const [held, setHeld] = useState(!autoNavigate && away);
  // The box's real height (long messages and the "Return to step" control make it taller than any
  // fixed estimate). Positioning from the measured height keeps every control inside the viewport.
  const [boxHeight, setBoxHeight] = useState(BOX_HEIGHT_ESTIMATE);
  const boxObserverRef = useRef<ResizeObserver | null>(null);
  const measureBox = (el: HTMLDivElement | null) => {
    boxElRef.current = el;
    boxObserverRef.current?.disconnect();
    if (!el) return;
    setBoxHeight(el.offsetHeight || BOX_HEIGHT_ESTIMATE);
    if (typeof ResizeObserver !== "undefined") {
      boxObserverRef.current = new ResizeObserver(() => setBoxHeight(el.offsetHeight || BOX_HEIGHT_ESTIMATE));
      boxObserverRef.current.observe(el);
    }
  };

  const userTurnTarget = primaryActionTarget(step);
  // Voice is asked for only after an explicit choice; `enabled` is read at speak time, so switching
  // it on or off mid-lesson takes effect for the very next narration.
  const needsChoice = !held && voice.mode === null;
  const lessonVoice: NovaLessonVoice = {
    enabled: () => voice.enabled,
    speak: (text) => voice.engine.speak(text),
    replay: (text) => voice.engine.replay(text),
    cancel: () => voice.engine.cancel(),
    prefetch: (text) => {
      if (voice.enabled) voice.engine.prefetch(text);
    },
    position: () => voice.engine.position(),
  };

  const lesson = useNovaLesson({
    demoActions: step.demoActions,
    // NOVA's words are authored per lesson and kept short (lib/novaLessons.ts), so the tour never
    // waits on a network call before NOVA starts typing.
    introNarration: async () => step.intro,
    explainNarration: async () => step.explain,
    respondNarration: step.respond ? () => (VERIFIED_LINES[step.key]?.respond ?? ((f: string) => Promise.resolve(f)))(step.respond!) : undefined,
    verify: async () => {
      const progress = await getOnboardingProgress();
      const done = progress.steps.find((s) => s.key === step.key)?.status === "completed";
      // The server also tells us what comes next, so the hand-off needs no extra round trip.
      if (done) nextKeyRef.current = progress.current_step;
      return done;
    },
    completeNarration: () => (VERIFIED_LINES[step.key]?.done ?? ((f: string) => Promise.resolve(f)))(step.done),
    userTurnTarget,
    secondUserTurnTarget: step.secondUserTurnTarget,
    isAway: () => awayRef.current,
    voice: lessonVoice,
    preamble: introBeats,
    onPreambleDone: onIntroSeen,
  });

  // Switching voice on while a message is already on screen: speak it from the start now. (Switching
  // it off cancels in the preference hook.) Walking away from the step's page silences it too.
  const wasEnabledRef = useRef(voice.enabled);
  useEffect(() => {
    // Mid-typing: restart text and voice together. Already fully shown: just speak it (no re-typing).
    if (voice.enabled && !wasEnabledRef.current && lesson.message) void lesson.replay({ resetText: lesson.isTyping });
    wasEnabledRef.current = voice.enabled;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.enabled]);
  // The browser refused to play sound because the page has had no click yet (a returning visitor whose voice choice
  // is already saved). The first click or keypress anywhere is the permission it wants: speak then, so nobody has to
  // find Replay or flip voice off and on.
  useEffect(() => {
    if (!voice.blocked || voice.mode !== "voice" || !lesson.message) return;
    const resume = (e: Event) => {
      if ((e.target as Element | null)?.closest?.("[data-testid='guide-voice-controls']")) return; // those buttons act on their own
      void lesson.replay({ resetText: lesson.isTyping });
    };
    document.addEventListener("pointerdown", resume, { once: true, capture: true });
    document.addEventListener("keydown", resume, { once: true, capture: true });
    return () => {
      document.removeEventListener("pointerdown", resume, { capture: true });
      document.removeEventListener("keydown", resume, { capture: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.blocked, voice.mode, lesson.message]);
  useEffect(() => {
    if (away) voice.engine.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [away]);

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
    // No settle delay: NOVA starts typing as the panel moves into place.
    void lesson.start();
  }

  useEffect(() => {
    if (startedRef.current || held || needsChoice) return;
    startedRef.current = true;
    void attemptStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, needsChoice]);

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
    if (!origin) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => setSpringingIn(false));
    });
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentRect = (): DockRect | null => {
    const r = boxElRef.current?.getBoundingClientRect();
    return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
  };

  // As soon as the completion reply has finished typing (never before, never later): hand straight
  // over to the next step the server reported, or, if that was the last, retract into the launcher.
  useEffect(() => {
    if (lesson.phase !== "complete" || lesson.isTyping || doneOnceRef.current) return;
    const next = nextKeyRef.current;
    if (next && next !== step.key) {
      doneOnceRef.current = true;
      onDone(next, currentRect());
    } else {
      setRetracting(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.phase, lesson.isTyping]);

  // Retract: finish on the panel's own transition end, with a fallback in case no transition runs
  // (reduced motion, or a panel that did not need to move).
  const finishRetract = () => {
    if (doneOnceRef.current) return;
    doneOnceRef.current = true;
    onDone(null, null);
  };
  useEffect(() => {
    if (!retracting) return;
    const fallback = setTimeout(finishRetract, BOX_MOVE_MS + 80);
    return () => clearTimeout(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retracting]);

  // Every step opens with NOVA centered in the middle of the viewport over a softly blurred page
  // (the same panel element, so it visibly grows out of the launcher), and only after the
  // introduction has been typed does it travel to its working position and clear the backdrop.
  // The same presentation also answers the visitor: after the server verifies their action (and after
  // the first action of a two-action lesson), NOVA replies centered, then the next task begins.
  const presenting =
    !targetMissing && !retracting && ["idle", "intro", "respond", "complete"].includes(lesson.phase);
  const centerWidth = Math.min(CENTER_WIDTH, window.innerWidth - MARGIN * 2);
  const startRect = retracting ? dockOrigin : springingIn ? origin : null;
  const pos = startRect
    ? { left: startRect.left, top: startRect.top }
    : presenting
      ? { left: (window.innerWidth - centerWidth) / 2, top: Math.max(MARGIN, (window.innerHeight - boxHeight) / 2) }
      : boxPosition(lesson.spotlightRect ?? lesson.targetRect, boxHeight);
  const width = startRect ? startRect.width : presenting ? centerWidth : BOX_WIDTH;
  const serverIndex = progress ? progress.steps.findIndex((s) => s.key === step.key) : -1;
  const stepNumber = serverIndex >= 0 ? serverIndex + 1 : null;
  const stepTotal = progress?.total_steps ?? null;
  const meetingNova = lesson.beat !== null; // NOVA's opening, before the step itself
  const stepTitle = meetingNova ? "Meet NOVA" : (serverIndex >= 0 ? progress?.steps[serverIndex].title : undefined) ?? step.title;
  const showReturn = away && !retracting && ["explain", "user_turn", "verifying", "error"].includes(lesson.phase);

  const currentActionLabel =
    lesson.activeTarget && lesson.activeTarget === step.secondUserTurnTarget
      ? step.secondActionLabel ?? step.nextActionLabel
      : step.nextActionLabel;

  if (held) {
    return (
      <div
        className="theme-ink fixed bottom-6 right-6 z-50 w-80 rounded-xl border border-line bg-raised p-4 text-fg shadow-float"
        data-testid="guide-held"
      >
        <div className="flex items-start gap-3">
          <NovaFace look="center" />
          <div className="flex-1">
            <p className="font-mono text-[10.5px] font-medium uppercase tracking-label text-corona">GUIDED TOUR PAUSED</p>
            <p className="mt-0.5 text-sm leading-relaxed text-fg">
              {stepNumber && stepTotal ? `Next up, step ${stepNumber} of ${stepTotal}: ` : "Next up: "}
              {stepTitle}. Look around freely; I'll pick up whenever you're ready.
            </p>
            <button
              onClick={() => {
                setHeld(false);
                navigate(step.path);
              }}
              className="mt-2 rounded-md bg-corona px-3 py-1 text-xs font-medium text-corona-on shadow-glow"
            >
              Continue the tour
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (needsChoice) return <GuideVoiceChoice supported={voice.supported} engineUnavailable={voice.engineUnavailable} onChoose={voice.setMode} />;

  return (
    <>
      {/* Restrained backdrop for the centered presentation: a soft blur and gentle dim, gone (and
          no longer catching clicks) the moment the introduction ends, before anything is asked of
          the visitor. */}
      <div
        aria-hidden="true"
        data-nova-scrim
        data-state={presenting ? "on" : "off"}
        className={clsx(
          "fixed inset-0 z-40 bg-fg/20 backdrop-blur-[5px] transition-opacity duration-quick ease-in-out-soft",
          presenting ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <NovaSpotlight
        rect={retracting || targetMissing || away ? null : lesson.spotlightRect}
        mode={lesson.phase === "demo" ? "focus" : "cue"}
      />
      <div
        ref={measureBox}
        onTransitionEnd={(e) => {
          if (retracting && (e.propertyName === "left" || e.propertyName === "top")) finishRetract();
        }}
        className="theme-ink fixed z-50 overflow-hidden rounded-xl border border-line bg-raised p-4 text-fg shadow-float"
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
              <p className="font-mono text-[10.5px] font-medium uppercase tracking-label text-bad">CAN'T FIND THAT YET</p>
              <p className="mt-0.5 text-sm leading-relaxed text-fg">
                I can't find the right control on this page yet — it may still be loading.
              </p>
              <button
                onClick={() => void attemptStart()}
                className="mt-2 rounded-md border border-line-strong px-3 py-1 text-xs font-medium text-fg hover:bg-sunken"
              >
                Try again
              </button>
            </div>
          </div>
        ) : presenting ? (
          <div className="flex flex-col gap-3 px-2 pb-1 pt-2" data-nova-presentation>
            <div className="flex items-center gap-3">
              <NovaFace size={44} talking={lesson.isTyping} look="center" />
              <p className="eyebrow !text-corona">
                NOVA{!meetingNova && stepNumber && stepTotal ? ` · Step ${stepNumber} of ${stepTotal}` : ""}
              </p>
            </div>
            <h2 className="font-display text-[30px] leading-[1.1] tracking-[-0.015em] text-fg" data-testid="guide-step-title">
              {stepTitle}
            </h2>
            {lesson.message === null ? (
              <p aria-hidden className="min-h-[3.25rem]" />
            ) : (
              <>
                <NarrationText size="lg" full={lesson.message} typed={lesson.typedMessage} typing={lesson.isTyping} onSkip={lesson.skipTyping} spoken={voice.enabled} />
                <GuideVoiceControls voice={voice} text={lesson.message} onReplay={() => void lesson.replay()} />
              </>
            )}
            {meetingNova && (
              <button
                type="button"
                onClick={lesson.skipPreamble}
                data-testid="guide-skip-intro"
                className="self-start rounded px-1 text-[11px] text-fg-3 transition-colors duration-instant hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-corona"
              >
                Skip intro
              </button>
            )}
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
                      ? "font-mono text-[10.5px] font-medium uppercase tracking-label text-bad"
                      : "font-mono text-[10.5px] font-medium uppercase tracking-label text-corona"
                  }
                >
                  {PHASE_LABEL[lesson.phase] ?? ""}
                </p>
                {lesson.phase === "error" ? (
                  <p className="mt-0.5 text-sm leading-relaxed text-fg">
                    That doesn't seem to have gone through yet — check the form for anything NOVA can't fill in for you, then try again.
                  </p>
                ) : lesson.message === null ? (
                  <p className="mt-0.5 text-sm leading-relaxed text-fg">{step.title}</p>
                ) : (
                  <>
                    <NarrationText full={lesson.message} typed={lesson.typedMessage} typing={lesson.isTyping} onSkip={lesson.skipTyping} spoken={voice.enabled} />
                    <GuideVoiceControls voice={voice} text={lesson.message} onReplay={() => void lesson.replay()} />
                  </>
                )}
              </div>
            </div>

            {SHOWS_NEXT_ACTION[lesson.phase] && (
              <div className="mt-3 border-t border-line pt-2">
                <p className="text-xs font-medium text-fg">
                  Next: click <span className="font-semibold">"{currentActionLabel}"</span>
                </p>
                <p className="mt-0.5 text-[11px] text-fg-3">{step.afterActionHint}</p>
                {lesson.phase === "error" && (
                  <button
                    onClick={lesson.retry}
                    className="mt-2 rounded-md border border-line-strong px-3 py-1 text-xs font-medium text-fg hover:bg-sunken"
                  >
                    Try again
                  </button>
                )}
              </div>
            )}

            {showReturn && (
              <div className="mt-3 border-t border-line pt-2" data-testid="guide-return">
                <p className="text-xs text-fg-2">You've stepped away from this step. Your progress is saved.</p>
                <button
                  onClick={() => navigate(step.path)}
                  className="mt-1.5 rounded-md bg-corona px-3 py-1 text-xs font-medium text-corona-on shadow-glow"
                >
                  Return to step{stepNumber ? ` ${stepNumber}` : ""}
                </button>
              </div>
            )}

            {stepNumber !== null && stepTotal !== null && (
              <p className="mt-3 border-t border-line pt-2 text-[11px] font-medium text-fg-3">
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
  const userKey = useCurrentUserKey();
  const voice = useGuideVoice(userKey);
  const introKey = userKey ?? "anonymous";
  const [introSeen, setIntroSeen] = useState(() => loadIntroSeen(introKey));
  const voiceEnabledRef = useRef(false);
  voiceEnabledRef.current = voice.enabled;
  const [faqOpen, setFaqOpen] = useState(false);
  const [faqInput, setFaqInput] = useState("");
  const [faqReply, setFaqReply] = useState<string | null>(null);
  const [faqSending, setFaqSending] = useState(false);
  const faqConversationId = useRef<string | null>(null);
  const [activeStepKey, setActiveStepKey] = useState<string | null>(null);
  // NOVA never goes backwards. `furthestRef` is the furthest step this session has started; the
  // Guide will only ever start a step at or beyond it on its own. If the server later says an
  // EARLIER step is current again (its data changed), the Guide does not navigate back or replay it:
  // it shows a recovery card and lets the visitor choose to revisit it.
  const furthestRef = useRef(-1);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const dismissedRecoveryRef = useRef<string | null>(null);
  // Where the next step's panel grows out of: the previous step's panel (hand-off), else the launcher.
  const handoffRectRef = useRef<DockRect | null>(null);
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
  // The hand-off position is only for the runner that mounts right after it; never reuse it later.
  useEffect(() => {
    handoffRectRef.current = null;
  }, [activeStepKey]);
  const lessonIndex = (key: string) => LESSON_STEPS.findIndex((l) => l.key === key);

  /** Start a lesson. Automatic starts may never go to a step earlier than one already started; a
   * deliberate visitor choice (`byUser`) may. */
  function startLesson(key: string, { byUser = false }: { byUser?: boolean } = {}) {
    const index = lessonIndex(key);
    if (index < 0) return;
    if (!byUser && index < furthestRef.current) {
      if (dismissedRecoveryRef.current !== key) setRecoveryKey(key);
      return;
    }
    furthestRef.current = Math.max(furthestRef.current, index);
    dismissedRecoveryRef.current = null;
    setRecoveryKey(null);
    setActiveStepKey(key);
  }

  useEffect(() => {
    if (activeStepKey) return; // a lesson is already running — it verifies its own completion
    const currentStep = progress?.current_step ?? null;
    if (currentStep !== justDoneRef.current) justDoneRef.current = null;
    if (currentStep && currentStep !== justDoneRef.current && getLessonStep(currentStep)) startLesson(currentStep);
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
      const result = await postMessage(faqConversationId.current, text, location.pathname.split("/")[1] || undefined, getSessionFocus()); // the screen the person is on, and what they have selected
      setFaqReply(result.assistant_text);
      if (voiceEnabledRef.current) voice.engine.speak(result.assistant_text);
    } catch (err) {
      // Server messages for AI problems (not configured, credentials rejected, busy) are safe and actionable: show them.
      setFaqReply(err instanceof ApiError && err.code.startsWith("ai_") ? err.message : ASSISTANT_ERROR);
    } finally {
      setFaqSending(false);
    }
  }

  const activeStep = activeStepKey ? getLessonStep(activeStepKey) : undefined;

  if (activeStep) {
    return (
      <LessonRunner
        key={activeStep.key}
        step={activeStep}
        origin={handoffRectRef.current ?? dockRectRef.current}
        dockOrigin={dockRectRef.current}
        autoNavigate={autoNavigateRef.current}
        voice={voice}
        introBeats={activeStep.key === "brand" && !introSeen ? NOVA_INTRO_BEATS : undefined}
        onIntroSeen={() => {
          saveIntroSeen(introKey);
          setIntroSeen(true);
        }}
        onDone={(next, from) => {
          autoNavigateRef.current = true;
          justDoneRef.current = activeStep.key;
          handoffRectRef.current = next ? from : null;
          void queryClient.invalidateQueries({ queryKey: ["onboarding-progress"] });
          if (next) startLesson(next); // the server-reported next step; never an earlier one
          else setActiveStepKey(null);
        }}
      />
    );
  }

  const recoveryStep = recoveryKey ? getLessonStep(recoveryKey) : undefined;
  const recoveryNumber = recoveryKey ? lessonIndex(recoveryKey) + 1 : null;

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {recoveryStep && (
        <div
          data-testid="guide-recovery"
          role="alert"
          className="theme-ink nova-pop-in absolute bottom-full right-0 mb-2 w-80 rounded-xl border border-line bg-raised p-4 text-fg shadow-float"
        >
          <p className="font-mono text-[10.5px] font-medium uppercase tracking-label text-corona">
            STEP {recoveryNumber} NEEDS ANOTHER LOOK
          </p>
          <p className="mt-1 text-sm leading-relaxed text-fg">
            "{recoveryStep.title}" is no longer complete, so I haven't taken you back. Everything after it is safe.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => startLesson(recoveryStep.key, { byUser: true })}
              className="rounded-md bg-corona px-3 py-1 text-xs font-medium text-corona-on shadow-glow"
            >
              Revisit step {recoveryNumber}
            </button>
            <button
              onClick={() => {
                dismissedRecoveryRef.current = recoveryStep.key;
                setRecoveryKey(null);
              }}
              className="rounded-md border border-line-strong px-3 py-1 text-xs font-medium text-fg hover:bg-sunken"
            >
              Not now
            </button>
          </div>
        </div>
      )}
      {faqOpen && (
        <div className="theme-ink nova-pop-in absolute bottom-full right-0 mb-2 w-80 rounded-xl border border-line bg-raised p-3 text-fg shadow-float">
          <p className="eyebrow mb-2">NOVA HELP</p>
          {faqReply && <p className="mb-2 text-sm leading-relaxed text-fg">{faqReply}</p>}
          {!faqReply && <p className="mb-2 text-xs text-fg-3">{ASSISTANT_EMPTY_HINT}</p>}
          <GuideVoiceControls voice={voice} text={faqReply} />
          <AiStatusNote className="mt-2" />
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
              className="flex-1 rounded-md border border-line-strong bg-sunken px-2 py-1 text-sm text-fg placeholder:text-fg-3"
            />
            <button
              type="submit"
              disabled={faqSending}
              className="rounded-md bg-corona px-2.5 py-1 text-xs font-medium text-corona-on disabled:opacity-50"
            >
              {faqSending ? "…" : "Send"}
            </button>
          </form>
        </div>
      )}
      <button
        ref={measureDock}
        onClick={() => {
          if (faqOpen) voice.engine.cancel(); // closing the help bubble stops it talking
          setFaqOpen((o) => !o);
        }}
        className="theme-ink flex items-center gap-2 rounded-full border border-line bg-raised py-1.5 pl-1.5 pr-4 text-sm text-fg-2 shadow-float transition-colors duration-instant hover:bg-sunken hover:text-fg"
      >
        <NovaFace size={26} talking={faqSending || !!faqReply} />
        <span>{faqOpen ? "Hide" : "Ask me anything"}</span>
      </button>
    </div>
  );
}
