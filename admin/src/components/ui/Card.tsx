import clsx from "clsx";
import type { HTMLAttributes, ReactNode } from "react";

/** Raised surface + hairline. No shadow at rest: shadow is reserved for things that float. */
export function Card({ className, padded = true, ...rest }: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return <div className={clsx("rounded-lg border border-line bg-raised", padded && "p-5", className)} {...rest} />;
}

/** One headline number with a mono, tabular figure. `hint` is the small line beneath it. */
export function StatTile({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <Card className={clsx("flex flex-col gap-2", className)}>
      <p className="eyebrow">{label}</p>
      <p className="text-[32px] font-medium leading-none tracking-tight tabular-nums text-fg">{value}</p>
      {hint && <div className="text-xs text-fg-3">{hint}</div>}
    </Card>
  );
}

/** What NOVA found: severity, which agent, the claim, the evidence behind it, then the next action. */
export function InsightCard({
  badge,
  source,
  title,
  body,
  evidence,
  actions,
  className,
}: {
  badge: ReactNode;
  source?: string;
  title: string;
  body?: ReactNode;
  evidence?: { label?: string; text: string } | null;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={clsx("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {badge}
        {source && <span className="eyebrow">{source}</span>}
      </div>
      <h3 className="text-base font-semibold tracking-tight text-fg">{title}</h3>
      {body && <div className="text-sm leading-relaxed text-fg-2">{body}</div>}
      {evidence && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md bg-sunken px-3 py-2">
          <span className="font-mono text-[10.5px] font-medium uppercase tracking-label text-corona-ink">{evidence.label ?? "Evidence"}</span>
          <span className="font-mono text-xs text-fg-2">{evidence.text}</span>
        </div>
      )}
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </Card>
  );
}
