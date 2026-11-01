import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { Button, LabeledInput } from "../components/ui";
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
      <div className="w-full max-w-sm rounded-xl border border-line bg-raised p-7 shadow-elev-2">
        <div className="mb-6 flex items-center gap-2.5">
          <span aria-hidden className="h-3 w-3 rounded-full bg-corona shadow-glow" />
          <span className="text-lg font-semibold tracking-tight">NOVA</span>
        </div>
        <h1 className="mb-1 font-display text-3xl leading-tight tracking-[-0.015em]">
          Create your <span className="italic text-corona">NOVA account</span>
        </h1>
        <p className="mb-6 text-sm text-fg-2">One account, one store — let's get started.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <LabeledInput id="org_name" label="Brand / store name" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Aurora Goods" required />
          <LabeledInput id="full_name" label="Your name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
          <LabeledInput id="email" label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          <LabeledInput
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            hint="At least 8 characters."
            required
          />
          {error && <p role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Creating your account…" : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-fg-3">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-fg-2 underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
