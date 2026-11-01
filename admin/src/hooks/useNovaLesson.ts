import { useEffect, useRef, useState } from "react";
import { type UIAction, getTarget, runUIActions } from "../lib/novaUiActions";
import { prefersReducedMotion, Typewriter } from "../lib/typewriter";

/** The loop NOVA's Guide runs for every onboarding step:
 *
 *   WATCH      intro   NOVA introduces the step, centered over a softly blurred page (typed).
 *              demo    The presentation steps aside and NOVA demonstrates on the real page; it never
 *                      persists a real mutation itself.
 *   UNDERSTAND explain NOVA says why, in the working panel. The page is already usable.
 *   DO         user_turn  The visitor performs the real action; the real control is cued.
 *   VERIFY     verifying  The instant they act, the real backend state is checked (a fast burst, not a
 *                         slow poll). Shown only while that check is genuinely in flight.
 *              respond    After the FIRST action of a two-action lesson: a short centered reply.
 *              complete   Verified by the server: a short centered reply, then the next step.
 *
 * The server (via `verify`) is always the source of truth for completion: this hook holds no
 * completion state of its own beyond what `verify` just confirmed, and nothing here touches
 * localStorage. There are no decorative timers in this machine: each phase starts the moment the
 * previous one's real work (typing, demo actions, verification) is done. */
export type NovaLessonPhase = "idle" | "intro" | "demo" | "explain" | "user_turn" | "respond" | "verifying" | "error" | "complete";

export interface NovaLessonConfig {
  demoActions: UIAction[];
  /** The introduction typed in the centered presentation that opens the step. */
  introNarration: () => Promise<string>;
  explainNarration: () => Promise<string>;
  /** Typed centered after the visitor's first real action in a two-action lesson (see
   * `secondUserTurnTarget`); omitted for single-action lessons. */
  respondNarration?: () => Promise<string>;
  /** Checks real, persisted state. Never client state: this is the only thing that can ever advance
   * a lesson to "complete". Started immediately when the visitor acts, and polled meanwhile. */
  verify: () => Promise<boolean>;
  completeNarration: () => Promise<string>;
  /** The real control the user needs to act on, cued for the whole user turn (not just NOVA's own demo). */
  userTurnTarget?: string;
  /** For a lesson needing a second real action after the first succeeds (e.g. nl_edit: propose a
   * Change Plan, then separately apply it): the instant this target exists in the DOM (the first
   * action succeeded and produced it), NOVA replies and the cue moves to it, still gated on `verify`. */
  secondUserTurnTarget?: string;
  /** True while the visitor is away from the page this lesson lives on. The stuck/error backstop
   * is held off for as long as it is: wandering around the app is not a failed attempt. Server
   * verification still runs, so doing the real action elsewhere still completes the step. */
  isAway?: () => boolean;
  /** Background verification interval while waiting for the visitor (default 1000 ms). */
  pollMs?: number;
  /** After the visitor acts: how often to re-verify, and for how long, before concluding that
   * nothing is in flight and going back to waiting (defaults 120 ms / 3000 ms). */
  verifyBurstMs?: number;
  verifyWindowMs?: number;
  /** Milliseconds paced between each demo action (tests shrink it). */
  actionPaceMs?: number;
  /** How long in user_turn with no successful verification before surfacing the error/retry state:
   * a generous backstop, not a per-click timer. */
  stuckTimeoutMs?: number;
  /** Optional spoken delivery of the SAME narration that is shown. Read through a ref, so it can be
   * switched on or off (or replaced) mid-lesson. While voice is on, the text is revealed in step with
   * the audio's real playback (starting the moment it starts); if the audio cannot start, the text is
   * typed at the normal pace instead, so speech can never hold the lesson up. */
  voice?: NovaLessonVoice;
  /** How long to wait for audio to begin before giving up on it for this message (default 6 s). */
  voiceStartTimeoutMs?: number;
  /** NOVA's opening, shown beat by beat in the centered presentation before the step's own introduction
   * (only passed for the very first lesson, once per person). Each beat is typed and spoken like any other
   * narration and the next follows as soon as it finishes. `skipPreamble()` ends it early. */
  preamble?: string[];
  onPreambleDone?: () => void;
  /** Text-only breathing room between preamble beats (voice has its own natural gap). Default 700 ms. */
  beatGapMs?: number;
}

