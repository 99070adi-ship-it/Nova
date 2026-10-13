import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../lib/auth";
import { DEMO_CREDENTIALS } from "../lib/demo";

export default function LoginPage() {
  const { login, enterDemo } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(DEMO_CREDENTIALS.email);
  const [password, setPassword] = useState(DEMO_CREDENTIALS.password);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // The prefilled demo credentials, submitted unmodified, go through the dedicated
      // reset-to-blank demo entry (backend/app/services/demo_service.py::reset_to_blank_demo)
      // instead of plain login — this is what guarantees the account exists at all on a fresh
      // deployment, and that every demo sign-in replays the full setup experience from scratch,
      // same as the request behind this: "every time someone logs in with it, it shows the whole
      // demo flow." Any other email/password still goes through ordinary login, unchanged.
      if (email === DEMO_CREDENTIALS.email && password === DEMO_CREDENTIALS.password) {
        await enterDemo();
      } else {
        await login(email, password);
      }
      navigate("/overview", { state: { beginTour: true } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold">NOVA</h1>
        <p className="mb-6 text-sm text-neutral-500">Sign in to your store</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              autoComplete="current-password"
            />
          </div>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-neutral-400">
          New to NOVA?{" "}
          <Link to="/signup" className="font-medium text-neutral-600 underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
