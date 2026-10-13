import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../lib/auth";

export default function SignupPage() {
  const { isAuthenticated, loading, signup } = useAuth();
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && isAuthenticated) return <Navigate to="/overview" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup({ org_name: orgName, full_name: fullName, email, password });
      navigate("/overview", { state: { beginTour: true } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create your account");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold">Create your NOVA account</h1>
        <p className="mb-6 text-sm text-neutral-500">One account, one store — let's get started.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="org_name">
              Brand / store name
            </label>
            <input
              id="org_name"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="e.g. Aurora Goods"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="full_name">
              Your name
            </label>
            <input
              id="full_name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              autoComplete="name"
              required
            />
          </div>
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
              required
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
              autoComplete="new-password"
              minLength={8}
              required
            />
            <p className="mt-1 text-xs text-neutral-400">At least 8 characters.</p>
          </div>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {submitting ? "Creating your account…" : "Create account"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-neutral-400">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-neutral-600 underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
