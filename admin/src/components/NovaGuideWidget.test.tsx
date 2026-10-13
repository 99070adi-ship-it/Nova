import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
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

function renderWidget(
  initialPath = "/overview",
  { withBrandTarget = true, beginTour = false }: { withBrandTarget?: boolean; beginTour?: boolean } = {},
) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[beginTour ? { pathname: initialPath, state: { beginTour: true } } : initialPath]}>
        <LocationDisplay />
        <LeaveButton />
        {withBrandTarget && <BrandSaveStub />}
        <NovaGuideWidget />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LeaveButton() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/products")}>LEAVE TO PRODUCTS</button>;
}

describe("NovaGuideWidget — docked chat bubble that bounces into the active guide box for a real step", () => {
  it("stays docked as a small 'Ask me anything' bubble once there's no current onboarding step", async () => {
    vi.mocked(getOnboardingProgress).mockResolvedValue({ steps: [], current_step: null, intro_video_seen: true, total_steps: 10, completed_steps: 0 });

    renderWidget();

    await waitFor(() => expect(screen.getByText("Ask me anything")).toBeInTheDocument());
    expect(screen.queryByText("DEMONSTRATING")).not.toBeInTheDocument();
    expect(screen.queryByText("WAITING FOR YOU")).not.toBeInTheDocument();
    expect(startConversation).not.toHaveBeenCalled();
  });

  it("answers a docked question through the real assistant agent, not nova_guide", async () => {
    vi.mocked(getOnboardingProgress).mockResolvedValue({ steps: [], current_step: null, intro_video_seen: true, total_steps: 10, completed_steps: 0 });
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

  it("right after signing in, bounces up into the guide box and takes the visitor to that step's own page", async () => {
    vi.mocked(getOnboardingProgress).mockResolvedValue({
      steps: [{ key: "brand", title: "Tell NOVA about your business", completion_rule: "A brand profile exists.", status: "available" }],
      current_step: "brand",
      intro_video_seen: true,
      total_steps: 10,
      completed_steps: 0,
    });

    renderWidget("/overview", { beginTour: true });

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/create-store"));
    expect(screen.queryByText("Ask me anything")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Step 1 of 10 — Tell NOVA about your business/)).toBeInTheDocument(), { timeout: 10000 });
  }, 15000);

  it("states the exact next action to click, not a generic placeholder", async () => {
    vi.mocked(getOnboardingProgress).mockResolvedValue({
      steps: [{ key: "brand", title: "Tell NOVA about your business", completion_rule: "A brand profile exists.", status: "available" }],
      current_step: "brand",
      intro_video_seen: true,
      total_steps: 10,
      completed_steps: 0,
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
      steps: [{ key: "brand", title: "Tell NOVA about your business", completion_rule: "A brand profile exists.", status: "available" }],
      current_step: "brand",
      intro_video_seen: true,
      total_steps: 10,
      completed_steps: 0,
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
      steps: [{ key: "brand", title: "Tell NOVA about your business", completion_rule: "A brand profile exists.", status: "available" }],
      current_step: "brand",
      intro_video_seen: true,
      total_steps: 10,
      completed_steps: 0,
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
        steps: [{ key: "brand", title: "Tell NOVA about your business", completion_rule: "A brand profile exists.", status: completed ? "completed" : "available" }],
        current_step: completed ? null : "brand",
        intro_video_seen: true,
        total_steps: 10,
        completed_steps: completed ? 1 : 0,
      } as never),
    );

    renderWidget("/overview", { beginTour: true });

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

  it("hands control back cleanly: after the demo only a click-through cue remains (no blur/dim), and the real nav still works", async () => {
    vi.mocked(getOnboardingProgress).mockResolvedValue({
      steps: [{ key: "brand", title: "Tell NOVA about your business", completion_rule: "A brand profile exists.", status: "available" }],
      current_step: "brand",
      intro_video_seen: true,
      total_steps: 10,
      completed_steps: 0,
    });

    renderWidget("/create-store");

    await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 10000 });
    const overlay = document.querySelector("[data-nova-spotlight]");
    expect(overlay?.getAttribute("data-nova-spotlight")).toBe("cue");
    expect(overlay?.className).toContain("pointer-events-none");
    expect(overlay?.querySelector("[style*='blur']")).toBeNull();

    fireEvent.click(screen.getByText("LEAVE TO PRODUCTS"));
    expect(screen.getByTestId("location").textContent).toBe("/products");
  }, 15000);

  it("offers 'Return to step' when the visitor wanders off, and returns them to that step's page", async () => {
    vi.mocked(getOnboardingProgress).mockResolvedValue({
      steps: [{ key: "brand", title: "Tell NOVA about your business", completion_rule: "A brand profile exists.", status: "available" }],
      current_step: "brand",
      intro_video_seen: true,
      total_steps: 10,
      completed_steps: 0,
    });

    renderWidget("/create-store");
    await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.queryByTestId("guide-return")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("LEAVE TO PRODUCTS"));
    await waitFor(() => expect(screen.getByTestId("guide-return")).toBeInTheDocument());
    expect(screen.getByText("Return to step 1")).toBeInTheDocument();
    // Wandering off never silently completes or abandons the step.
    expect(screen.queryByText("Ask me anything")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Return to step 1"));
    expect(screen.getByTestId("location").textContent).toBe("/create-store");
    await waitFor(() => expect(screen.queryByTestId("guide-return")).not.toBeInTheDocument());
  }, 15000);

  it("never hijacks a plain page load: on another page it waits, then continues only when the visitor chooses", async () => {
    vi.mocked(getOnboardingProgress).mockResolvedValue({
      steps: [{ key: "brand", title: "Tell NOVA about your business", completion_rule: "A brand profile exists.", status: "available" }],
      current_step: "brand",
      intro_video_seen: true,
      total_steps: 10,
      completed_steps: 0,
    });

    renderWidget("/overview"); // a direct visit / refresh, not a fresh sign-in

    await waitFor(() => expect(screen.getByTestId("guide-held")).toBeInTheDocument());
    expect(screen.getByText(/step 1 of 10: Tell NOVA about your business/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.getByTestId("location").textContent).toBe("/overview"); // not redirected
    expect(screen.queryByText("DEMONSTRATING")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Continue the tour"));
    expect(screen.getByTestId("location").textContent).toBe("/create-store");
    await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 10000 });
  }, 20000);

  it("starts the next step even when a page already refreshed the progress cache to it mid-lesson", async () => {
    // Real behaviour: submitting the brand form invalidates ["onboarding-progress"], so the widget's
    // cached current_step flips to "products" WHILE the brand lesson is still active.
    let brandDone = false;
    vi.mocked(getOnboardingProgress).mockImplementation(() =>
      Promise.resolve({
        steps: [
          { key: "brand", title: "Tell NOVA about your business", completion_rule: "x.", status: brandDone ? "completed" : "available" },
          { key: "products", title: "Add your products", completion_rule: "y.", status: brandDone ? "available" : "locked" },
        ],
        current_step: brandDone ? "products" : "brand",
        intro_video_seen: true,
        total_steps: 10,
        completed_steps: brandDone ? 1 : 0,
      } as never),
    );
    const queryClient = new QueryClient();
    function Pages() {
      return (
        <>
          <button
            data-nova-target="brand_form.save"
            onClick={() => {
              brandDone = true;
              void queryClient.invalidateQueries({ queryKey: ["onboarding-progress"] });
            }}
          >
            Continue to products
          </button>
          <button data-nova-target="product_form.save">Add product</button>
        </>
      );
    }
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/create-store"]}>
          <Pages />
          <NovaGuideWidget />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 10000 });
    fireEvent.click(screen.getByText("Continue to products"));
    // The next lesson must pick up on its own and ask for the next real control.
    await waitFor(() => expect(screen.getByText(/Step 2 of 10 — Add your products/)).toBeInTheDocument(), { timeout: 20000 });
  }, 40000);
});
