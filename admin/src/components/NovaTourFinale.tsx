import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getOnboardingProgress, getStudioStatus } from "../api/client";
import { useAuth } from "../lib/auth";
import { Button } from "./ui";

/**
 * The closing screen of the guided tour: "That was NOVA", and what is actually available to use afterwards (Photo Studio
 * included). It appears once, at the moment the tour completes in this session (never on a page load where the tour was already
 * finished), and says honestly what each tool does. The tour's steps themselves are owned by the server and are not touched here.
 */
export default function NovaTourFinale() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { data: progress } = useQuery({ queryKey: ["onboarding-progress"], queryFn: getOnboardingProgress });
  const complete = !!progress && progress.total_steps > 0 && progress.completed_steps >= progress.total_steps && progress.current_step === null;
  const sawIncomplete = useRef(false);
  const [dismissed, setDismissed] = useState(false);
  if (progress && !complete) sawIncomplete.current = true;
  const show = complete && sawIncomplete.current && !dismissed;

  const { data: studio } = useQuery({ queryKey: ["studio-status"], queryFn: getStudioStatus, enabled: show });
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!show) return;
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDismissed(true);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  if (!show) return null;
  const demo = studio?.demo_workspace === true;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="finale-title" className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-inverse/80 p-4 backdrop-blur-sm">
      <div className="my-auto w-full max-w-2xl rounded-2xl border border-line bg-raised p-6 shadow-float md:p-8">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="h-3 w-3 rounded-full bg-corona shadow-glow" />
          <span className="text-sm font-semibold tracking-tight">NOVA</span>
        </div>
        <h2 id="finale-title" className="mt-4 font-display text-4xl leading-tight tracking-[-0.015em]">
          That was <span className="italic text-corona">NOVA.</span>
        </h2>
        <p className="mt-2 text-sm text-fg-2">You've just explored how NOVA works. Here is what you can use, now and next.</p>

        <ul className="mt-6 space-y-3">
          <li className="rounded-lg border border-corona/40 bg-corona-soft p-4">
            <p className="text-sm font-semibold">Photo Studio</p>
            <p className="mt-1 text-sm text-fg-2">
              Describe an image and NOVA creates it, or upload one and describe the change, then compare before and after and download the result.
            </p>
            <p className="mt-1.5 text-xs text-fg-3">
              {demo
                ? "Photo Studio runs real AI, so it works in your own account and not in this demo workspace."
                : "Generate and Edit are live. Enhance is coming soon."}
            </p>
          </li>
          <li className="rounded-lg border border-line p-4">
            <p className="text-sm font-semibold">Command Center and AI Workspace</p>
            <p className="mt-1 text-sm text-fg-2">Ask how your store is doing. NOVA reads your real numbers, and anything sensitive waits for your approval.</p>
          </li>
          <li className="rounded-lg border border-line p-4">
            <p className="text-sm font-semibold">Store Builder</p>
            <p className="mt-1 text-sm text-fg-2">Describe a change, review NOVA's plan, and publish when you're happy.</p>
          </li>
        </ul>

        <div className="mt-7 flex flex-wrap gap-2.5">
          {demo ? (
            <Button ref={primary} variant="ai" onClick={() => void logout().then(() => navigate("/signup"))}>
              Create an account
            </Button>
          ) : (
            <Button ref={primary} variant="ai" onClick={() => { setDismissed(true); navigate("/photo-studio"); }}>
              Open Photo Studio
            </Button>
          )}
          <Button variant="secondary" onClick={() => setDismissed(true)}>
            {demo ? "Keep exploring" : "Go to my workspace"}
          </Button>
        </div>
      </div>
    </div>
  );
}
