import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppLayout from "./AppLayout";
import { getOnboardingProgress } from "../api/client";
import { useAuth } from "../lib/auth";

vi.mock("../lib/auth", () => ({ useAuth: vi.fn(), useCurrentUserKey: () => "test-user" }));
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    getOnboardingProgress: vi.fn(),
    listProposals: vi.fn().mockResolvedValue([]),
    startConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
    postMessage: vi.fn().mockResolvedValue({ assistant_text: "Narration." }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ user: { full_name: "Test Owner" }, logout: vi.fn() } as never);
});

function renderLayout() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/overview"]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/overview" element={<div>PAGE CONTENT</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AppLayout — the app chrome is never blurred or disabled, even mid-onboarding", () => {
  it("keeps the sidebar and header sharp and interactive while a real onboarding step is in progress", async () => {
    // "storefront" rather than a registered lesson key that would navigate away from "/overview"
    // in this test's tiny route tree — this test only cares about AppLayout's own chrome.
    vi.mocked(getOnboardingProgress).mockResolvedValue({
      steps: [], current_step: "catalog", intro_video_seen: true, total_steps: 10, completed_steps: 3,
    });

    renderLayout();

    await waitFor(() => expect(getOnboardingProgress).toHaveBeenCalled());
    const aside = document.querySelector("aside")!;
    const header = document.querySelector("header")!;
    expect(aside.className).not.toMatch(/(^|\s)blur/);
    expect(aside.className).not.toContain("pointer-events-none");
    expect(aside.className).not.toContain("opacity-50");
    expect(header.className).not.toMatch(/(^|\s)blur/); // a frosted sticky header (backdrop-blur) is fine; blurring the chrome is not
    expect(header.className).not.toContain("pointer-events-none");
    expect(screen.getByText("PAGE CONTENT")).toBeInTheDocument();
    // Every nav destination is a live link, not an inert block.
    expect(screen.getByText("Products").closest("a")).not.toBeNull();
    expect(screen.getByText("Approvals").closest("a")).not.toBeNull();
  });
});
