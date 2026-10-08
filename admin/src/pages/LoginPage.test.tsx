import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
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
});
