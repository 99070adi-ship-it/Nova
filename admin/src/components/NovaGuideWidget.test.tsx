import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import NovaGuideWidget from "./NovaGuideWidget";
import { getOnboardingProgress, postMessage, startConversation } from "../api/client";

vi.mock("../api/client", () => ({
  getOnboardingProgress: vi.fn(),
  startConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  postMessage: vi.fn().mockResolvedValue({ assistant_text: "Narration." }),
}));

afterEach(() => {
  cleanup();
});

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderWidget(initialPath = "/overview") {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationDisplay />
        <NovaGuideWidget />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NovaGuideWidget — docked chat bubble that bounces into the active guide box for a real step", () => {
  it("stays docked as a small 'Ask me anything' bubble once there's no current onboarding step", async () => {
    vi.mocked(getOnboardingProgress).mockResolvedValue({ steps: [], current_step: null, intro_video_seen: true });

    renderWidget();

    await waitFor(() => expect(screen.getByText("Ask me anything")).toBeInTheDocument());
    expect(screen.queryByText("DEMONSTRATING")).not.toBeInTheDocument();
    expect(screen.queryByText("YOUR TURN")).not.toBeInTheDocument();
    expect(startConversation).not.toHaveBeenCalled();
  });

  it("answers a docked question through the real assistant agent, not nova_guide", async () => {
    vi.mocked(getOnboardingProgress).mockResolvedValue({ steps: [], current_step: null, intro_video_seen: true });
    vi.mocked(postMessage).mockResolvedValue({ assistant_text: "Your store has 26 products." } as never);

    renderWidget();
    await waitFor(() => expect(screen.getByText("Ask me anything")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Ask me anything"));
    const input = screen.getByPlaceholderText("Ask NOVA…");
    fireEvent.change(input, { target: { value: "How many products do I have?" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(screen.getByText("Your store has 26 products.")).toBeInTheDocument());
    expect(startConversation).toHaveBeenCalledWith({ agent_key: "assistant", context: {} });
    expect(postMessage).toHaveBeenCalledWith("conv-1", "How many products do I have?");
  });

  it("bounces up into the active guide box and navigates to that step's own page the moment a real step is available", async () => {
    vi.mocked(getOnboardingProgress).mockResolvedValue({
      steps: [{ key: "brand", title: "Tell NOVA about your business", status: "available" }],
      current_step: "brand",
      intro_video_seen: true,
    });

    renderWidget("/overview");

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/create-store"));
    expect(screen.queryByText("Ask me anything")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Step 1 of \d+/)).toBeInTheDocument(), { timeout: 10000 });
  }, 15000);
});
