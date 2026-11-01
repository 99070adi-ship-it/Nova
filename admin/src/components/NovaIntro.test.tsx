import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NovaGuideWidget from "./NovaGuideWidget";
import { getOnboardingProgress } from "../api/client";
import { NOVA_INTRO_BEATS } from "../lib/novaScript";
import { getLessonStep } from "../lib/novaLessons";

vi.mock("../api/client", () => ({
  getOnboardingProgress: vi.fn(),
  startConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  postMessage: vi.fn().mockResolvedValue({ assistant_text: "Narration." }),
  fetchSpeech: vi.fn(),
  warmUpSpeech: vi.fn(),
  getSpeechStatus: vi.fn(),
}));

const INTRO_KEY = "nova.guide.intro.v1:anonymous";
const brand = getLessonStep("brand")!;

beforeEach(() => {
  window.localStorage.removeItem(INTRO_KEY); // this person has not met NOVA yet
  vi.mocked(getOnboardingProgress).mockResolvedValue({
    steps: [{ key: "brand", title: "Tell NOVA about your business", completion_rule: "x.", status: "available" }],
    current_step: "brand",
    intro_video_seen: true,
    total_steps: 10,
    completed_steps: 0,
  } as never);
});
afterEach(() => cleanup());

function renderGuide() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/create-store"]}>
        <button data-nova-target="brand_form.save">Continue to products</button>
        <NovaGuideWidget />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NOVA's opening in the Guide", () => {
  it("explains what NOVA is, beat by beat in the centered presentation, before the first step", async () => {
    renderGuide();
    const seen: string[] = [];
    await waitFor(
      () => {
        const msg = screen.queryByTestId("guide-message")?.textContent;
        if (msg && seen[seen.length - 1] !== msg) seen.push(msg);
        expect(seen).toContain(brand.intro);
      },
      { timeout: 25000, interval: 5 },
    );
    expect(seen.slice(0, NOVA_INTRO_BEATS.length)).toEqual(NOVA_INTRO_BEATS);
    expect(window.localStorage.getItem(INTRO_KEY)).toBe("seen");
  }, 40000);

  it("shows 'Meet NOVA' (not a step title) while introducing itself, with a Skip intro control", async () => {
    renderGuide();
    expect(await screen.findByTestId("guide-skip-intro")).toBeInTheDocument();
    expect(screen.getByTestId("guide-step-title")).toHaveTextContent("Meet NOVA");
    expect(screen.queryByText(/Step 1 of/)).not.toBeInTheDocument();
  });

  it("Skip intro goes straight to the first step's own introduction and still records that NOVA was met", async () => {
    renderGuide();
    fireEvent.click(await screen.findByTestId("guide-skip-intro"));
    await waitFor(() => expect(screen.getByTestId("guide-step-title")).toHaveTextContent("Tell NOVA about your business"), { timeout: 15000 });
    expect(screen.queryByTestId("guide-skip-intro")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(INTRO_KEY)).toBe("seen");
  }, 30000);

  it("is shown once per person: a returning visitor goes straight to the step", async () => {
    window.localStorage.setItem(INTRO_KEY, "seen");
    renderGuide();
    await waitFor(() => expect(screen.getByTestId("guide-step-title")).toHaveTextContent("Tell NOVA about your business"));
    expect(screen.queryByTestId("guide-skip-intro")).not.toBeInTheDocument();
    expect(screen.getByTestId("guide-message")).toHaveTextContent(brand.intro);
  });

  it("another person's 'seen' does not hide it (per user)", async () => {
    window.localStorage.setItem("nova.guide.intro.v1:someone-else", "seen");
    renderGuide();
    expect(await screen.findByTestId("guide-skip-intro")).toBeInTheDocument();
  });
});
