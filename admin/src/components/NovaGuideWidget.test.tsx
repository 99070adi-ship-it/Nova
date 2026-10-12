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

// The "brand" lesson's real last-demo-action target (admin/src/lib/novaLessons.ts) — a stand-in
// for the real BrandInputForm's submit button so the widget's pre-flight check finds something
// real to spotlight, same as it would on the actual /create-store page.
function BrandSaveStub() {
  return <button data-nova-target="brand_form.save">Continue to products</button>;
}

function renderWidget(initialPath = "/overview", { withBrandTarget = true }: { withBrandTarget?: boolean } = {}) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationDisplay />
        {withBrandTarget && <BrandSaveStub />}
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
    expect(screen.queryByText("WAITING FOR YOU")).not.toBeInTheDocument();
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

  it("states the exact next action to click, not a generic placeholder", async () => {
    vi.mocked(getOnboardingProgress).mockResolvedValue({
      steps: [{ key: "brand", title: "Tell NOVA about your business", status: "available" }],
      current_step: "brand",
      intro_video_seen: true,
    });

    renderWidget("/create-store");

    // Shown once NOVA reaches "explain" (requirement 1) — the real button's own exact label,
    // authored in novaLessons.ts, not left to whatever the narration text happens to say.
    await waitFor(
      () => expect(screen.getByText((text) => text.includes('"Continue to products"'))).toBeInTheDocument(),
      { timeout: 10000 },
    );
    expect(screen.queryByText(/let's get started/i)).not.toBeInTheDocument();
  }, 15000);

  it("does not pretend the step is ready when the real target genuinely can't be found, and offers a retry", async () => {
    vi.mocked(getOnboardingProgress).mockResolvedValue({
      steps: [{ key: "brand", title: "Tell NOVA about your business", status: "available" }],
      current_step: "brand",
      intro_video_seen: true,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    renderWidget("/create-store", { withBrandTarget: false });

    await waitFor(() => expect(screen.getByText(/can't find the right control/i)).toBeInTheDocument(), {
      timeout: 10000,
    });
    expect(screen.getByText("Try again")).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('data-nova-target="brand_form.save"'));
    // Never silently proceeds into a demo that would spotlight nothing.
    expect(screen.queryByText("DEMONSTRATING")).not.toBeInTheDocument();

    consoleError.mockRestore();
  }, 15000);

  it("keeps the spotlighted control clickable — the overlay never blocks real interaction with it", async () => {
    vi.mocked(getOnboardingProgress).mockResolvedValue({
      steps: [{ key: "brand", title: "Tell NOVA about your business", status: "available" }],
      current_step: "brand",
      intro_video_seen: true,
    });

    renderWidget("/create-store");

    await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 10000 });

    const target = screen.getByText("Continue to products");
    const handleClick = vi.fn();
    target.addEventListener("click", handleClick);
    fireEvent.click(target);
    expect(handleClick).toHaveBeenCalledTimes(1);
  }, 15000);

  it("retracts back to the dock only once the lesson is genuinely complete — never merely from time passing", async () => {
    let completed = false;
    vi.mocked(getOnboardingProgress).mockImplementation(() =>
      Promise.resolve({
        steps: [{ key: "brand", title: "Tell NOVA about your business", status: completed ? "completed" : "available" }],
        current_step: completed ? null : "brand",
        intro_video_seen: true,
      } as never),
    );

    renderWidget("/overview");

    await waitFor(() => expect(screen.getByText(/Step 1 of \d+/)).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.queryByText("Ask me anything")).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 10000 });
    // Real backend state still says incomplete — waiting here, however long, must never retract
    // on its own.
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByText("Ask me anything")).not.toBeInTheDocument();

    completed = true; // only now does the real backend state actually change
    await waitFor(() => expect(screen.getByText("DONE")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.queryByText("Ask me anything")).not.toBeInTheDocument(); // still mid-retract beat

    await waitFor(() => expect(screen.getByText("Ask me anything")).toBeInTheDocument(), { timeout: 10000 });
  }, 30000);
});
