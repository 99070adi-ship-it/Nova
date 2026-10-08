import { useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { PRODUCT_FILM_URL } from "../lib/demo";

// The public entry point is just this: an intro video, a Skip in the bottom-right corner, then
// straight to the login page. No "Watch NOVA", "Create my store", or "View the demo" choices —
// there is nothing to choose here. Signing up still exists (the login page links to it), it's
// just not offered as a competing button on this screen.
export default function LandingPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  if (isAuthenticated) return <Navigate to="/overview" replace />;

  function goToLogin() {
    navigate("/login");
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-black">
      {PRODUCT_FILM_URL ? (
        <video
          ref={videoRef}
          src={PRODUCT_FILM_URL}
          autoPlay
          muted={muted}
          onEnded={goToLogin}
          onError={goToLogin}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex aspect-video w-full max-w-3xl flex-col items-center justify-center gap-2 rounded-md bg-neutral-900 text-center">
          <p className="text-sm font-medium text-white">NOVA</p>
          <p className="max-w-sm px-6 text-xs text-neutral-400">
            Set VITE_PRODUCT_FILM_URL to point this slot at a real video — no code change needed.
          </p>
        </div>
      )}

      {PRODUCT_FILM_URL && (
        <button
          onClick={() => {
            const next = !muted;
            setMuted(next);
            if (videoRef.current) videoRef.current.muted = next;
          }}
          className="absolute bottom-6 left-6 rounded-md border border-white/30 px-3 py-1.5 text-xs text-white hover:bg-white/10"
        >
          {muted ? "Unmute" : "Mute"}
        </button>
      )}

      <button
        onClick={goToLogin}
        className="absolute bottom-6 right-6 rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100"
      >
        Skip
      </button>
    </div>
  );
}
