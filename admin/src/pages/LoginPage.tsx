import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { Button, LabeledInput } from "../components/ui";
import { useAuth } from "../lib/auth";
import { DEMO_CREDENTIALS, PRODUCT_FILM_POSTER_URL, PRODUCT_FILM_URL } from "../lib/demo";
import { usePrefersReducedMotion, useSmallOrSavingData } from "../lib/useFilmMedia";

export default function LoginPage() {
  const { login, enterDemo } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(DEMO_CREDENTIALS.email);
  const [password, setPassword] = useState(DEMO_CREDENTIALS.password);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Decorative film behind the form: the same file the landing page already fetched (so the browser
  // cache serves it), muted and looping. Phones, Data Saver and reduced motion get the still poster;
  // a video that errors falls back to the poster, and the form never depends on either.
  const [mounted, setMounted] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const stillOnly = usePrefersReducedMotion() || useSmallOrSavingData();
  useEffect(() => setMounted(true), []);
  const showVideo = mounted && !stillOnly && !videoFailed && !!PRODUCT_FILM_URL;

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black px-4">
      {PRODUCT_FILM_URL && (
        <div aria-hidden className="absolute inset-0">
          {showVideo ? (
            <video
              src={PRODUCT_FILM_URL}
              poster={PRODUCT_FILM_POSTER_URL}
              autoPlay
              muted
              loop
              playsInline
              tabIndex={-1}
              onError={() => setVideoFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <img src={PRODUCT_FILM_POSTER_URL} alt="" className="h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-br from-black/85 via-black/65 to-black/85" />
        </div>
      )}
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-line bg-raised p-7 shadow-elev-2">
        <div className="mb-6 flex items-center gap-2.5">
          <span aria-hidden className="h-3 w-3 rounded-full bg-corona shadow-glow" />
          <h1 className="text-lg font-semibold tracking-tight">NOVA</h1>
        </div>
        <p className="mb-6 font-display text-3xl leading-tight tracking-[-0.015em]">
          Sign in to <span className="italic text-corona">your store.</span>
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <LabeledInput id="email" label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <LabeledInput id="password" label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          {error && <p role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-fg-3">
          New to NOVA?{" "}
          <Link to="/signup" className="font-medium text-fg-2 underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
