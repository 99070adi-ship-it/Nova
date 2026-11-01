import clsx from "clsx";
import type { ReactNode } from "react";

/** Status chip: a dot plus a label, so state is never carried by colour alone. `proposed` is dashed
 * (nothing has changed yet); `applied` / `verified` are solid. Use `ai` sparingly. */
export type BadgeTone = "success" | "warning" | "danger" | "info" | "proposed" | "neutral" | "ai" | "verified";

const TONE: Record<BadgeTone, string> = {
  success: "bg-ok-soft text-ok border-ok/60",
  warning: "bg-warn-soft text-warn border-warn/60",
  danger: "bg-bad-soft text-bad border-bad/60",
  info: "bg-info-soft text-info border-info/60",
  proposed: "bg-corona-soft text-corona-ink border-corona border-dashed",
  neutral: "bg-sunken text-fg-2 border-line-strong",
  ai: "bg-corona text-corona-on border-corona",
  verified: "bg-ok text-white border-ok",
};

export default function Badge({
  tone = "neutral",
  children,
  dot = true,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium",
        dot && "pl-2",
        TONE[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