export interface NovaLessonVoice {
  /** Voice is chosen and usable right now (read at the moment each narration begins). */
  enabled: () => boolean;
  /** Start speaking; resolves "playing" when audio is audibly playing, "unavailable" if it will not. */
  speak: (text: string) => Promise<"playing" | "unavailable">;
  replay: (text: string) => Promise<"playing" | "unavailable">;
  cancel: () => void;
  /** Optional: begin fetching the audio for an upcoming narration so it starts without a gap. */
  prefetch?: (text: string) => void;
  /** Characters of the current narration spoken so far (null when no audio is playing it). */
  position: () => number | null;
}

/** Resolves after the next paint (with a short fallback for hidden tabs where frames do not run), so a
 * message's last character is actually on screen before anything else moves. About one frame. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => finish());
    setTimeout(finish, 50);
  });
}

const DEFAULT_VOICE_START_TIMEOUT_MS = 6000;
const DEFAULT_BEAT_GAP_MS = 700;
const DEFAULT_STUCK_TIMEOUT_MS = 20000;
const DEFAULT_POLL_MS = 1000;
const DEFAULT_VERIFY_BURST_MS = 120;
const DEFAULT_VERIFY_WINDOW_MS = 3000;
// While these phases are active the real backend state is being watched.
const WATCHED: NovaLessonPhase[] = ["explain", "respond", "user_turn", "verifying"];

export function useNovaLesson(config: NovaLessonConfig) {
  const [phase, setPhase] = useState<NovaLessonPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  // Where the control the visitor will use is, whether or not the cue ring is showing yet. The panel
  // positions itself beside it from the start of the explanation, so it never sits on top of the very
  // control the visitor is about to press while NOVA is still typing.
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const startedRef = useRef(false);
  const prevTargetRef = useRef<string | null>(null);
  const startedAtRef = useRef(Date.now());

  // Narration is revealed progressively (lib/typewriter.ts). `message` is always the FULL text, so
  // assistive tech and tests can read it at once; `typedMessage` is what has been revealed so far.
  const [beat, setBeat] = useState<{ index: number; total: number } | null>(null);
  const preambleSkippedRef = useRef(false);
  const [typedMessage, setTypedMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const configRef = useRef(config);
  configRef.current = config;
  const typerRef = useRef<Typewriter | null>(null);
  if (!typerRef.current) {
    typerRef.current = new Typewriter((typed, typing) => {
      setTypedMessage(typed);
      setIsTyping(typing);
    });
  }
  const typer = typerRef.current;
  // Which narration is currently being presented. A newer one (or a skip) makes older, still-waiting
  // presentations stale, so they can never go on to start text or audio for a message that was replaced.
  const showRef = useRef({ id: 0, skipped: false });
  const messageRef = useRef<string | null>(null);
  const startingRef = useRef(false); // a narration is waiting for its audio to begin

  /** Wait for audio to begin, but never longer than the configured grace: `true` once it is audibly playing. */
  const audioStarts = async (starting: Promise<"playing" | "unavailable">): Promise<boolean> => {
    const timeoutMs = configRef.current.voiceStartTimeoutMs ?? DEFAULT_VOICE_START_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      starting,
      new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), timeoutMs))),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (result === "timeout") configRef.current.voice?.cancel(); // a late start must not talk over text typed meanwhile
    return result === "playing";
  };

  /** Show a narration: publish the full text, then reveal it. With voice on, the audio and the text begin
   * from the same moment and the text follows the audio's real playback (pause freezes it, the end of the
   * audio completes it); without voice, or if the audio cannot start, it is typed at the normal pace.
   * Resolves once the whole message is on screen (`false` if it was replaced or the Guide went away). */
  const show = async (text: string): Promise<boolean> => {
    const mine = (showRef.current = { id: showRef.current.id + 1, skipped: false });
    const stale = () => showRef.current !== mine || unmountedRef.current;
    messageRef.current = text;
    setMessage(text);
    const voice = configRef.current.voice;

    let finished: boolean;
    if (voice && voice.enabled()) {
      if (prefersReducedMotion()) {
        // Nothing animates under reduced motion: the whole text is there at once, and the voice speaks it.
        void voice.speak(text);
        finished = await typer.play(text);
      } else {
        typer.hold(); // text and voice begin together: nothing is revealed until the audio is playing
        startingRef.current = true;
        const playing = await audioStarts(voice.speak(text));
        if (showRef.current === mine) startingRef.current = false;
        if (stale()) return false;
        if (mine.skipped) {
          const all = typer.play(text);
          typer.skip();
          finished = await all;
        } else {
          finished = await (playing ? typer.playSynced(text, () => voice.position()) : typer.play(text));
        }
      }
    } else {
      finished = await typer.play(text);
    }
    if (finished) await afterPaint(); // the last character is rendered before the sequence moves on
    return finished;
  };

  /** End NOVA's opening early: the message being shown is completed and the step begins. */
  function skipPreamble() {
    preambleSkippedRef.current = true;
    skipTyping();
  }

  /** Replay the current narration: audio and text both go back to the start and run together again. */
  async function replay({ resetText = true }: { resetText?: boolean } = {}): Promise<void> {
    const text = messageRef.current;
    const voice = configRef.current.voice;
    if (!text || !voice || !voice.enabled()) return;
    // A message still waiting for its audio to begin is about to be spoken from the start anyway.
    if (startingRef.current) return;
    const current = showRef.current; // a newer narration (or a skip) makes this replay stale
    const stale = () => showRef.current !== current || unmountedRef.current;
    if (!resetText || prefersReducedMotion()) {
      void voice.replay(text); // the text is already as it should be; only the voice speaks
      return;
    }
    typer.restart(); // empty again, keeping whoever is waiting for this message to finish
    const playing = await audioStarts(voice.replay(text));
    if (stale()) return;
    await typer.resume(playing ? () => voice.position() : null);
  }

  // The cue ring (the only spotlight movement after the demo) waits until NOVA has finished the
  // sentence it is typing. Verification does NOT wait: it runs from the start of the explanation, so
  // a visitor who already knows what to do is never held up.
  const cueReadyRef = useRef(false);
  // Set once the real backend state has been verified; nothing from the earlier sequence may
  // continue after that, and the completion reply can only start once.
  const finishedRef = useRef(false);
  const respondedRef = useRef(false);
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      typer.cancel(); // no pending character timers once the Guide is gone
      configRef.current.voice?.cancel();
    };
  }, [typer]);
  const stale = () => unmountedRef.current || finishedRef.current;

  async function start() {
    if (startedRef.current) return;
    startedRef.current = true;

    let introText: string;
    try {
      introText = await config.introNarration();
    } catch {
      introText = "Let's do this step together.";
    }
    // NOVA introduces itself first (only for the first lesson, once per person), beat by beat.
    const beats = configRef.current.preamble;
    if (beats && beats.length > 0) {
      setPhase("intro");
      for (let i = 0; i < beats.length && !preambleSkippedRef.current; i++) {
        setBeat({ index: i, total: beats.length });
        // The next beat's audio is fetched while this one plays, so beats follow each other without a gap.
        configRef.current.voice?.prefetch?.(i + 1 < beats.length ? beats[i + 1] : introText);
        const shown = await show(beats[i]);
        if (!shown || stale()) return;
        const voiced = configRef.current.voice?.enabled();
        if (!voiced && i < beats.length - 1 && !preambleSkippedRef.current) {
          await new Promise((resolve) => setTimeout(resolve, configRef.current.beatGapMs ?? DEFAULT_BEAT_GAP_MS));
          if (stale()) return;
        }
      }
      setBeat(null);
      configRef.current.onPreambleDone?.();
    }

    // WATCH, part 1: the centered introduction. Typing starts the moment the panel is placed; the
    // demonstration begins the moment the last character lands (the panel moves and the backdrop
    // clears in parallel with it, not before it).
    setPhase("intro");
    if (!(await show(introText)) || stale()) return;

    setPhase("demo");
    await runUIActions(config.demoActions, { onSpotlight: setSpotlightRect }, config.actionPaceMs);
    if (stale()) return;
    setSpotlightRect(null);

    // UNDERSTAND: typed in the working panel while the page is already usable. Verification is
    // already watching (see the watcher below), so acting early is never held up by this typing.
    setPhase("explain");
    let explainText: string;
    try {
      explainText = await config.explainNarration();
    } catch {
      explainText = "Now it's your turn — go ahead and try it yourself.";
    }
    if (!(await show(explainText)) || stale()) return;

    // DO. If the visitor already acted during the explanation, they are in "verifying": leave that be.
    cueReadyRef.current = true;
    prevTargetRef.current = config.userTurnTarget ?? null;
    setActiveTarget(config.userTurnTarget ?? null);
    setPhase((p) => (p === "explain" ? "user_turn" : p));
  }

  /** After the visitor's first real action in a two-action lesson: a short centered reply, then the
   * cue moves to the second control. */
  async function respond() {
    setSpotlightRect(null);
    cueReadyRef.current = false;
    setPhase("respond");
    let text: string;
    try {
      text = await config.respondNarration!();
    } catch {
      text = "Good. One more step.";
    }
    if (!(await show(text)) || stale()) return;
    cueReadyRef.current = true;
    setPhase((p) => (p === "respond" ? "user_turn" : p));
  }

  /** The reader chose not to wait: reveal the message that is currently being typed, right now. */
  function skipTyping() {
    showRef.current.skipped = true; // also covers a message still waiting for its audio to begin
    typer.skip();
    configRef.current.voice?.cancel(); // skipping ahead means the reader no longer wants the narration read
  }

  /** Surfaced for the "ERROR/RETRY" state: dismisses the error and resumes watching the same target
   * with a fresh grace period. Never re-runs the demo or re-narrates. */
  function retry() {
    setPhase("user_turn");
  }

  // The watcher: while the lesson is waiting on the visitor it (1) picks which real target to cue,
  // (2) verifies the real backend state, and (3) after the visitor acts, verifies in a fast burst so
  // the response is prompt and "checking" is only ever shown while a check is actually running.
  useEffect(() => {
    if (!WATCHED.includes(phase)) return;
    let cancelled = false;
    startedAtRef.current = Date.now();
    const burst = phase === "verifying";
    const stuckMs = config.stuckTimeoutMs ?? DEFAULT_STUCK_TIMEOUT_MS;
    const windowMs = config.verifyWindowMs ?? DEFAULT_VERIFY_WINDOW_MS;

    const tick = async () => {
      if (cancelled || finishedRef.current) return;
      const secondEl = config.secondUserTurnTarget ? getTarget(config.secondUserTurnTarget) : null;
      const current = secondEl ? config.secondUserTurnTarget! : config.userTurnTarget ?? null;
      if (current !== prevTargetRef.current) {
        prevTargetRef.current = current;
        setActiveTarget(current);
        if (secondEl && config.respondNarration && !respondedRef.current) {
          // The first action succeeded and revealed the second control: reply, then move on.
          respondedRef.current = true;
          cancelled = true;
          void respond();
          return;
        }
        setPhase((p) => (p === "verifying" ? "user_turn" : p));
      }
      const el = current ? getTarget(current) : null;
      const rect = el ? el.getBoundingClientRect() : null;
      setTargetRect(rect);
      setSpotlightRect(rect && cueReadyRef.current ? rect : null);

      let verified = false;
      try {
        verified = await config.verify();
      } catch {
        verified = false;
      }
      if (cancelled || finishedRef.current) return;
      if (verified) {
        cancelled = true;
        finishedRef.current = true;
        setSpotlightRect(null);
        typer.cancel(); // stop typing anything that is no longer needed
        let doneText: string;
        try {
          doneText = await config.completeNarration();
        } catch {
          doneText = "Done — nicely handled.";
        }
        if (unmountedRef.current) return;
        const typed = show(doneText); // the reply types out, centered, straight away
        setPhase("complete");
        await typed;
        return;
      }
      // Not verified (yet).
      if (burst && Date.now() - startedAtRef.current > windowMs) {
        // The click did not start anything the server can see (e.g. the form rejected it): stop
        // showing "checking" and go back to waiting. Background polling still catches slower work.
        cancelled = true;
        setPhase("user_turn");
        return;
      }
      if (config.isAway?.()) startedAtRef.current = Date.now();
      if (phase === "user_turn" && Date.now() - startedAtRef.current > stuckMs) {
        cancelled = true;
        setPhase("error");
      }
    };

    void tick(); // immediately: never wait for the next interval to verify
    const interval = setInterval(tick, burst ? config.verifyBurstMs ?? DEFAULT_VERIFY_BURST_MS : config.pollMs ?? DEFAULT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // The instant the visitor actually clicks the real, currently-cued control, acknowledge it and
  // start verifying (the phase change restarts the watcher, whose first tick runs immediately).
  // This also covers the explanation: the page is usable while NOVA is still typing it, and a visitor
  // who acts then must get the same immediate check, not one that waits for the next background poll.
  useEffect(() => {
    if ((phase !== "user_turn" && phase !== "explain") || !activeTarget) return;
    const el = getTarget(activeTarget);
    if (!el) return;
    const onClick = () => setPhase((p) => (p === "user_turn" || p === "explain" ? "verifying" : p));
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [phase, activeTarget]);

  return { phase, message, typedMessage, isTyping, spotlightRect, targetRect, activeTarget, start, retry, skipTyping, replay, beat, skipPreamble };
}
