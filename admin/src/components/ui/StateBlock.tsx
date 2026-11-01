import clsx from "clsx";
import type { ReactNode } from "react";
import Button from "./Button";

function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("flex flex-col items-start gap-3 rounded-lg border border-line bg-raised p-6", className)}>{children}</div>;
}

/** Nothing here yet — say what will appear and how to get the first one. */
export function EmptyState({ title, body, action, className }: { title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <Frame className={className}>
      <span aria-hidden className="h-8 w-8 rounded-full bg-corona-soft" />
      <p className="text-sm font-semibold text-fg">{title}</p>
      {body && <p className="max-w-prose text-sm text-fg-2">{body}</p>}
      {action}
    </Frame>
  );
}

/** Structure-matched skeleton plus one honest line about what is being read. */
export function LoadingState({ label = "Loading…", rows = 3, className }: { label?: string; rows?: number; className?: string }) {
  return (
    <Frame className={className}>
      <div role="status" aria-live="polite" className="flex w-full flex-col gap-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <span key={i} className="h-3 animate-pulse rounded-full bg-sunken" style={{ width: `${88 - i * 18}%` }} />
        ))}
        <span className="text-xs text-fg-3">{label}</span>
      </div>
    </Frame>
  );
}

/** What failed, what was NOT changed, one retry. */
export function ErrorState({ title, body, onRetry, className }: { title: string; body?: ReactNode; onRetry?: () => void; className?: string }) {
  return (
    <Frame className={clsx("border-bad/40", className)}>
      <p role="alert" className="text-sm font-semibold text-bad">{title}</p>
      {body && <p className="max-w-prose text-sm text-fg-2">{body}</p>}
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </Frame>
  );
}
