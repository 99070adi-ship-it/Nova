import clsx from "clsx";
import type { ReactNode } from "react";
import Badge, { type BadgeTone } from "./Badge";
import Button from "./Button";

/** The lifecycle of an AI proposal. The same card keeps its identity as it moves along it. */
export type ProposalStage = "proposed" | "approved" | "executing" | "applied" | "verified" | "rejected" | "failed";

const STAGE_BADGE: Record<ProposalStage, { tone: BadgeTone; label: string }> = {
  proposed: { tone: "proposed", label: "Proposed" },
  approved: { tone: "info", label: "Approved" },
  executing: { tone: "warning", label: "Executing" },
  applied: { tone: "success", label: "Applied" },
  verified: { tone: "verified", label: "Verified" },
  rejected: { tone: "neutral", label: "Rejected" },
  failed: { tone: "danger", label: "Failed" },
};
const STAGE_BORDER: Record<ProposalStage, string> = {
  proposed: "border-corona border-dashed",
  approved: "border-info",
  executing: "border-warn",
  applied: "border-ok",
  verified: "border-ok",
  rejected: "border-line-strong",
  failed: "border-bad",
};

export function StageBadge({ stage, label }: { stage: ProposalStage; label?: string }) {
  const b = STAGE_BADGE[stage];
  return <Badge tone={b.tone}>{label ?? b.label}</Badge>;
}

/** A proposal is visibly not-yet-real while `proposed`: dashed Corona border and a "nothing has
 * changed" line. `children` is the readable diff/body; `actions` is usually an ApprovalBar. */
export function ProposalCard({
  stage,
  kicker,
  title,
  children,
  note,
  actions,
  className,
}: {
  stage: ProposalStage;
  kicker?: string;
  title: ReactNode;
  children?: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col gap-3.5 rounded-xl border-[1.5px] bg-raised p-5 transition-colors duration-standard ease-settle", STAGE_BORDER[stage], className)}>
      <div className="flex flex-wrap items-center gap-2">
        <StageBadge stage={stage} />
        {kicker && <span className="eyebrow">{kicker}</span>}
      </div>
      <h3 className="text-[17px] font-semibold tracking-tight text-fg">{title}</h3>
      {children}
      {stage === "proposed" && !note && <p className="text-xs text-fg-3">Nothing has changed yet. Approving runs this once and records it in Activity.</p>}
      {note && <div className="text-xs text-fg-3">{note}</div>}
      {actions}
    </div>
  );
}

/** Label / value rows for a proposal's readable "what exactly will happen". */
export function DiffRows({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="overflow-hidden rounded-md bg-sunken">
      {rows.map((r, i) => (
        <div key={r.label} className={clsx("grid grid-cols-[84px_1fr] gap-3 px-3.5 py-2.5 text-[13px]", i > 0 && "border-t border-line")}>
          <dt className="eyebrow pt-0.5">{r.label}</dt>
          <dd className="min-w-0 break-words text-fg">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The only place a human decision is made. Approve is ink (never Corona) and never autofocused. */
export function ApprovalBar({
  onApprove,
  onReject,
  pending,
  approveLabel = "Approve",
  rejectLabel = "Reject",
  disabled,
}: {
  onApprove: () => void;
  onReject: () => void;
  pending?: boolean;
  approveLabel?: string;
  rejectLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-line-strong bg-raised px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-fg">Needs your approval</p>
        <p className="text-xs text-fg-3">You decide. Nothing runs until you approve.</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="secondary" onClick={onReject} disabled={disabled || pending}>
          {rejectLabel}
        </Button>
        <Button size="sm" variant="primary" onClick={onApprove} disabled={disabled || pending}>
          {approveLabel}
        </Button>
      </div>
    </div>
  );
}
