import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";
import { useAuth } from "../lib/auth";
import { DEMO_CREDENTIALS } from "../lib/demo";

vi.mock("../lib/auth", () => ({ useAuth: vi.fn() }));

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/overview" element={<div>OVERVIEW PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LoginPage — demo credentials prefilled, real login form otherwise", () => {
  it("prefills the email/password fields with the demo credentials", () => {
    vi.mocked(useAuth).mockReturnValue({ login: vi.fn(), enterDemo: vi.fn() } as never);
    renderLogin();

    expect(screen.getByLabelText("Email")).toHaveValue(DEMO_CREDENTIALS.email);
    expect(screen.getByLabelText("Password")).toHaveValue(DEMO_CREDENTIALS.password);
  });

  it("submitting the unmodified prefilled credentials goes through the reset-to-blank demo entry, not plain login", async () => {
    const login = vi.fn();
    const enterDemo = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({ login, enterDemo } as never);
    renderLogin();

    fireEvent.click(screen.getByText("Sign in"));

    await waitFor(() => expect(screen.getByText("OVERVIEW PAGE")).toBeInTheDocument());
    expect(enterDemo).toHaveBeenCalledTimes(1);
    expect(login).not.toHaveBeenCalled();
  });

  it("a real, different email/password still goes through ordinary login", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    const enterDemo = vi.fn();
    vi.mocked(useAuth).mockReturnValue({ login, enterDemo } as never);
    renderLogin();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "real.owner@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-real-password" } });
    fireEvent.click(screen.getByText("Sign in"));

    await waitFor(() => expect(screen.getByText("OVERVIEW PAGE")).toBeInTheDocument());
    expect(login).toHaveBeenCalledWith("real.owner@example.com", "a-real-password");
    expect(enterDemo).not.toHaveBeenCalled();
  });

  describe("background film", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("is decorative: muted, looping, hidden from assistive tech, and the form still works", () => {
      vi.mocked(useAuth).mockReturnValue({ login: vi.fn(), enterDemo: vi.fn() } as never);
      renderLogin();

      const video = document.querySelector("video")!;
      expect(video.muted).toBe(true);
      expect(video.loop).toBe(true);
      expect(video.closest("[aria-hidden='true']")).not.toBeNull();
      expect(screen.getByLabelText("Email")).toBeVisible();
    });

    it("falls back to the still poster when the video fails, without breaking the form", () => {
      vi.mocked(useAuth).mockReturnValue({ login: vi.fn(), enterDemo: vi.fn() } as never);
      renderLogin();

      fireEvent.error(document.querySelector("video")!);

      expect(document.querySelector("video")).toBeNull();
      expect(document.querySelector("img")).not.toBeNull();
      expect(screen.getByText("Sign in")).toBeInTheDocument();
    });

    it("uses only the still poster under reduced motion (no video download)", () => {
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
      vi.mocked(useAuth).mockReturnValue({ login: vi.fn(), enterDemo: vi.fn() } as never);
      renderLogin();

      expect(document.querySelector("video")).toBeNull();
      expect(document.querySelector("img")).not.toBeNull();
    });

    it("uses only the still poster on phone-sized screens", () => {
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width"), addEventListener() {}, removeEventListener() {} }));
      vi.mocked(useAuth).mockReturnValue({ login: vi.fn(), enterDemo: vi.fn() } as never);
      renderLogin();

      expect(document.querySelector("video")).toBeNull();
    });
  });
});
