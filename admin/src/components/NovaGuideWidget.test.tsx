import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import NovaGuideWidget from "./NovaGuideWidget";
import { getOnboardingProgress, postMessage, startConversation } from "../api/client";
import { LESSON_STEPS, getLessonStep, primaryActionTarget } from "../lib/novaLessons";
import { setNarrationTiming } from "../lib/typewriter";

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
    expect(postMessage).toHaveBeenCalledWith("conv-1", "How many products do I have?", "overview", undefined); // with the screen the person is on
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
    await waitFor(() => expect(screen.getByText(/Step 1 of 10 — Tell NOVA about your business/)).toBeInTheDocument(), { timeout: 15000 });
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
      { timeout: 15000 },
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

    await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 15000 });

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

    await waitFor(() => expect(screen.getByText(/Step 1 of \d+/)).toBeInTheDocument(), { timeout: 15000 });
    expect(screen.queryByText("Ask me anything")).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 15000 });
    // Real backend state still says incomplete — waiting here, however long, must never retract
    // on its own.
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByText("Ask me anything")).not.toBeInTheDocument();

    completed = true; // only now does the real backend state actually change
    await waitFor(() => expect(screen.getByText("DONE")).toBeInTheDocument(), { timeout: 15000 });
    expect(screen.queryByText("Ask me anything")).not.toBeInTheDocument(); // still mid-retract beat

    await waitFor(() => expect(screen.getByText("Ask me anything")).toBeInTheDocument(), { timeout: 15000 });
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

    await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 15000 });
    // The cue ring appears once the explanation has had its reading time (pacing), not instantly.
    await waitFor(() => expect(document.querySelector("[data-nova-spotlight]")).not.toBeNull(), { timeout: 15000 });
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
    await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 15000 });
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
    await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 15000 });
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

    await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 15000 });
    fireEvent.click(screen.getByText("Continue to products"));
    // The next lesson must pick up on its own and ask for the next real control.
    await waitFor(() => expect(screen.getByText(/Step 2 of 10 — Add your products/)).toBeInTheDocument(), { timeout: 20000 });
  }, 40000);

  it("positions the box from its measured height, so a tall box (long text + Return control) never overflows the viewport", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 420 });
    try {
      vi.mocked(getOnboardingProgress).mockResolvedValue({
        steps: [{ key: "brand", title: "Tell NOVA about your business", completion_rule: "A brand profile exists.", status: "available" }],
        current_step: "brand",
        intro_video_seen: true,
        total_steps: 10,
        completed_steps: 0,
      });
      renderWidget("/create-store");
      await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 15000 });
      fireEvent.click(screen.getByText("LEAVE TO PRODUCTS"));
      const box = (await screen.findByTestId("guide-return")).closest("div.fixed") as HTMLElement;
      await waitFor(() => expect(parseFloat(box.style.top) + 420).toBeLessThanOrEqual(window.innerHeight - 24));
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "offsetHeight", original);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
    }
  }, 20000);

  describe("the centered NOVA presentation and the typed narration", () => {
    const progressFor = (...keys: string[]) => {
      let doneUpTo = 0;
      return {
        advance: () => {
          doneUpTo += 1;
        },
        get: () => {
          const steps = keys.map((k, i) => ({
            key: k,
            title: getLessonStep(k)!.title,
            completion_rule: "x.",
            status: i < doneUpTo ? "completed" : i === doneUpTo ? "available" : "locked",
          }));
          return Promise.resolve({
            steps,
            current_step: doneUpTo >= keys.length ? null : keys[doneUpTo],
            intro_video_seen: true,
            total_steps: 10,
            completed_steps: doneUpTo,
          } as never);
        },
      };
    };

    // A page that offers the real control each lesson targets, so the Guide's pre-flight finds it.
    function StepTargets({ keys }: { keys: string[] }) {
      return (
        <>
          {keys.map((k) => (
            <button key={k} data-nova-target={primaryActionTarget(getLessonStep(k)!)}>
              {getLessonStep(k)!.nextActionLabel}
            </button>
          ))}
        </>
      );
    }

    function renderTour(keys: string[], path: string) {
      return render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={[{ pathname: path, state: { beginTour: true } }]}>
            <LocationDisplay />
            <StepTargets keys={keys} />
            <NovaGuideWidget />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    }

    afterEach(() => {
      setNarrationTiming({ charMs: 1 });
      vi.unstubAllGlobals();
    });

    const scrim = () => document.querySelector("[data-nova-scrim]") as HTMLElement | null;
    const presentation = () => document.querySelector("[data-nova-presentation]");

    it.each(LESSON_STEPS.map((l) => l.key))(
      "%s begins with the centered presentation: backdrop on, NOVA identity + the step title, narration typed; then it clears before the user acts",
      async (key) => {
        const step = getLessonStep(key)!;
        setNarrationTiming({ charMs: 12 });
        const progress = progressFor(key);
        vi.mocked(getOnboardingProgress).mockImplementation(progress.get);

        renderTour([key], step.path);

        // 1. Centered presentation over a blurred backdrop, with NOVA's identity and the step title.
        await waitFor(() => expect(presentation()).not.toBeNull(), { timeout: 15000 });
        expect(scrim()).toHaveAttribute("data-state", "on");
        expect(scrim()!.className).toContain("backdrop-blur");
        expect(screen.getByTestId("guide-step-title")).toHaveTextContent(step.title);
        expect(presentation()).toHaveTextContent("NOVA");
        expect(presentation()).toHaveTextContent(/Step \d+ of 10/);
        const box = presentation()!.closest("div.fixed") as HTMLElement;
        // Centered in the viewport (jsdom: 1024 x 768).
        const width = Math.min(460, window.innerWidth - 48);
        await waitFor(() => expect(parseFloat(box.style.left)).toBeCloseTo((window.innerWidth - width) / 2, 0));
        expect(parseFloat(box.style.width)).toBe(width);

        // 2. The step's own concise narration is typed out inside it.
        const typed = screen.getByTestId("guide-typed");
        await waitFor(() => expect(typed.textContent!.length).toBeGreaterThan(0));
        expect(step.intro.startsWith(typed.textContent!)).toBe(true);
        expect(screen.getByTestId("guide-message")).toHaveTextContent(step.intro);

        // 3. Once it has finished, the presentation transitions away and the backdrop is gone...
        await waitFor(() => expect(presentation()).toBeNull(), { timeout: 15000 });
        await waitFor(() => expect(scrim()).toHaveAttribute("data-state", "off"));
        expect(scrim()!.className).toContain("pointer-events-none");
        expect(scrim()!.className).toContain("opacity-0");
        // ...and only then is the visitor asked to act, on a page that is usable.
        await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 20000 });
        expect(presentation()).toBeNull();
        expect(scrim()).toHaveAttribute("data-state", "off");
        expect(document.querySelector('[data-nova-spotlight="focus"]')).toBeNull();
        expect(screen.getByText(`"${step.nextActionLabel}"`, { exact: false })).toBeInTheDocument();
      },
      60000,
    );

    it("nothing moves while NOVA is introducing the step: no demo spotlight and no navigation until the last character is typed", async () => {
      setNarrationTiming({ charMs: 25 });
      const step = getLessonStep("brand")!;
      vi.mocked(getOnboardingProgress).mockImplementation(progressFor("brand").get);

      renderTour(["brand"], "/create-store");

      const typed = await screen.findByTestId("guide-typed", undefined, { timeout: 15000 });
      const focusWhileTyping: boolean[] = [];
      const watch = setInterval(() => {
        if (typed.textContent !== step.intro) focusWhileTyping.push(!!document.querySelector('[data-nova-spotlight="focus"]'));
      }, 5);
      await waitFor(() => expect(document.querySelector('[data-nova-spotlight="focus"]')).not.toBeNull(), { timeout: 15000 });
      clearInterval(watch);
      expect(focusWhileTyping.length).toBeGreaterThan(5);
      expect(focusWhileTyping.some(Boolean)).toBe(false);
      expect(typed.textContent).toBe(step.intro); // complete before anything moved
      expect(presentation()).toBeNull(); // and the presentation had travelled away first
    }, 30000);

    it("the presentation repeats at the start of EVERY step, and the next one cannot begin before the previous is verified", async () => {
      setNarrationTiming({ charMs: 4 });
      const progress = progressFor("brand", "products");
      vi.mocked(getOnboardingProgress).mockImplementation(progress.get);

      renderTour(["brand", "products"], "/create-store");

      await waitFor(() => expect(screen.getByTestId("guide-step-title")).toHaveTextContent(getLessonStep("brand")!.title), { timeout: 15000 });
      await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 15000 });

      // Step 1 is not verified: however long we wait, step 2's presentation never starts.
      await new Promise((r) => setTimeout(r, 400));
      expect(screen.queryByText(getLessonStep("products")!.title)).not.toBeInTheDocument();
      expect(presentation()).toBeNull();

      progress.advance(); // the SERVER now reports step 1 complete
      // Step 2 opens with its own centered presentation (backdrop back on, new title).
      await waitFor(() => expect(screen.getByTestId("guide-step-title")).toHaveTextContent(getLessonStep("products")!.title), { timeout: 30000 });
      expect(scrim()).toHaveAttribute("data-state", "on");
      await waitFor(() => expect(presentation()).toBeNull(), { timeout: 15000 });
      expect(scrim()).toHaveAttribute("data-state", "off");
    }, 90000);

    it("writes the narration out inside the panel: the visible text grows, the full text is already there for screen readers, and nothing is announced character by character", async () => {
      setNarrationTiming({ charMs: 25 });
      const step = getLessonStep("brand")!;
      vi.mocked(getOnboardingProgress).mockImplementation(progressFor("brand").get);

      renderTour(["brand"], "/create-store");

      const typed = await screen.findByTestId("guide-typed", undefined, { timeout: 15000 });
      const live = screen.getByTestId("guide-message");
      expect(live).toHaveTextContent(step.intro); // complete, available at once
      expect(live).toHaveAttribute("aria-live", "polite"); // one polite region, announced once
      expect(typed).toHaveAttribute("aria-hidden", "true"); // the animated layer is invisible to assistive tech
      expect(typed).toHaveClass("whitespace-pre-line"); // line breaks in narration render as line breaks

      await waitFor(() => expect(typed.textContent!.length).toBeGreaterThan(0));
      const partial = typed.textContent!;
      expect(partial.length).toBeLessThan(step.intro.length);
      expect(step.intro.startsWith(partial)).toBe(true); // always a clean prefix
      expect(screen.getByTestId("guide-caret")).toBeInTheDocument();
      await waitFor(() => expect(typed.textContent).toBe(step.intro), { timeout: 15000 });
    }, 30000);

    it("Skip reveals the rest of the message immediately and the step carries on", async () => {
      setNarrationTiming({ charMs: 800 }); // far too slow to wait out in a test
      const step = getLessonStep("brand")!;
      vi.mocked(getOnboardingProgress).mockImplementation(progressFor("brand").get);

      renderTour(["brand"], "/create-store");

      const skip = await screen.findByRole("button", { name: "Show the full message now" }, { timeout: 15000 });
      expect(screen.getByTestId("guide-typed").textContent!.length).toBeLessThan(step.intro.length);
      fireEvent.click(skip);
      await waitFor(() => expect(screen.getByTestId("guide-typed").textContent).toBe(step.intro));
      await waitFor(() => expect(presentation()).toBeNull(), { timeout: 15000 }); // moved on at once, not after ~30 s
    }, 30000);

    it("under reduced motion the whole message appears at once, with no caret, and the sequence continues", async () => {
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
      setNarrationTiming({ charMs: 500 }); // the real cadence must be bypassed, not waited out
      const step = getLessonStep("brand")!;
      vi.mocked(getOnboardingProgress).mockImplementation(progressFor("brand").get);

      renderTour(["brand"], "/create-store");

      await waitFor(() => expect(presentation()).not.toBeNull(), { timeout: 15000 });
      await waitFor(() => expect(screen.getByTestId("guide-typed").textContent).toBe(step.intro), { timeout: 15000 });
      expect(screen.queryByTestId("guide-caret")).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 15000 });
    }, 30000);

    it("a visitor's completed interaction is still verified by the server, and the completion message types out before the panel retracts", async () => {
      setNarrationTiming({ charMs: 12 });
      const progress = progressFor("brand");
      vi.mocked(getOnboardingProgress).mockImplementation(progress.get);

      renderTour(["brand"], "/create-store");
      await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 20000 });
      expect(screen.queryByText("Ask me anything")).not.toBeInTheDocument();

      progress.advance(); // the real backend state changes: this is what completes the step
      await waitFor(() => expect(screen.getByText("DONE")).toBeInTheDocument(), { timeout: 15000 });
      expect(screen.queryByText("Ask me anything")).not.toBeInTheDocument(); // still writing the completion message
      await waitFor(() => expect(screen.getByTestId("guide-typed").textContent).toBe(getLessonStep("brand")!.done), { timeout: 15000 });
      await waitFor(() => expect(screen.getByText("Ask me anything")).toBeInTheDocument(), { timeout: 15000 });
    }, 60000);

    it("hand-off: the reply to the visitor and the next step's presentation are one continuous centered moment (no dock bounce, no flash of the page)", async () => {
      setNarrationTiming({ charMs: 6 });
      const progress = progressFor("brand", "products");
      vi.mocked(getOnboardingProgress).mockImplementation(progress.get);

      renderTour(["brand", "products"], "/create-store");
      await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 20000 });

      const scrimStates: Array<string | null> = [];
      let sawDock = false;
      let maxPresentations = 0;
      const watch = setInterval(() => {
        scrimStates.push(scrim()?.getAttribute("data-state") ?? null);
        if (screen.queryByText("Ask me anything")) sawDock = true;
        maxPresentations = Math.max(maxPresentations, document.querySelectorAll("[data-nova-presentation]").length);
      }, 2);

      progress.advance(); // the server verifies step 1
      // Step 1's reply appears centered, with its own completion line...
      await waitFor(() => expect(screen.getByTestId("guide-message")).toHaveTextContent(getLessonStep("brand")!.done), { timeout: 15000 });
      expect(presentation()).not.toBeNull();
      // ...and flows straight into step 2's introduction.
      await waitFor(() => expect(screen.getByTestId("guide-step-title")).toHaveTextContent(getLessonStep("products")!.title), { timeout: 20000 });
      clearInterval(watch);

      const firstOn = scrimStates.indexOf("on");
      const stepTwoStart = scrimStates.length - 1;
      expect(scrimStates.slice(firstOn, stepTwoStart + 1)).not.toContain("off"); // the backdrop never dropped in between
      expect(sawDock).toBe(false); // the panel did not go back to the launcher
      expect(maxPresentations).toBe(1); // never two overlapping presentations
    }, 60000);

    it("after the FIRST action of a two-action lesson NOVA replies centered, and the blur is gone before the second control is cued", async () => {
      setNarrationTiming({ charMs: 6 });
      const step = getLessonStep("nl_edit")!;
      vi.mocked(getOnboardingProgress).mockImplementation(progressFor("nl_edit").get);

      renderTour(["nl_edit"], step.path);
      await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 20000 });
      expect(scrim()).toHaveAttribute("data-state", "off");

      // The visitor pressed Propose and the plan exists: the Apply control now appears on the page.
      const apply = document.createElement("button");
      apply.setAttribute("data-nova-target", step.secondUserTurnTarget!);
      apply.textContent = "Apply to draft";
      document.body.appendChild(apply);

      await waitFor(() => expect(presentation()).not.toBeNull(), { timeout: 15000 });
      expect(scrim()).toHaveAttribute("data-state", "on");
      expect(screen.getByTestId("guide-message")).toHaveTextContent(step.respond!);
      expect(document.querySelector("[data-nova-spotlight]")).toBeNull(); // no cue while NOVA is replying

      await waitFor(() => expect(presentation()).toBeNull(), { timeout: 15000 });
      expect(scrim()).toHaveAttribute("data-state", "off"); // usable again before the second action
      await waitFor(() => expect(document.querySelector('[data-nova-spotlight="cue"]')).not.toBeNull());
      apply.remove();
    }, 60000);

    it("while NOVA types the explanation, the working panel sits BESIDE the control to press, never on top of it", async () => {
      setNarrationTiming({ charMs: 40 });
      const step = getLessonStep("publish")!;
      vi.mocked(getOnboardingProgress).mockImplementation(progressFor("publish").get);
      // The Publish control lives in the lower right, exactly where the panel used to rest.
      const rect = { left: 800, top: 600, width: 180, height: 40, right: 980, bottom: 640, x: 800, y: 600, toJSON: () => ({}) } as DOMRect;
      const original = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function () {
        return this.getAttribute?.("data-nova-target") === primaryActionTarget(step) ? rect : original.call(this);
      };
      try {
        renderTour(["publish"], step.path);
        await waitFor(() => expect(screen.getByText("EXPLAINING")).toBeInTheDocument(), { timeout: 20000 });
        const box = screen.getByText("EXPLAINING").closest("div.fixed") as HTMLElement;
        await waitFor(() => {
          const left = parseFloat(box.style.left);
          const width = parseFloat(box.style.width);
          const clearOfTarget = left >= rect.right || left + width <= rect.left; // not horizontally over the control
          expect(clearOfTarget).toBe(true);
        });
        expect(screen.getByTestId("guide-caret")).toBeInTheDocument(); // still typing: the cue ring has not appeared
        expect(document.querySelector("[data-nova-spotlight]")).toBeNull();
      } finally {
        HTMLElement.prototype.getBoundingClientRect = original;
      }
    }, 60000);

    describe("NOVA never goes backwards", () => {
      const serverState = (current: string | null, completed: string[]) => () =>
        Promise.resolve({
          steps: LESSON_STEPS.map((l) => ({
            key: l.key,
            title: l.title,
            completion_rule: "x.",
            status: completed.includes(l.key) ? "completed" : l.key === current ? "available" : "locked",
          })),
          current_step: current,
          intro_video_seen: true,
          total_steps: 10,
          completed_steps: completed.length,
        } as never);

      function renderWith(client: QueryClient, path: string, keys: string[], beginTour = true) {
        return render(
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[beginTour ? { pathname: path, state: { beginTour: true } } : path]}>
              <LocationDisplay />
              <StepTargets keys={keys} />
              <NovaGuideWidget />
            </MemoryRouter>
          </QueryClientProvider>,
        );
      }

      it("if the server says an EARLIER step is incomplete again, it neither navigates back nor replays it: it offers a recovery the visitor controls", async () => {
        setNarrationTiming({ charMs: 1 });
        let state = serverState("products", ["brand"]);
        vi.mocked(getOnboardingProgress).mockImplementation(() => state());
        const client = new QueryClient();
        renderWith(client, "/create-store", ["brand", "products"]);

        // Step 2 runs and finishes; the tour is then (as far as this test's world goes) complete.
        await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 20000 });
        state = serverState(null, ["brand", "products"]);
        await waitFor(() => expect(screen.getByText("Ask me anything")).toBeInTheDocument(), { timeout: 20000 });

        // Later the server reports step 1 incomplete again (e.g. its data changed). The Guide must not go back.
        state = serverState("brand", ["products"]);
        await act(async () => {
          await client.invalidateQueries({ queryKey: ["onboarding-progress"] });
        });
        await waitFor(() => expect(screen.getByTestId("guide-recovery")).toBeInTheDocument());
        expect(screen.getByTestId("guide-recovery")).toHaveTextContent(/Step 1 needs another look/i);
        expect(screen.getByTestId("guide-recovery")).toHaveTextContent(getLessonStep("brand")!.title);
        expect(presentation()).toBeNull(); // not replayed
        expect(screen.queryByText("WAITING FOR YOU")).not.toBeInTheDocument();
        expect(screen.getByTestId("location").textContent).toBe("/create-store"); // not navigated anywhere

        // Only the visitor can send it back.
        fireEvent.click(screen.getByRole("button", { name: "Revisit step 1" }));
        await waitFor(() => expect(screen.getByTestId("guide-step-title")).toHaveTextContent(getLessonStep("brand")!.title), { timeout: 15000 });
      }, 90000);

      it("'Not now' dismisses the recovery and it does not come back on the next refresh of the same state", async () => {
        let state = serverState("products", ["brand"]);
        vi.mocked(getOnboardingProgress).mockImplementation(() => state());
        const client = new QueryClient();
        renderWith(client, "/create-store", ["brand", "products"]);
        await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 20000 });
        state = serverState(null, ["brand", "products"]);
        await waitFor(() => expect(screen.getByText("Ask me anything")).toBeInTheDocument(), { timeout: 20000 });
        state = serverState("brand", ["products"]);
        await act(async () => {
          await client.invalidateQueries({ queryKey: ["onboarding-progress"] });
        });
        await waitFor(() => expect(screen.getByTestId("guide-recovery")).toBeInTheDocument());
        fireEvent.click(screen.getByRole("button", { name: "Not now" }));
        expect(screen.queryByTestId("guide-recovery")).not.toBeInTheDocument();
        await act(async () => {
          await client.invalidateQueries({ queryKey: ["onboarding-progress"] });
        });
        await new Promise((r) => setTimeout(r, 200));
        expect(screen.queryByTestId("guide-recovery")).not.toBeInTheDocument();
        expect(presentation()).toBeNull();
      }, 90000);

      it("a finished tour stays finished: cache refreshes and re-renders never replay or restart anything", async () => {
        vi.mocked(getOnboardingProgress).mockImplementation(serverState(null, LESSON_STEPS.map((l) => l.key)));
        const client = new QueryClient();
        const { rerender } = renderWith(client, "/overview", [], false);
        await waitFor(() => expect(screen.getByText("Ask me anything")).toBeInTheDocument());
        for (let i = 0; i < 3; i++) {
          await act(async () => {
            await client.invalidateQueries({ queryKey: ["onboarding-progress"] });
          });
          rerender(
            <QueryClientProvider client={client}>
              <MemoryRouter initialEntries={["/overview"]}>
                <LocationDisplay />
                <NovaGuideWidget />
              </MemoryRouter>
            </QueryClientProvider>,
          );
        }
        await new Promise((r) => setTimeout(r, 150));
        expect(presentation()).toBeNull();
        expect(screen.queryByTestId("guide-held")).not.toBeInTheDocument();
        expect(screen.queryByTestId("guide-recovery")).not.toBeInTheDocument();
        expect(screen.getByText("Ask me anything")).toBeInTheDocument();
      });

      it("a refresh mid-tour restores the real current step: never an earlier one, and it waits (no navigation) until the visitor continues", async () => {
        vi.mocked(getOnboardingProgress).mockImplementation(serverState("catalog", ["brand", "products"]));
        renderWith(new QueryClient(), "/overview", ["catalog"], false); // a plain page load somewhere else
        const held = await screen.findByTestId("guide-held");
        expect(held).toHaveTextContent(getLessonStep("catalog")!.title);
        expect(held).not.toHaveTextContent(getLessonStep("brand")!.title);
        expect(presentation()).toBeNull();
        expect(screen.getByTestId("location").textContent).toBe("/overview");
      });

      it("only one lesson is ever active: the same completion cannot start the next step twice", async () => {
        setNarrationTiming({ charMs: 2 });
        const progress = progressFor("brand", "products", "catalog");
        vi.mocked(getOnboardingProgress).mockImplementation(progress.get);
        renderTour(["brand", "products", "catalog"], "/create-store");
        await waitFor(() => expect(screen.getByText("WAITING FOR YOU")).toBeInTheDocument(), { timeout: 20000 });
        const messages = new Set<string>();
        let overlap = 0;
        const watch = setInterval(() => {
          const m = screen.queryByTestId("guide-message")?.textContent;
          if (m) messages.add(m);
          overlap = Math.max(overlap, document.querySelectorAll("[data-nova-presentation]").length);
        }, 2);
        progress.advance();
        await waitFor(() => expect(screen.getByTestId("guide-step-title")).toHaveTextContent(getLessonStep("products")!.title), { timeout: 20000 });
        await new Promise((r) => setTimeout(r, 300));
        clearInterval(watch);
        expect(overlap).toBeLessThanOrEqual(1);
        expect(messages.has(getLessonStep("catalog")!.intro)).toBe(false); // step 3 did not start early
        expect(messages.has(getLessonStep("brand")!.intro)).toBe(false); // and step 1's introduction was not replayed
        expect(messages.has(getLessonStep("brand")!.done)).toBe(true); // only its completion reply was shown
        expect(messages.has(getLessonStep("products")!.intro)).toBe(true);
      }, 60000);
    });
  });
});
