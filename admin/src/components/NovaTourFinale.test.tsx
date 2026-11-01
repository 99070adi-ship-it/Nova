import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NovaTourFinale from "./NovaTourFinale";
import * as api from "../api/client";

const logout = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/auth", () => ({ useAuth: () => ({ logout }) }));
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, getOnboardingProgress: vi.fn(), getStudioStatus: vi.fn() };
});

const progress = (done: number): api.OnboardingProgress => ({
  steps: [], current_step: done >= 10 ? null : "brand", intro_video_seen: true, total_steps: 10, completed_steps: done,
});
const studio = (demo: boolean) => ({
  configured: true, demo_workspace: demo, used_today: 0, daily_limit: 20, max_upload_mb: 5, styles: [],
  generate: { available: !demo, note: null }, edit: { available: !demo, note: null }, enhance: { available: false, note: "Coming soon." },
});

let qc: QueryClient;
function renderFinale() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/overview"]}>
        <NovaTourFinale />
        <Routes>
          <Route path="/overview" element={<div>OVERVIEW</div>} />
          <Route path="/photo-studio" element={<div>PHOTO STUDIO PAGE</div>} />
          <Route path="/signup" element={<div>SIGNUP PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const loaded = () => waitFor(() => expect(qc.getQueryData(["onboarding-progress"])).toBeTruthy());
const finish = async () => {
  vi.mocked(api.getOnboardingProgress).mockResolvedValue(progress(10));
  await act(async () => { await qc.invalidateQueries({ queryKey: ["onboarding-progress"] }); });
};

beforeEach(() => {
  vi.resetAllMocks();
  logout.mockResolvedValue(undefined);
});

describe("NovaTourFinale", () => {
  it("does not appear while the tour is in progress", async () => {
    vi.mocked(api.getOnboardingProgress).mockResolvedValue(progress(4));
    renderFinale();
    await loaded();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not pop up for someone whose tour was already finished when the page loaded", async () => {
    vi.mocked(api.getOnboardingProgress).mockResolvedValue(progress(10));
    renderFinale();
    await loaded();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("appears when the tour completes, names Photo Studio, and sends a real account to it", async () => {
    vi.mocked(api.getOnboardingProgress).mockResolvedValue(progress(9));
    vi.mocked(api.getStudioStatus).mockResolvedValue(studio(false));
    renderFinale();
    await loaded();
    await finish();
    expect(await screen.findByRole("dialog")).toHaveTextContent("That was NOVA.");
    expect(screen.getByText("Photo Studio")).toBeInTheDocument();
    expect(await screen.findByText(/Generate and Edit are live\. Enhance is coming soon\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Photo Studio" }));
    expect(await screen.findByText("PHOTO STUDIO PAGE")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is honest in the demo workspace: Photo Studio needs an account, and the CTA is to create one", async () => {
    vi.mocked(api.getOnboardingProgress).mockResolvedValue(progress(9));
    vi.mocked(api.getStudioStatus).mockResolvedValue(studio(true));
    renderFinale();
    await loaded();
    await finish();
    expect(await screen.findByText(/not in this demo workspace/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Photo Studio" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(await screen.findByText("SIGNUP PAGE")).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed with the button or Escape without leaving the workspace", async () => {
    vi.mocked(api.getOnboardingProgress).mockResolvedValue(progress(9));
    vi.mocked(api.getStudioStatus).mockResolvedValue(studio(false));
    renderFinale();
    await loaded();
    await finish();
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("OVERVIEW")).toBeInTheDocument();
  });
});
