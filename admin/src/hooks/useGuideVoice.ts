import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SpeechEngineState } from "../api/client";
import { warmUpAuto } from "../lib/speechSource";
import { loadGuideVoiceMode, NovaVoice, saveGuideVoiceMode, type GuideVoiceMode } from "../lib/guideVoice";

/** The key used before a user is known (or in tests without an auth provider). Still namespaced, so it
 * can never be read as another user's preference. */
const NO_USER = "anonymous";

export interface GuideVoice {
  /** null until the person has chosen how they want to be guided. */
  mode: GuideVoiceMode | null;
  /** Remember the choice for this user. Choosing text cancels any speech at once. */
  setMode: (mode: GuideVoiceMode) => void;
  engine: NovaVoice;
  supported: boolean;
  /** What the server says about the voice engine ("unknown" until asked). */
  engineState: SpeechEngineState | "unknown";
  /** The server cannot produce speech (model missing/failed to load): voice should not be offered. */
  engineUnavailable: boolean;
  /** Voice is chosen, available, and has not failed: narration should be spoken. */
  enabled: boolean;
  /** The engine really is speaking right now (drives the indicator). */
  speaking: boolean;
  /** Speech errored; the Guide continues in text. */
  failed: boolean;
  /** The browser wants a click before it will play audio; Replay will do it. */
  blocked: boolean;
}

const MAX_VOICE_RETRIES = 3;
const VOICE_RETRY_DELAY_MS = 2000;

/** One voice engine and one preference for the whole Guide (tour and, after it, the assistant), kept
 * for the life of the widget so it survives route changes. */
export function useGuideVoice(userKey: string | null): GuideVoice {
  const key = userKey ?? NO_USER;
  const engineRef = useRef<NovaVoice | null>(null);
  if (!engineRef.current) engineRef.current = new NovaVoice();
  const engine = engineRef.current;

  const [mode, setModeState] = useState<GuideVoiceMode | null>(() => loadGuideVoiceMode(key));
  const [loadedFor, setLoadedFor] = useState(key);
  // A different person signing in on the same device gets their own preference, never the previous one's.
  if (loadedFor !== key) {
    setLoadedFor(key);
    setModeState(loadGuideVoiceMode(key));
    engine.cancel();
  }

  const speaking = useSyncExternalStore(engine.subscribe, () => engine.speaking);
  const failed = useSyncExternalStore(engine.subscribe, () => engine.failed);
  const blocked = useSyncExternalStore(engine.subscribe, () => engine.blocked);

  const setMode = useCallback(
    (next: GuideVoiceMode) => {
      saveGuideVoiceMode(key, next);
      setModeState(next);
      if (next === "text") engine.cancel(); // switching voice off stops it immediately
      else engine.resetFailure();
    },
    [key, engine],
  );

  // Nothing keeps speaking once the Guide is gone or the page is being left.
  useEffect(() => {
    const stop = () => engine.cancel();
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      engine.cancel();
    };
  }, [engine]);

  // While the person is choosing (or already chose voice), ask the server to start loading the voice
  // model so it is ready by the first narration, and follow its state. Any failure here simply means
  // "unknown": speech requests themselves still decide what actually happens, and text always works.
  const [engineState, setEngineState] = useState<SpeechEngineState | "unknown">("unknown");
  const wantsEngine = mode === null || mode === "voice";
  useEffect(() => {
    if (!wantsEngine || !engine.supported) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (first: boolean) => {
      try {
        const status = await warmUpAuto(first);
        if (cancelled) return;
        setEngineState(status.state);
        if (status.state === "loading" || status.state === "not_loaded") timer = setTimeout(() => void poll(false), 1500);
      } catch {
        if (!cancelled) setEngineState("unknown");
      }
    };
    void poll(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [wantsEngine, engine, key]);

  // A failed request is usually temporary (the voice model was still loading, a busy moment, a dropped connection).
  // Staying silent until the person flips voice off and on is the bug this fixes: try again a few times, and only
  // then settle into text for good. A successful playback starts the count over.
  const retries = useRef(0);
  useEffect(() => {
    if (speaking) retries.current = 0;
  }, [speaking]);
  useEffect(() => {
    if (!failed || mode !== "voice" || engineState === "failed" || retries.current >= MAX_VOICE_RETRIES) return;
    const timer = setTimeout(() => {
      retries.current += 1;
      engine.resetFailure();
    }, VOICE_RETRY_DELAY_MS * (retries.current + 1));
    return () => clearTimeout(timer);
  }, [failed, mode, engineState, engine]);

  const supported = engine.supported;
  const engineUnavailable = engineState === "failed";
  return {
    mode, setMode, engine, supported, engineState, engineUnavailable,
    enabled: mode === "voice" && supported && !failed && !engineUnavailable,
    speaking, failed: failed || (mode === "voice" && engineUnavailable), blocked,
  };
}
