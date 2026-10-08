import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppLayout from "./AppLayout";
import { getOnboardingProgress } from "../api/client";
import { useAuth } from "../lib/auth";

vi.mock("../lib/auth", () => ({ useAuth: vi.fn() }));
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    getOnboardingProgress: vi.fn(),
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

describe("AppLayout — the app chrome blurs during onboarding, the current task never does", () => {
  it("blurs the sidebar and header while a real onboarding step is in progress", async () => {
    // "collections" rather than a real NovaGuideWidget lesson key (e.g. "brand") deliberately —
    // this test only cares about AppLayout's own chrome-blur logic, and a registered lesson key
    // would make the now-globally-mounted widget navigate away from "/overview" (which this
    // test's route tree never defines a target for), unmounting AppLayout itself.
    vi.mocked(getOnboardingProgress).mockResolvedValue({ steps: [], current_step: "collections", intro_video_seen: true });

    renderLayout();

    await waitFor(() => expect(getOnboardingProgress).toHaveBeenCalled());
    const aside = document.querySelector("aside")!;
    const header = document.querySelector("header")!;
    await waitFor(() => expect(aside.className).toContain("blur-sm"));
    expect(header.className).toContain("blur-sm");
    expect(aside.className).toContain("pointer-events-none");

    // The actual page content (<main>'s Outlet) is never blurred or disabled.
    const main = document.querySelector("main")!;
    expect(main.className).not.toContain("blur-sm");
    expect(screen.getByText("PAGE CONTENT")).toBeInTheDocument();
  });

  it("leaves the chrome sharp and interactive once onboarding is complete", async () => {
    vi.mocked(getOnboardingProgress).mockResolvedValue({ steps: [], current_step: null, intro_video_seen: true });

    renderLayout();

    await waitFor(() => expect(getOnboardingProgress).toHaveBeenCalled());
    const aside = document.querySelector("aside")!;
    const header = document.querySelector("header")!;
    expect(aside.className).not.toContain("blur-sm");
    expect(header.className).not.toContain("blur-sm");
  });
});
