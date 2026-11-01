import clsx from "clsx";
import type { GuideVoice } from "../hooks/useGuideVoice";

const BUTTON =
  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-3 transition-colors duration-instant hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-corona";

/** Voice on/off, replay, and a speaking indicator that is only visible while speech is really playing.
 * Renders nothing when this browser cannot speak. */
export default function GuideVoiceControls({
  voice,
  text,
  onReplay,
}: {
  voice: GuideVoice;
  text: string | null;
  /** Replay that also resets whatever is showing the text (the typewriter); defaults to audio only. */
  onReplay?: () => void;
}) {
  if (!voice.supported) return null;
  const on = voice.mode === "voice";
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1" data-testid="guide-voice-controls">
      <button
        type="button"
        aria-pressed={on}
        aria-label={on ? "Voice on. Switch to text only" : "Voice off. Turn voice on"}
        onClick={() => voice.setMode(on ? "text" : "voice")}
        className={clsx(BUTTON, on && "text-corona")}
        data-testid="guide-voice-toggle"
      >
        {on ? "Voice on" : "Voice off"}
      </button>
      {on && text && !voice.failed && (
        <button
          type="button"
          aria-label="Replay what NOVA just said"
          onClick={() => (onReplay ? onReplay() : void voice.engine.replay(text))}
          className={BUTTON}
          data-testid="guide-voice-replay"
        >
          Replay
        </button>
      )}
      {on && voice.speaking && (
        <span aria-hidden="true" className="inline-flex h-3 items-center gap-[2px] text-corona" data-testid="guide-speaking">
          <span className="nova-speaking-bar" />
          <span className="nova-speaking-bar" />
          <span className="nova-speaking-bar" />
        </span>
      )}
      {on && voice.blocked && !voice.failed && (
        <span role="status" className="text-[11px] text-fg-3" data-testid="guide-voice-blocked">
          Your browser needs a click before it plays sound. Press Replay.
        </span>
      )}
      {on && voice.failed && (
        <span role="status" className="text-[11px] text-fg-3" data-testid="guide-voice-failed">
          Voice isn't working right now — continuing in text.
        </span>
      )}
    </div>
  );
}
