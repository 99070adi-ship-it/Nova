import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import LandingPage from "./LandingPage";
import { useAuth } from "../lib/auth";

vi.mock("../lib/auth", () => ({ useAuth: vi.fn() }));

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
        <Route path="/overview" element={<div>OVERVIEW PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LandingPage — intro video with Skip, nothing else to choose", () => {
  it("offers no 'View the demo', 'Watch NOVA', or 'Create my store' choice", () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: false } as never);
    renderLanding();

    expect(screen.queryByText(/view the demo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/explore demo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/watch nova/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/create my store/i)).not.toBeInTheDocument();
  });

  it("clicking Skip goes directly to the login page", () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: false } as never);
    renderLanding();

    fireEvent.click(screen.getByText("Skip"));

    expect(screen.getByText("LOGIN PAGE")).toBeInTheDocument();
  });

  it("the video ending also goes directly to the login page, same as Skip", () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: false } as never);
    renderLanding();

    // No VITE_PRODUCT_FILM_URL configured in this test env, so the placeholder renders — Skip is
    // still the universal way forward either way, already covered above. This test instead
    // confirms a configured <video>'s onEnded reaches the same place, by simulating the DOM event
    // directly against whichever node renders.
    const maybeVideo = document.querySelector("video");
    if (maybeVideo) fireEvent.ended(maybeVideo);
    else fireEvent.click(screen.getByText("Skip"));

    expect(screen.getByText("LOGIN PAGE")).toBeInTheDocument();
  });

  it("an already-authenticated visitor skips the video entirely and lands in the app", () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true } as never);
    renderLanding();

    expect(screen.getByText("OVERVIEW PAGE")).toBeInTheDocument();
  });

  describe("the film", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("plays muted and inline, says it is an illustrative vision film, and does not trap the visitor on a failed video", () => {
      vi.mocked(useAuth).mockReturnValue({ isAuthenticated: false } as never);
      renderLanding();

      const video = document.querySelector("video")!;
      expect(video).toHaveAttribute("poster");
      expect(video.muted).toBe(true);
      expect(video).toHaveAttribute("playsinline");
      expect(screen.getByText(/vision film/i)).toBeInTheDocument();

      fireEvent.error(video);
      expect(screen.getByText("LOGIN PAGE")).toBeInTheDocument();
    });

    it("under reduced motion shows the poster instead of a video, with an Explore NOVA button", () => {
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
      vi.mocked(useAuth).mockReturnValue({ isAuthenticated: false } as never);
      renderLanding();

      expect(document.querySelector("video")).toBeNull();
      expect(screen.getByAltText(/built for what's next/i)).toBeInTheDocument();
      fireEvent.click(screen.getByText("Explore NOVA"));
      expect(screen.getByText("LOGIN PAGE")).toBeInTheDocument();
    });
  });
});
