/**
 * Progressive narration for the NOVA Guide: the text is revealed character by character inside the
 * Guide's own panel, so NOVA reads as actively writing its response.
 *
 * Pacing is the typing itself. There is no extra "reading" delay on top of it: the lesson continues
 * the moment the last character appears.
 *
 *  - One tick per VISIBLE character (`narrationTiming.charMs`, 167 ms = 6 characters per second).
 *    The narration itself is kept short (see lib/novaLessons.ts) and the reader can release any
 *    message instantly with `skip()`.
 *  - Whitespace (spaces, line breaks) costs no tick of its own; it is revealed together with the next
 *    visible character, so words and lines appear naturally and a space never stalls the text.
 *  - Punctuation is an ordinary character: no added pauses.
 *  - The first character appears immediately; a very short message finishes quickly.
 *  - `prefers-reduced-motion`: the full text appears at once (nothing animates), and the sequence
 *    continues without delay.
 *
 * With voice on, the cadence above is NOT used: `playSynced` reveals the text from the audio's real
 * playback position (lib/guideVoice.ts NovaVoice.position), so text and voice start together, pause
 * together and finish together; if the audio goes away it falls back to this cadence.
 *
 * The narration the provider returns today is a complete message, so it is revealed here on the
 * frontend. The controller also accepts a message that GROWS (the new text starts with what was
 * already target): it keeps typing from where it is instead of restarting or repeating characters,
 * so a real token stream could be wired in without buffering the whole response first.
 */

export const narrationTiming = {
  /** Milliseconds per visible character. 167 ms is 6 characters per second. */
  charMs: Number(import.meta.env?.VITE_NARRATION_CHAR_MS) || 167,
};

