import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { beforeEach } from "vitest";

// waitFor must outlast a host stall (see vite.config.ts), or it reports a timeout for a condition that was met.
configure({ asyncUtilTimeout: 15000 });

// jsdom doesn't implement scrollIntoView — NovaSpotlight-driving code calls it on real elements.
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// Narration is typed out at 6 characters per second in production (lib/typewriter.ts). Tests shrink
// the cadence so suites stay fast; the typing tests set their own explicit timing.
import { setNarrationTiming } from "../lib/typewriter";
setNarrationTiming({ charMs: 1 });

// The Guide asks how a person wants to be guided before it starts (components/GuideVoiceChoice). Most
// tests are about the lesson itself, so they begin with that choice already made (text only, for the
// signed-out "anonymous" key and the "test-user" key); the voice tests clear it to exercise the choice.
beforeEach(() => {
  window.localStorage.setItem("nova.guide.voice.v1:anonymous", "text");
  window.localStorage.setItem("nova.guide.voice.v1:test-user", "text");
  // ...and NOVA's opening ("Hey, I'm NOVA…") already seen; the tests for it clear this flag.
  window.localStorage.setItem("nova.guide.intro.v1:anonymous", "seen");
  window.localStorage.setItem("nova.guide.intro.v1:test-user", "seen");
});
