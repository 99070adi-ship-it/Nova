import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseRoutes, mockApi, renderApp, storefront } from "../test/helpers";

vi.mock("../editor/protocol", async (original) => ({ ...(await original<typeof import("../editor/protocol")>()), insideBuilder: vi.fn() }));
import { insideBuilder } from "../editor/protocol";

afterEach(() => vi.unstubAllGlobals());
const ID = "66666666-6666-4666-8666-666666666666";

const routes = () => ({ ...baseRoutes(), [`/preview/${ID}`]: storefront(), [`POST /preview/${ID}/loaded`]: { status: 204, body: null } });

describe("the onboarding 'preview loaded' event", () => {
  it("is recorded for a preview the owner opens on its own", async () => {
    vi.mocked(insideBuilder).mockReturnValue(false);
    const api = mockApi(routes());
    renderApp(`/?preview=${ID}`);
    await screen.findByText("Quiet leather");
    await waitFor(() => expect(api.calls.some((c) => c.url.endsWith(`/preview/${ID}/loaded`))).toBe(true));
    expect(screen.getByText(/Preview — draft, not live/)).toBeInTheDocument();
  });

  it("is NOT recorded by Store Builder's embedded editing emulator (and the storefront's own banner steps aside)", async () => {
    vi.mocked(insideBuilder).mockReturnValue(true);
    const api = mockApi(routes());
    renderApp(`/?preview=${ID}&editor=1`);
    await screen.findByText("Quiet leather");
    await new Promise((r) => setTimeout(r, 300));
    expect(api.calls.some((c) => c.url.endsWith("/loaded"))).toBe(false);
    expect(screen.queryByText(/Preview — draft, not live/)).not.toBeInTheDocument();
  });
});
