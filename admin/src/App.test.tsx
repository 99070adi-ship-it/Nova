import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { RequireAuth, RequireOnboardingComplete } from "./App";
import type { OnboardingProgress } from "./api/client";

vi.mock("./lib/auth", () => ({
  useAuth: vi.fn(),
}));
vi.mock("./api/client", async () => {
  const actual = await vi.importActual<typeof import("./api/client")>("./api/client");
  return { ...actual, getOnboardingProgress: vi.fn() };
});

import { getOnboardingProgress } from "./api/client";
import { useAuth } from "./lib/auth";

function progress(overrides: Partial<OnboardingProgress>): OnboardingProgress {
  return {
    steps: [],
    current_step: "products",
    intro_video_seen: true,
    ...overrides,
  };
}

// Mounts the real gate components with a placeholder destination, exactly as App.tsx composes
// them — proves the mandatory first-login pipeline is enforced by route structure (re-checked
// server state on every mount/navigation), not by any client-side flag that a refresh or a
// crafted URL could skip past. There is only one gate now (RequireOnboardingComplete) — the
// landing page's video is the sole "introduction"; authenticating of any kind (login, signup,
// the demo entry) lands directly on this gate, no separate /welcome detour.
function renderGatedRoute(initialPath: string) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/create-store" element={<div>CREATE MY STORE</div>} />
          <Route element={<RequireAuth />}>
            <Route path="/pipeline-page" element={<div>PIPELINE PAGE</div>} />
            <Route element={<RequireOnboardingComplete />}>
              <Route path="/protected" element={<div>PROTECTED DASHBOARD CONTENT</div>} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("mandatory first-login pipeline gating", () => {
  it("sends an unauthenticated visitor to login, never to protected content", async () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: false, user: null, loading: false } as never);
    renderGatedRoute("/protected");
    // RequireAuth redirects to /login, which isn't mounted in this route tree — absence of the
    // protected text is the proof; a real App.tsx render would land on the real LoginPage.
    expect(screen.queryByText("PROTECTED DASHBOARD CONTENT")).not.toBeInTheDocument();
  });

  it("a fresh login always enters the pipeline directly, never the dashboard — no bypass", async () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, user: {}, loading: false } as never);
    vi.mocked(getOnboardingProgress).mockResolvedValue(progress({ current_step: "brand" }));

    renderGatedRoute("/protected");

    await waitFor(() => expect(screen.getByText("CREATE MY STORE")).toBeInTheDocument());
    expect(screen.queryByText("PROTECTED DASHBOARD CONTENT")).not.toBeInTheDocument();
  });

  it("the pipeline's own pages remain reachable while onboarding is incomplete", async () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, user: {}, loading: false } as never);
    vi.mocked(getOnboardingProgress).mockResolvedValue(progress({ current_step: "publish" }));

    renderGatedRoute("/pipeline-page");

    await waitFor(() => expect(screen.getByText("PIPELINE PAGE")).toBeInTheDocument());
  });

  it("a completed onboarding enters the normal protected application", async () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, user: {}, loading: false } as never);
    vi.mocked(getOnboardingProgress).mockResolvedValue(progress({ current_step: null }));

    renderGatedRoute("/protected");

    await waitFor(() => expect(screen.getByText("PROTECTED DASHBOARD CONTENT")).toBeInTheDocument());
  });

  it("re-mounting fresh (simulating a page refresh) with incomplete onboarding still redirects — no client state to bypass", async () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, user: {}, loading: false } as never);
    vi.mocked(getOnboardingProgress).mockResolvedValue(progress({ current_step: "products" }));

    // Two independent fresh mounts (own QueryClient each, like a real page refresh with no
    // retained cache) land on the same gated result both times — nothing persisted client-side
    // changed the outcome.
    const first = renderGatedRoute("/protected");
    await waitFor(() => expect(screen.getByText("CREATE MY STORE")).toBeInTheDocument());
    first.unmount();

    renderGatedRoute("/protected");
    await waitFor(() => expect(screen.getByText("CREATE MY STORE")).toBeInTheDocument());
  });
});