/** Test/dev knob. Not used by product code. */
export function setNarrationTiming(next: Partial<typeof narrationTiming>) {
  Object.assign(narrationTiming, next);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Prefix lengths (in UTF-16 units) to display at each tick: one entry per visible code point.
 * Whitespace never gets its own entry; it is included in the prefix of the next visible character,
 * and trailing whitespace is folded into the final entry. Code points are never split, so emoji and
 * other astral characters appear whole.
 */
export function revealFrames(text: string): number[] {
  const frames: number[] = [];
  let index = 0;
  for (const ch of text) {
    index += ch.length;
    if (!/\s/u.test(ch)) frames.push(index);
  }
  if (frames.length > 0) frames[frames.length - 1] = text.length;
  return frames;
}

/** How often a voice-driven reveal re-reads the audio's position (about two frames). */
export const SYNC_POLL_MS = 33;

/** How many reveal frames are due when `position` characters of the text have been spoken. */
export function framesRevealedBy(frames: number[], position: number): number {
  let n = 0;
  while (n < frames.length && frames[n] <= position) n += 1;
  return n;
}

/** Reports how far the narration has been spoken, as a character offset into its text; `null` once the
 * audio is no longer playing it (cancelled, muted, failed). Implemented by the voice engine. */
export type SpokenPosition = () => number | null;

export class Typewriter {
  private driver: SpokenPosition | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private target = "";
  private frames: number[] = [];
  private shown = 0; // frames revealed so far
  private typing = false;
  private waiters: Array<(finished: boolean) => void> = [];

  constructor(private readonly onUpdate: (typed: string, typing: boolean) => void) {}

  /**
   * Start revealing `text`. Resolves `true` when every character is on screen, or `false` if this
   * reveal was cancelled or replaced first (so a caller never continues a stale sequence).
   * Calling again with text that extends the current target keeps typing in place.
   */
  play(text: string): Promise<boolean> {
    const extending = this.target !== "" && text.startsWith(this.target);

    if (extending && text === this.target) {
      // Same text again: already shown (or being shown). Do not retype it.
      return this.typing ? this.wait() : Promise.resolve(true);
    }

    if (extending) {
      this.target = text;
      this.frames = revealFrames(text);
      const waiting = this.wait();
      if (this.timer === null && !this.typing) this.begin(true);
      return waiting;
    }

    this.cancel();
    this.target = text;
    this.frames = revealFrames(text);
    this.shown = 0;
    const waiting = this.wait();
    this.begin(false);
    return waiting;
  }

  /** Whether a reveal is in progress (text still arriving). */
  get active(): boolean {
    return this.typing;
  }

  /** The narration is about to be spoken but the audio has not started: clear the text and wait, so text
   * and voice begin together. Releases whoever waited on the previous reveal with `false`. */
  hold() {
    this.cancel();
    this.target = "";
    this.frames = [];
    this.shown = 0;
    this.typing = true;
    this.onUpdate("", true);
  }

  /**
   * Reveal `text` in step with the audio instead of on a fixed cadence: each tick shows whatever
   * `position()` says has been spoken. Pausing the audio freezes the text, resuming continues it, and
   * the reveal finishes when the audio reaches the end. If the audio goes away mid-way (`position()`
   * returns null: muted, failed) the rest is typed at the normal pace from where it got to. Resolves
   * like `play`.
   */
  playSynced(text: string, position: SpokenPosition): Promise<boolean> {
    this.cancel();
    this.target = text;
    this.frames = revealFrames(text);
    this.shown = 0;
    const waiting = this.wait();
    this.beginSynced(position);
    return waiting;
  }

  /** Back to an empty start for the CURRENT text (Replay), keeping whoever waits for it to finish. */
  restart() {
    this.stopTimer();
    this.shown = 0;
    this.typing = this.target !== "";
    this.onUpdate("", this.typing);
  }

  /** Continue revealing the current text from where it stands, synced to `position` or, with null, at the
   * normal pace. Used after `restart` (Replay). */
  resume(position: SpokenPosition | null): Promise<boolean> {
    const waiting = this.wait();
    this.stopTimer();
    if (this.target === "" || this.frames.length === 0) {
      this.finish();
    } else if (position && !prefersReducedMotion()) {
      this.beginSynced(position);
    } else {
      this.begin(false);
    }
    return waiting;
  }

  private stopTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.driver = null;
  }

  private beginSynced(position: SpokenPosition) {
    if (prefersReducedMotion() || this.frames.length === 0) {
      this.shown = this.frames.length;
      this.finish();
      return;
    }
    this.driver = position;
    this.typing = true;
    this.syncTick();
  }

  private syncTick() {
    this.timer = null;
    const position = this.driver?.();
    if (position === null || position === undefined) {
      this.driver = null;
      this.begin(this.shown > 0); // the voice is gone: carry on at the normal pace, never restart
      return;
    }
    const due = framesRevealedBy(this.frames, position);
    if (due > this.shown) {
      this.shown = due; // never backwards
      this.emit();
    }
    if (this.shown >= this.frames.length || position >= this.target.length) {
      this.shown = this.frames.length;
      this.finish();
      return;
    }
    this.timer = setTimeout(() => this.syncTick(), SYNC_POLL_MS);
  }

  /** Reveal everything that is still pending right now (the reader chose not to wait). Waiters get `true`. */
  skip() {
    this.stopTimer();
    if (this.waiters.length === 0 && !this.typing) return;
    this.shown = this.frames.length;
    this.finish();
  }

  /** Stop typing and release anyone waiting (they receive `false`). The text on screen stays as is. */
  cancel() {
    this.stopTimer();
    const hadWaiters = this.waiters.length > 0;
    this.typing = false;
    this.release(false);
    if (hadWaiters) this.onUpdate(this.visible(), false);
  }

  private begin(resume: boolean) {
    if (prefersReducedMotion() || narrationTiming.charMs <= 0 || this.frames.length === 0) {
      this.shown = this.frames.length;
      this.finish();
      return;
    }
    this.typing = true;
    if (!resume || this.shown === 0) {
      // The first character is shown at once; the rest follow on the cadence.
      this.shown = Math.max(this.shown, 1);
    }
    this.emit();
    if (this.shown >= this.frames.length) this.finish();
    else this.schedule();
  }

  private schedule() {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.shown += 1;
      this.emit();
      if (this.shown >= this.frames.length) this.finish();
      else this.schedule();
    }, narrationTiming.charMs);
  }

  private finish() {
    this.driver = null;
    this.typing = false;
    this.onUpdate(this.target, false);
    this.release(true);
  }

  private visible(): string {
    return this.shown <= 0 ? "" : this.target.slice(0, this.frames[Math.min(this.shown, this.frames.length) - 1] ?? 0);
  }

  private emit() {
    this.onUpdate(this.visible(), true);
  }

  private wait(): Promise<boolean> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(finished: boolean) {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w(finished);
  }
}
