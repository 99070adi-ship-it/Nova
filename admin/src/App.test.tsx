import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App, { RequireAuth } from "./App";

vi.mock("./lib/auth", () => ({ useAuth: vi.fn() }));
// The real layout mounts the Guide, which would navigate for an in-progress step; this test is
// about the ROUTES themselves, so the layout is reduced to a bare outlet.
vi.mock("./components/AppLayout", () => ({ default: () => <Outlet /> }));

import { useAuth } from "./lib/auth";

function renderApp(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("routing — authentication is enforced; onboarding progress never blocks a route", () => {
  it("sends an unauthenticated visitor away from every app route", () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: false, user: null, loading: false } as never);
    renderApp("/marketing");
    expect(screen.queryByText(/Marketing/)).not.toBeInTheDocument();
  });

  it.each(["/marketing", "/settings"])(
    "%s renders directly for an authenticated user — there is no redirect to /create-store",
    async (path) => {
      vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, user: {}, loading: false } as never);
      renderApp(path);
      await waitFor(() => expect(screen.getByText(new RegExp(path.slice(1), "i"))).toBeInTheDocument());
    },
  );

  it("exports no onboarding gate component any more", async () => {
    const mod = await import("./App");
    expect(Object.keys(mod)).not.toContain("RequireOnboardingComplete");
    expect(RequireAuth).toBeTypeOf("function");
  });
});
