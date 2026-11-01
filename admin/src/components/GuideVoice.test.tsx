import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NovaGuideWidget from "./NovaGuideWidget";
import { getOnboardingProgress, postMessage, startConversation } from "../api/client";
import { getLessonStep } from "../lib/novaLessons";
import { setNarrationTiming } from "../lib/typewriter";
import { FakeAudio, installFakeSpeech, type FakeSpeech } from "../test/fakeSpeech";

// Every test here drives the real Guide against a FAKE backend speech endpoint and <audio> element
// (test/fakeSpeech.ts). These prove how NOVA drives the voice pipeline; whether sound actually comes
// out of the real provider is checked separately, and is not claimed by this file.

const hoisted = vi.hoisted(() => ({
  fetchAudio: (() => Promise.reject(new Error("unset"))) as (t: string, s: AbortSignal) => Promise<Blob>,
  engineState: "ready" as "ready" | "failed" | "loading",
  warmUps: 0,
}));
vi.mock("../api/client", () => ({
  getOnboardingProgress: vi.fn(),
  startConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  postMessage: vi.fn().mockResolvedValue({ assistant_text: "Narration." }),
  fetchSpeech: (text: string, signal: AbortSignal) => hoisted.fetchAudio(text, signal),
  warmUpSpeech: async () => {
    hoisted.warmUps += 1;
    return { engine: "kokoro", state: hoisted.engineState, ready: hoisted.engineState === "ready" };
  },
  getSpeechStatus: async () => ({ engine: "kokoro", state: hoisted.engineState, ready: hoisted.engineState === "ready" }),
}));

const brand = getLessonStep("brand")!;
const KEY = "nova.guide.voice.v1:anonymous";
let speech: FakeSpeech;
let restore: () => void;
let completed = false;

beforeEach(() => {
  ({ speech, restore } = installFakeSpeech());
  hoisted.fetchAudio = speech.fetchAudio as never;
  hoisted.engineState = "ready";
  hoisted.warmUps = 0;
  window.localStorage.removeItem(KEY); // no choice made yet
  completed = false;
  vi.mocked(getOnboardingProgress).mockImplementation(() =>
    Promise.resolve({
      steps: [{ key: "brand", title: "Tell NOVA about your business", completion_rule: "x.", status: completed ? "completed" : "available" }],
      current_step: completed ? null : "brand",
      intro_video_seen: true,
      total_steps: 10,
      completed_steps: completed ? 1 : 0,
    } as never),
  );
});
afterEach(() => {
  cleanup();
  restore();
});

function Leave() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/products")}>LEAVE</button>;
}

function renderGuide(path = "/create-store") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Leave />
        <button data-nova-target="brand_form.save">Continue to products</button>
        <NovaGuideWidget />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const chooseVoice = () => fireEvent.click(screen.getByRole("button", { name: /Voice \+ text/ }));
const chooseText = () => fireEvent.click(screen.getByRole("button", { name: /Text only/ }));
const spokenTexts = () => speech.requested;
const plays = () => speech.audio()?.playCalls ?? 0;
const silent = () => !speech.audio() || speech.audio()!.paused;

const waitingForYou = () => waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 15000 });

