import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { PRODUCT_FILM_POSTER_URL, PRODUCT_FILM_URL } from "../lib/demo";
import { usePrefersReducedMotion } from "../lib/useFilmMedia";

// The public entry point is just this: an intro video, a Skip in the bottom-right corner, then
// straight to the login page. No "Watch NOVA", "Create my store", or "View the demo" choices —
// there is nothing to choose here. Signing up still exists (the login page links to it), it's
// just not offered as a competing button on this screen.
//
// The film is a brand/vision film with illustrative UI, and says so on screen. It is muted and
// inline so it can autoplay everywhere (Safari/iOS included); with reduced motion, or if the browser
// refuses to autoplay, the poster (the film's end card) shows instead with an "Explore NOVA" button.
export default function LandingPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [muted, setMuted] = useState(true);
  const [playBlocked, setPlayBlocked] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const showVideo = !!PRODUCT_FILM_URL && !reducedMotion;

  useEffect(() => {
    // `autoPlay` alone can be refused (iOS Low Power Mode, strict autoplay policies): the promise tells us.
    videoRef.current?.play?.()?.catch(() => setPlayBlocked(true));
  }, [showVideo]);

  if (isAuthenticated) return <Navigate to="/overview" replace />;

  function goToLogin() {
    navigate("/login");
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-black">
      {showVideo ? (
        <video
          ref={videoRef}
          src={PRODUCT_FILM_URL}
          poster={PRODUCT_FILM_POSTER_URL}
          aria-label="NOVA vision film"
          autoPlay
          muted={muted}
          playsInline
          preload="auto"
          onEnded={goToLogin}
          onError={goToLogin}
          className="h-screen w-full object-contain"
        />
      ) : PRODUCT_FILM_URL ? (
        <img src={PRODUCT_FILM_POSTER_URL} alt="NOVA — built for what's next" className="h-screen w-full object-contain" />
      ) : (
        <div className="flex aspect-video w-full max-w-3xl flex-col items-center justify-center gap-2 rounded-md bg-neutral-900 text-center">
          <p className="text-sm font-medium text-white">NOVA</p>
          <p className="max-w-sm px-6 text-xs text-neutral-400">
            Set VITE_PRODUCT_FILM_URL to point this slot at a real video — no code change needed.
          </p>
        </div>
      )}

      {showVideo && (
        <button
          onClick={() => {
            const next = !muted;
            setMuted(next);
            if (videoRef.current) videoRef.current.muted = next;
          }}
          className="absolute bottom-6 left-6 rounded-md border border-white/30 bg-black/50 px-3 py-1.5 text-xs text-white backdrop-blur hover:bg-black/70"
        >
          {muted ? "Unmute" : "Mute"}
        </button>
      )}

      {PRODUCT_FILM_URL && (
        <p className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center px-6 sm:bottom-7">
          <span className="rounded-full bg-black/55 px-3 py-1 text-center text-[11px] text-white/80 backdrop-blur">
            Vision film — the interface shown is illustrative, not a promise that every capability is live today.
          </span>
        </p>
      )}

      {(reducedMotion || playBlocked) && (
        <button
          onClick={goToLogin}
          className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-md bg-corona px-5 py-2.5 text-sm font-medium text-white shadow-glow hover:opacity-90 sm:bottom-20"
        >
          Explore NOVA
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
