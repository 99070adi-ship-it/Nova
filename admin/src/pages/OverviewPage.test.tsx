import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OverviewPage from "./OverviewPage";
import * as api from "../api/client";

vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: { full_name: "Test Owner", role: "owner" } }) }));
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    getOnboardingProgress: vi.fn(),
    getSalesSummary: vi.fn(),
    getLowStockProducts: vi.fn(),
    getCustomerActivity: vi.fn(),
    listProposals: vi.fn(),
    getLatestStoreHealth: vi.fn(),
    getLatestActionPlan: vi.fn(),
    getStoreHealth: vi.fn(),
    createActionPlan: vi.fn(),
  };
});

const report = {
  run_id: "r1",
  generated_at: "2026-10-13T10:00:00Z",
  findings: [
    { category: "inventory", metric: "low", status: "at_risk", finding: "3 products at or below their threshold.", severity: "high", evidence: {}, suggested_action: "Reorder stock." },
    { category: "sales", metric: "rev", status: "good", finding: "$100 in revenue.", severity: "low", evidence: {}, suggested_action: null },
  ],
  narrative: { inventory_agent: "Looked at stock." },
  trace: { inventory_agent: [{ name: "get_low_stock_products", arguments: {}, is_mutating: false }] },
};

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getOnboardingProgress).mockResolvedValue({ steps: [], current_step: null, intro_video_seen: true, total_steps: 10, completed_steps: 10 });
  vi.mocked(api.getSalesSummary).mockResolvedValue({ revenue: 13655, orders: 53, top_products: [] } as never);
  vi.mocked(api.getLowStockProducts).mockResolvedValue([{}, {}, {}] as never);
  vi.mocked(api.getCustomerActivity).mockResolvedValue([{ inactive: true }, { inactive: false }] as never);
  vi.mocked(api.listProposals).mockResolvedValue([]);
  vi.mocked(api.getLatestActionPlan).mockResolvedValue(null as never);
});

describe("Command Center", () => {
  it("shows real numbers, findings as insight cards with their evidence, and keeps the Guide's controls and labels", async () => {
    vi.mocked(api.getLatestStoreHealth).mockResolvedValue(report as never);
    renderPage();

    await waitFor(() => expect(screen.getByText("$13,655")).toBeInTheDocument());
    expect(screen.getByText("Avg order $258")).toBeInTheDocument();
    expect(screen.getByText("3 products at or below their threshold.")).toBeInTheDocument();
    expect(screen.getByText("get_low_stock_products")).toBeInTheDocument(); // evidence = the agent's real tool call
    expect(screen.getByText("Suggested: Reorder stock.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("1 thing needs you.");

    // The two controls the NOVA Guide's run_business lesson targets, with their exact labels.
    expect(document.querySelector('[data-nova-target="store_health.check"]')).toHaveTextContent("Refresh");
    expect(document.querySelector('[data-nova-target="store_health.fix"]')).toHaveTextContent("Fix what you can");
  });

  it("before any review exists, invites one and offers 'How is my store doing?'", async () => {
    vi.mocked(api.getLatestStoreHealth).mockResolvedValue(null as never);
    renderPage();
    await waitFor(() => expect(screen.getByText("No Store Health review yet")).toBeInTheDocument());
    expect(document.querySelector('[data-nova-target="store_health.check"]')).toHaveTextContent("How is my store doing?");
    expect(document.querySelector('[data-nova-target="store_health.fix"]')).toBeNull(); // only after a report exists
  });

  it("lists pending approvals as proposed items and sends the human to Approvals to decide (no approving here)", async () => {
    vi.mocked(api.getLatestStoreHealth).mockResolvedValue(report as never);
    vi.mocked(api.listProposals).mockResolvedValue([
      { id: "p1", tool_name: "draft_campaign", arguments: {}, risk_classification: "high", status: "proposed" },
    ] as never);
    renderPage();
    await waitFor(() => expect(screen.getByText("Marketing — campaign draft")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Review in Approvals" })).toHaveAttribute("href", "/approvals");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("only shows the Create My Store prompt while onboarding is incomplete", async () => {
    vi.mocked(api.getLatestStoreHealth).mockResolvedValue(null as never);
    vi.mocked(api.getOnboardingProgress).mockResolvedValue({ steps: [], current_step: "brand", intro_video_seen: true, total_steps: 10, completed_steps: 0 });
    renderPage();
    await waitFor(() => expect(screen.getByRole("link", { name: "Start" })).toHaveAttribute("href", "/create-store"));
  });
});
