import clsx from "clsx";
import { useEffect, useState } from "react";
import NovaFace from "./NovaFace";
import type { VoiceProgress } from "../lib/browserSpeech";

/** How long without any change before saying "still working". */
export const STILL_WORKING_AFTER_MS = 15_000;
const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1);

/**
 * Shown after someone chooses "Voice + text" while NOVA's voice model downloads into their browser (one time: the browser keeps
 * it, so later visits skip this). The tour waits behind it; "Continue in text" is always available, and a failure says so
 * plainly instead of leaving a stuck bar.
 */
export default function GuideVoiceSetup({
  progress,
  failed,
  onContinueInText,
}: {
  progress: VoiceProgress;
  failed: boolean;
  onContinueInText: () => void;
}) {
  const known = progress.percent !== null;
  const starting = progress.phase === "starting";
  // A download that is merely slow keeps moving; one that has stopped for a while gets an honest "still working" note.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(timer);
  }, []);
  const quiet = !failed && progress.updatedAt > 0 && now - progress.updatedAt > STILL_WORKING_AFTER_MS;
  return (
    <div data-testid="guide-voice-setup" className="fixed inset-0 z-50 flex items-center justify-center bg-fg/20 p-6 backdrop-blur-[5px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-voice-setup-title"
        className="theme-ink w-full max-w-[460px] rounded-xl border border-line bg-raised p-6 text-fg shadow-float"
      >
        <div className="flex items-center gap-3">
          <NovaFace size={44} look="center" />
          <p className="eyebrow !text-corona">NOVA</p>
        </div>
        <h2 id="guide-voice-setup-title" className="mt-3 font-display text-[26px] leading-[1.15] tracking-[-0.015em] text-fg">
          {failed ? "NOVA's voice couldn't be set up" : "Setting up NOVA's voice"}
        </h2>

        {failed ? (
          <>
            <p role="alert" className="mt-3 text-sm text-fg-2" data-testid="guide-voice-setup-failed">
              The voice couldn't be started in this browser, so NOVA will guide you in text. Nothing else is affected.
            </p>
            {progress.error && <p className="mt-2 break-words text-xs text-fg-3" data-testid="guide-voice-setup-error">Details: {progress.error}</p>}
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-fg-2">
              {starting
                ? "Almost there. NOVA's voice is starting up."
                : known
                  ? "A one-time update is downloading to your browser so NOVA can speak. It's saved here, so next time this starts instantly."
                  : "Getting NOVA's voice ready. This only takes a moment."}
            </p>
            <div
              role="progressbar"
              aria-label="Downloading NOVA's voice"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={known ? progress.percent! : undefined}
              aria-valuetext={known ? `${progress.percent}%` : "Preparing"}
              className="mt-5 h-2 w-full overflow-hidden rounded-full bg-sunken"
            >
              <div
                className={known ? clsx("h-full rounded-full bg-corona transition-[width] duration-quick ease-settle", starting && "animate-pulse motion-reduce:animate-none") : "h-full w-1/3 animate-pulse rounded-full bg-corona motion-reduce:animate-none"}
                style={known ? { width: `${progress.percent}%` } : undefined}
              />
            </div>
            <p className="mt-2 text-xs text-fg-3" aria-live="polite" data-testid="guide-voice-setup-status">
              {starting
                ? "Starting the voice…"
                : known
                  ? `${progress.percent}% · ${mb(progress.loadedBytes)} of ${mb(progress.totalBytes)} MB`
                  : "Preparing…"}
            </p>
            {quiet && (
              <p className="mt-1 text-xs text-fg-3" data-testid="guide-voice-setup-quiet">
                Still working. This can take longer on a slow connection. If you'd rather not wait, you can skip and use text only.
              </p>
            )}
          </>
        )}

        <button
          type="button"
          autoFocus={failed}
          onClick={onContinueInText}
          className="mt-5 rounded-lg border border-line-strong bg-sunken px-4 py-2 text-sm font-medium text-fg transition-colors duration-instant hover:border-corona focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-corona"
        >
          {failed ? "Continue in text" : "Skip and use text only"}
        </button>
      </div>
    </div>
  );
}