describe("Guide voice assistance", () => {
  it("asks how to be guided BEFORE anything starts: no presentation, no demo, no audio until chosen", async () => {
    renderGuide();
    const dialog = await screen.findByRole("dialog", { name: /How would you like NOVA to guide you through the demonstration\?/ });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Voice \+ text/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Text only/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Voice \+ text/ })).toHaveFocus();

    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByTestId("guide-step-title")).not.toBeInTheDocument();
    expect(screen.queryByTestId("guide-typed")).not.toBeInTheDocument();
    expect(speech.fetchAudio).not.toHaveBeenCalled(); // nothing even requested from the backend
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("Text only: the tour runs exactly as before, no speech is ever requested, and the choice is remembered", async () => {
    renderGuide();
    await screen.findByRole("dialog");
    chooseText();
    await waitingForYou();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(speech.fetchAudio).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBe("text");
    expect(screen.getByTestId("guide-message")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("guide-voice-toggle")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("guide-voice-replay")).not.toBeInTheDocument();
  }, 30000);

  it("Voice + text: speaks the SAME narration that is shown, in order, through one audio element", async () => {
    renderGuide();
    await screen.findByRole("dialog");
    chooseVoice();
    await waitFor(() => expect(spokenTexts()).toContain(brand.intro));
    expect(window.localStorage.getItem(KEY)).toBe("voice");
    await waitFor(() => expect(screen.getByTestId("guide-message")).toHaveTextContent(brand.intro));

    await waitingForYou();
    await waitFor(() => expect(plays()).toBe(2));
    expect(spokenTexts()).toEqual([brand.intro, brand.explain]);
    expect(speech.elements()).toBe(1);
    expect(screen.getByTestId("guide-message")).toHaveAttribute("aria-live", "off");
    expect(screen.getByTestId("guide-message")).toHaveTextContent(brand.explain);
  }, 30000);

  it("text and voice begin together: nothing is shown until the audio is playing, then the text follows the audio", async () => {
    FakeAudio.auto = false; // the test decides when the audio starts and how far it has played
    renderGuide();
    await screen.findByRole("dialog");
    chooseVoice();
    await waitFor(() => expect(plays()).toBe(1));
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.getByTestId("guide-typed")).toHaveTextContent(""); // audio requested/loaded, not audible yet
    const audio = speech.audio()!;
    audio.duration = 3;
    act(() => speech.startPlaying());
    audio.currentTime = 1.5;
    await waitFor(() => expect(screen.getByTestId("guide-typed").textContent!.length).toBeGreaterThan(5));
    const half = screen.getByTestId("guide-typed").textContent!;
    expect(brand.intro.startsWith(half.trim())).toBe(true);
    expect(half.length).toBeLessThan(brand.intro.length);
    audio.currentTime = 0; // audio rewound / paused: text never goes backwards
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.getByTestId("guide-typed").textContent).toBe(half);
    act(() => audio.finish());
    await waitFor(() => expect(screen.getByTestId("guide-message")).toHaveTextContent(brand.explain)); // moved on once the audio ended
  }, 30000);

  it("shows the speaking indicator only while audio is actually playing", async () => {
    FakeAudio.auto = false;
    renderGuide();
    await screen.findByRole("dialog");
    chooseVoice();
    await waitFor(() => expect(plays()).toBe(1));
    expect(screen.queryByTestId("guide-speaking")).not.toBeInTheDocument(); // play requested, not audible yet
    act(() => speech.startPlaying());
    expect(await screen.findByTestId("guide-speaking")).toBeInTheDocument();
    act(() => speech.finishPlaying());
    await waitFor(() => expect(screen.queryByTestId("guide-speaking")).not.toBeInTheDocument());
  }, 30000);

  it("does not make the visitor wait for speech: the step advances while the audio is still pending", async () => {
    const release = speech.hold(); // the backend never answers
    renderGuide();
    await screen.findByRole("dialog");
    chooseVoice();
    await waitingForYou();
    completed = true;
    fireEvent.click(screen.getByText("Continue to products"));
    await waitFor(() => expect(screen.getByText("DONE")).toBeInTheDocument(), { timeout: 15000 });
    release();
  }, 30000);

  it("a completion reply replaces the previous narration: the old audio is silenced, the new one requested once", async () => {
    renderGuide();
    await screen.findByRole("dialog");
    chooseVoice();
    await waitingForYou();
    await waitFor(() => expect(plays()).toBe(2));
    completed = true;
    fireEvent.click(screen.getByText("Continue to products"));
    await waitFor(() => expect(spokenTexts()).toContain(brand.done), { timeout: 15000 });
    expect(spokenTexts().filter((t) => t === brand.done)).toHaveLength(1);
    expect(speech.signals[1].aborted).toBe(true); // the explain request was superseded
  }, 30000);

  it("switching voice off mid-lesson silences it now and nothing more is spoken; switching on speaks the current message", async () => {
    renderGuide();
    await screen.findByRole("dialog");
    chooseVoice();
    await waitingForYou();
    await waitFor(() => expect(plays()).toBe(2));

    fireEvent.click(screen.getByTestId("guide-voice-toggle"));
    expect(silent()).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe("text");
    expect(screen.getByTestId("guide-message")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByTestId("guide-voice-replay")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("guide-voice-toggle"));
    await waitFor(() => expect(plays()).toBe(3));
    expect(silent()).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe("voice");
  }, 30000);

  it("Replay plays the current narration again from the start, as a single stream of audio", async () => {
    renderGuide();
    await screen.findByRole("dialog");
    chooseVoice();
    await waitingForYou();
    await waitFor(() => expect(plays()).toBe(2));
    fireEvent.click(screen.getByTestId("guide-voice-replay"));
    await waitFor(() => expect(plays()).toBe(3));
    expect(speech.elements()).toBe(1);
  }, 30000);

  it("Skip (show the full message now) stops the narration being read", async () => {
    setNarrationTiming({ charMs: 60 }); // slow enough that the Skip control is really on screen
    try {
      renderGuide();
      await screen.findByRole("dialog");
      chooseVoice();
      await waitFor(() => expect(plays()).toBe(1));
      fireEvent.click(await screen.findByRole("button", { name: /Show the full message now/ }));
      expect(silent()).toBe(true);
      expect(screen.getByTestId("guide-typed")).toHaveTextContent(brand.intro);
    } finally {
      setNarrationTiming({ charMs: 1 });
    }
  }, 30000);

  it("walking away to another page silences it; the preference is kept and the visitor is not asked again", async () => {
    FakeAudio.auto = false;
    renderGuide();
    await screen.findByRole("dialog");
    chooseVoice();
    await waitFor(() => expect(plays()).toBe(1));
    act(() => speech.startPlaying());
    expect(silent()).toBe(false);
    fireEvent.click(screen.getByText("LEAVE"));
    await waitFor(() => expect(silent()).toBe(true));
    expect(window.localStorage.getItem(KEY)).toBe("voice");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  }, 30000);

  it("unmounting the Guide cancels speech", async () => {
    const { unmount } = renderGuide();
    await screen.findByRole("dialog");
    chooseVoice();
    await waitFor(() => expect(plays()).toBe(1));
    unmount();
    expect(silent()).toBe(true);
  }, 30000);

  it("a returning visitor with a saved choice is not asked again, and voice speaks from the first narration", async () => {
    window.localStorage.setItem(KEY, "voice");
    renderGuide();
    await waitFor(() => expect(spokenTexts()).toContain(brand.intro));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("another person's saved choice is not applied (preference is per user)", async () => {
    window.localStorage.setItem("nova.guide.voice.v1:someone-else", "voice");
    renderGuide();
    await screen.findByRole("dialog");
    expect(speech.fetchAudio).not.toHaveBeenCalled();
  });

  it("falls back to text when the speech service fails: says so, keeps the tour going, never blocks", async () => {
    speech.failWith(new Error("503 speech_unavailable"));
    renderGuide();
    await screen.findByRole("dialog");
    chooseVoice();
    expect(await screen.findByTestId("guide-voice-failed")).toBeInTheDocument();
    await waitingForYou();
    expect(screen.getByTestId("guide-message")).toHaveTextContent(brand.explain);
    expect(screen.getByTestId("guide-message")).toHaveAttribute("aria-live", "polite"); // text is the channel again
    expect(silent()).toBe(true);
    // The tour still completes on real verification.
    completed = true;
    fireEvent.click(screen.getByText("Continue to products"));
    await waitFor(() => expect(screen.getByText("DONE")).toBeInTheDocument(), { timeout: 15000 });
  }, 40000);

  it("when the browser blocks audio until a click: says so, keeps going, and Replay recovers", async () => {
    class BlockedAudio extends FakeAudio {
      rejectWith: Error | null = new DOMException("blocked", "NotAllowedError");
    }
    (window as unknown as { Audio: unknown }).Audio = BlockedAudio;
    window.localStorage.setItem(KEY, "voice");
    renderGuide();
    expect(await screen.findByTestId("guide-voice-blocked")).toBeInTheDocument();
    await waitingForYou();
    expect(screen.queryByTestId("guide-voice-failed")).not.toBeInTheDocument();
    FakeAudio.instances[0].rejectWith = null;
    fireEvent.click(screen.getByTestId("guide-voice-replay"));
    await waitFor(() => expect(speech.audio()!.paused).toBe(false));
    act(() => speech.startPlaying());
    await waitFor(() => expect(screen.queryByTestId("guide-voice-blocked")).not.toBeInTheDocument());
  }, 40000);

  it("blocked audio resumes on the visitor's first click anywhere: no Replay or voice off/on needed", async () => {
    class BlockedAudio extends FakeAudio {
      rejectWith: Error | null = new DOMException("blocked", "NotAllowedError");
    }
    (window as unknown as { Audio: unknown }).Audio = BlockedAudio;
    window.localStorage.setItem(KEY, "voice");
    renderGuide();
    expect(await screen.findByTestId("guide-voice-blocked")).toBeInTheDocument();
    FakeAudio.instances[0].rejectWith = null;
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(speech.audio()!.paused).toBe(false));
    act(() => speech.startPlaying());
    await waitFor(() => expect(screen.queryByTestId("guide-voice-blocked")).not.toBeInTheDocument());
  }, 40000);

  it("a temporary speech failure heals by itself: voice comes back without toggling it off and on", async () => {
    speech.failWith(new Error("503 speech_unavailable"));
    renderGuide();
    await screen.findByRole("dialog");
    chooseVoice();
    expect(await screen.findByTestId("guide-voice-failed")).toBeInTheDocument();
    speech.failWith(null);
    await waitFor(() => expect(screen.queryByTestId("guide-voice-failed")).not.toBeInTheDocument(), { timeout: 10000 });
    await waitFor(() => expect(speech.audio()).toBeTruthy(), { timeout: 10000 });
  }, 40000);

  it("asks the server to start loading the voice model while the person is choosing (not before there is a reason)", async () => {
    renderGuide();
    await screen.findByRole("dialog");
    await waitFor(() => expect(hoisted.warmUps).toBe(1));
    expect(speech.fetchAudio).not.toHaveBeenCalled(); // warming up the engine is not speaking
  });

  it("text-only visitors never trigger a model warm-up", async () => {
    window.localStorage.setItem(KEY, "text");
    renderGuide();
    await waitingForYou();
    expect(hoisted.warmUps).toBe(0);
  }, 30000);

  it("when the SERVER's voice engine is unavailable: voice is not offered, with a plain note, and text works", async () => {
    hoisted.engineState = "failed";
    renderGuide();
    await screen.findByRole("dialog");
    expect(await screen.findByTestId("guide-voice-engine-unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Voice \+ text/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Text only/ })).toHaveFocus();
    chooseText();
    await waitingForYou();
    expect(speech.fetchAudio).not.toHaveBeenCalled();
  }, 30000);

  it("a saved voice choice with an unavailable server engine falls back to text without asking again", async () => {
    hoisted.engineState = "failed";
    window.localStorage.setItem(KEY, "voice");
    renderGuide();
    expect(await screen.findByTestId("guide-voice-failed")).toBeInTheDocument();
    await waitingForYou();
    expect(speech.fetchAudio).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  }, 30000);

  it("when the browser cannot play audio: voice is disabled with a plain note, text works, no controls clutter", async () => {
    (window as unknown as { Audio: unknown }).Audio = undefined;
    renderGuide();
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: /Voice \+ text/ })).toBeDisabled();
    expect(screen.getByTestId("guide-voice-unsupported")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Text only/ })).toHaveFocus();
    chooseText();
    await waitingForYou();
    expect(screen.queryByTestId("guide-voice-controls")).not.toBeInTheDocument();
  }, 30000);

  describe("the persistent assistant after the tour", () => {
    beforeEach(() => {
      vi.mocked(getOnboardingProgress).mockResolvedValue({ steps: [], current_step: null, intro_video_seen: true, total_steps: 10, completed_steps: 0 });
      vi.mocked(postMessage).mockResolvedValue({ assistant_text: "Your store has 26 products." } as never);
    });

    async function ask() {
      await waitFor(() => expect(screen.getByText("Ask me anything")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Ask me anything"));
      const input = screen.getByPlaceholderText("Ask NOVA…");
      fireEvent.change(input, { target: { value: "How many products?" } });
      fireEvent.submit(input.closest("form")!);
      await waitFor(() => expect(screen.getByText("Your store has 26 products.")).toBeInTheDocument());
    }

    it("carries the saved voice choice: replies are spoken (same words), closing the bubble stops them", async () => {
      window.localStorage.setItem(KEY, "voice");
      renderGuide("/overview");
      await ask();
      expect(startConversation).toHaveBeenCalled();
      await waitFor(() => expect(spokenTexts()).toEqual(["Your store has 26 products."]));
      await waitFor(() => expect(plays()).toBe(1));
      fireEvent.click(screen.getByText("Hide"));
      expect(silent()).toBe(true);
    });

    it("text preference: replies are never spoken, and voice can be switched on from the bubble", async () => {
      window.localStorage.setItem(KEY, "text");
      renderGuide("/overview");
      await ask();
      expect(speech.fetchAudio).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId("guide-voice-toggle"));
      expect(window.localStorage.getItem(KEY)).toBe("voice");
    });

    it("never speaks before a choice was made (no saved preference)", async () => {
      renderGuide("/overview");
      await ask();
      expect(speech.fetchAudio).not.toHaveBeenCalled();
    });

    it("a failed speech service never hides the reply: the text is still there", async () => {
      speech.failWith(new Error("down"));
      window.localStorage.setItem(KEY, "voice");
      renderGuide("/overview");
      await ask();
      expect(await screen.findByTestId("guide-voice-failed")).toBeInTheDocument();
      expect(screen.getByText("Your store has 26 products.")).toBeInTheDocument();
    });
  });
});
