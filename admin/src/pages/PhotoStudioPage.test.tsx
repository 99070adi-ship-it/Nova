import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PhotoStudioPage from "./PhotoStudioPage";
import * as api from "../api/client";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    getStudioStatus: vi.fn(),
    listStudioHistory: vi.fn(),
    studioGenerate: vi.fn(),
    studioEdit: vi.fn(),
    deleteStudioImage: vi.fn(),
    fetchStudioImageBlob: vi.fn(),
  };
});

const status = {
  configured: true, demo_workspace: false, used_today: 3, daily_limit: 20, max_upload_mb: 5,
  styles: [{ key: "none", label: "No preset" }, { key: "studio", label: "Product studio" }],
  generate: { available: true, note: null }, edit: { available: true, note: null },
  enhance: { available: false, note: "Coming soon. No enhancement model is connected yet, so NOVA doesn't offer it." },
};
const img = { id: "i1", kind: "generated" as const, prompt: "a ceramic mug", style: "none", model: "m", width: 1024, height: 1024, source_image_id: null, created_at: "2026-11-02T10:00:00Z" };

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PhotoStudioPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getStudioStatus).mockResolvedValue(status);
  vi.mocked(api.listStudioHistory).mockResolvedValue([]);
  vi.mocked(api.fetchStudioImageBlob).mockResolvedValue(new Blob(["x"], { type: "image/png" }));
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
});

describe("PhotoStudioPage", () => {
  it("shows usage, an honest empty state, and Enhance as coming soon (no fake enhance control)", async () => {
    renderPage();
    expect(await screen.findByText("3 of 20 images used today")).toBeInTheDocument();
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Enhance/ })).toHaveTextContent("Coming soon");
    fireEvent.click(screen.getByRole("tab", { name: /Enhance/ }));
    expect(screen.getByText("Enhancement is coming soon")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^enhance/i })).not.toBeInTheDocument();
  });

  it("generates through the real API call with the chosen prompt, style and count", async () => {
    vi.mocked(api.studioGenerate).mockResolvedValue({ images: [img], failed: 0, message: null });
    renderPage();
    fireEvent.change(await screen.findByLabelText("Describe what you imagine"), { target: { value: "a ceramic mug on a table" } });
    fireEvent.click(screen.getByRole("button", { name: "Product studio" }));
    fireEvent.change(screen.getByLabelText("Images"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(api.studioGenerate).toHaveBeenCalledWith({ prompt: "a ceramic mug on a table", style: "studio", count: 2 }));
  });

  it("keeps Generate disabled until there is a real prompt", async () => {
    renderPage();
    const btn = await screen.findByRole("button", { name: "Generate" });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Describe what you imagine"), { target: { value: "ok" } });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Describe what you imagine"), { target: { value: "a red chair" } });
    expect(btn).toBeEnabled();
  });

  it("shows the server's message when generation fails, and does not claim success", async () => {
    vi.mocked(api.studioGenerate).mockRejectedValue(new api.ApiError(503, "unavailable", "The image service took too long to respond. Please try again.", null));
    renderPage();
    fireEvent.change(await screen.findByLabelText("Describe what you imagine"), { target: { value: "a red chair" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("took too long");
  });

  it("explains the demo workspace restriction and disables generating", async () => {
    vi.mocked(api.getStudioStatus).mockResolvedValue({
      ...status, demo_workspace: true, generate: { available: false, note: "Not available in the demo workspace." }, edit: { available: false, note: "Not available in the demo workspace." },
    });
    renderPage();
    expect(await screen.findByText("Not available in the demo workspace.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Describe what you imagine"), { target: { value: "a red chair" } });
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
  });

  it("disables Generate and says why once the daily limit is reached", async () => {
    vi.mocked(api.getStudioStatus).mockResolvedValue({ ...status, used_today: 20 });
    renderPage();
    fireEvent.change(await screen.findByLabelText("Describe what you imagine"), { target: { value: "a red chair" } });
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    expect(screen.getByText(/reached today's limit/)).toBeInTheDocument();
  });

  it("lists history with download, regenerate and delete controls", async () => {
    vi.mocked(api.listStudioHistory).mockResolvedValue([img]);
    vi.mocked(api.deleteStudioImage).mockResolvedValue(undefined);
    renderPage();
    expect(await screen.findByText("a ceramic mug")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteStudioImage).toHaveBeenCalledWith("i1", expect.anything()));
  });

  it("edit tab needs an image and an instruction before it can run", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Edit image" })).toBeDisabled();
    const file = new File(["x"], "p.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Image to edit"), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("What should change?"), { target: { value: "make the background grey" } });
    expect(screen.getByRole("button", { name: "Edit image" })).toBeEnabled();
  });
});
