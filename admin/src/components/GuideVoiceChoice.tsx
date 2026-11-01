import { useEffect, useRef } from "react";
import clsx from "clsx";
import NovaFace from "./NovaFace";
import type { GuideVoiceMode } from "../lib/guideVoice";

/** Shown once, before the Guide starts anything: nothing is demonstrated and no audio can play until the
 * person picks. This is an assistance preference, not a shortcut through onboarding. */
export default function GuideVoiceChoice({
  supported,
  engineUnavailable = false,
  onChoose,
}: {
  supported: boolean;
  /** The server's voice engine cannot run (not the browser): voice is not offered. */
  engineUnavailable?: boolean;
  onChoose: (mode: GuideVoiceMode) => void;
}) {
  const canSpeak = supported && !engineUnavailable;
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const textRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    (canSpeak ? firstRef : textRef).current?.focus();
  }, [canSpeak]);

  const option =
    "group flex w-full flex-col items-start gap-0.5 rounded-lg border border-line-strong bg-sunken px-4 py-3 text-left transition-colors duration-instant hover:border-corona focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-corona";

  return (
    <div
      data-testid="guide-voice-choice"
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/20 p-6 backdrop-blur-[5px]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-voice-title"
        className="theme-ink w-full max-w-[460px] rounded-xl border border-line bg-raised p-6 text-fg shadow-float"
      >
        <div className="flex items-center gap-3">
          <NovaFace size={44} look="center" />
          <p className="eyebrow !text-corona">NOVA</p>
        </div>
        <h2 id="guide-voice-title" className="mt-3 font-display text-[26px] leading-[1.15] tracking-[-0.015em] text-fg">
          How would you like NOVA to guide you through the demonstration?
        </h2>
        <div className="mt-4 flex flex-col gap-2.5">
          <button
            ref={firstRef}
            type="button"
            disabled={!canSpeak}
            onClick={() => onChoose("voice")}
            className={clsx(option, !canSpeak && "cursor-not-allowed opacity-50 hover:border-line-strong")}
          >
            <span className="text-sm font-medium text-fg">Voice + text</span>
            <span className="text-xs text-fg-2">NOVA speaks while the same words appear on screen.</span>
          </button>
          <button ref={textRef} type="button" onClick={() => onChoose("text")} className={option}>
            <span className="text-sm font-medium text-fg">Text only</span>
            <span className="text-xs text-fg-2">The words appear on screen, with no audio.</span>
          </button>
        </div>
        {!supported && (
          <p className="mt-3 text-xs text-fg-3" data-testid="guide-voice-unsupported">
            Voice isn't available in this browser, so NOVA will guide you in text.
          </p>
        )}
        {supported && engineUnavailable && (
          <p className="mt-3 text-xs text-fg-3" data-testid="guide-voice-engine-unavailable">
            Voice isn't available right now, so NOVA will guide you in text.
          </p>
        )}
        <p className="mt-3 text-[11px] text-fg-3">You can change this any time.</p>
      </div>
    </div>
  );
}
