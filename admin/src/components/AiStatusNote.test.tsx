import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AiStatusNote from "./AiStatusNote";
import { getAiStatus, type AiStatus } from "../api/client";

vi.mock("../api/client", () => ({ getAiStatus: vi.fn() }));
afterEach(() => cleanup());

const show = (status: Partial<AiStatus>) => {
  vi.mocked(getAiStatus).mockResolvedValue({ provider: "fake", model: null, real_ai: false, mode: "rule_based_demo", credentials_configured: true, ready: true, ...status });
  return render(<QueryClientProvider client={new QueryClient()}><AiStatusNote /></QueryClientProvider>);
};

describe("AI status note", () => {
  it("says plainly when the replies come from built-in rules, not a language model", async () => {
    show({});
    expect(await screen.findByTestId("ai-status-note")).toHaveTextContent("Demo mode: NOVA's text replies come from built-in rules, not a language model.");
  });
  it("names the real model when one is active", async () => {
    show({ provider: "nvidia", model: "nvidia/nemotron-3-super-120b-a12b", real_ai: true, mode: "language_model", ready: null });
    expect(await screen.findByTestId("ai-status-note")).toHaveTextContent("Text AI: nvidia/nemotron-3-super-120b-a12b.");
  });
  it("says so when a real provider has no credentials instead of pretending", async () => {
    show({ provider: "nvidia", model: "m", real_ai: true, mode: "language_model", credentials_configured: false, ready: false });
    expect(await screen.findByTestId("ai-status-note")).toHaveTextContent("isn't configured");
  });
  it("tells you to restart when backend/.env changed after the server started", async () => {
    show({ config: { restart_required: true, changed_on_disk: ["AI_PROVIDER"], overridden_by_environment: [], env_file_found: true } });
    expect(await screen.findByTestId("ai-status-note")).toHaveTextContent("Restart the backend");
  });
  it("shows nothing if the status can't be read", async () => {
    vi.mocked(getAiStatus).mockRejectedValue(new Error("down"));
    render(<QueryClientProvider client={new QueryClient()}><AiStatusNote /></QueryClientProvider>);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("ai-status-note")).not.toBeInTheDocument();
  });
});
