import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { approveProposal, listProposals, rejectProposal, type ToolProposal } from "../api/client";

const STATUS_COLOR: Record<string, string> = {
  proposed: "bg-amber-50 text-amber-700 border-amber-200",
  executed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-neutral-100 text-neutral-500 border-neutral-200",
  execution_failed: "bg-red-50 text-red-700 border-red-200",
  stale: "bg-red-50 text-red-700 border-red-200",
  expired: "bg-neutral-100 text-neutral-500 border-neutral-200",
};

const TOOL_LABEL: Record<string, string> = {
  draft_campaign: "Marketing — campaign draft",
  cancel_order: "Operations — cancel order",
  update_product_content: "Product — content update",
  publish_storefront: "Storefront — publish",
};

// Marketing Agent's draft_campaign and Operations Agent's cancel_order get the same readable
// treatment Product/Storefront Agent proposals already have elsewhere (field badges, Change Plan
// descriptions) — a human reviewing Approvals shouldn't have to read raw tool-call JSON to
// understand what they're approving. Anything else still falls back to the JSON dump below.
function ProposalBody({ proposal }: { proposal: ToolProposal }) {
  if (proposal.tool_name === "draft_campaign") {
    const { goal, target_segment, campaign_copy } = proposal.arguments as {
      goal?: string;
      target_segment?: string;
      campaign_copy?: string;
    };
    return (
      <div className="mt-2 max-w-xl space-y-1.5 text-sm">
        <p>
          <span className="text-neutral-400">Goal:</span> {goal}
        </p>
        <p>
          <span className="text-neutral-400">Target:</span> {target_segment}
        </p>
        <p className="rounded-md bg-neutral-50 p-2 text-neutral-700">{campaign_copy}</p>
        <p className="text-[11px] text-neutral-400">Drafting only — nothing is sent to customers.</p>
      </div>
    );
  }

  if (proposal.tool_name === "cancel_order") {
    const { order_id, reason } = proposal.arguments as { order_id?: string; reason?: string };
    return (
      <div className="mt-2 max-w-xl space-y-1 text-sm">
        <p>
          <span className="text-neutral-400">Order:</span> <span className="font-mono text-xs">{order_id?.slice(0, 8)}</span>
        </p>
        <p>
          <span className="text-neutral-400">Reason:</span> {reason}
        </p>
      </div>
    );
  }

  return <pre className="mt-1 max-w-xl overflow-x-auto text-xs text-neutral-500">{JSON.stringify(proposal.arguments, null, 0)}</pre>;
}

export default function ApprovalsPage() {
  const queryClient = useQueryClient();
  const { data: proposals, isLoading } = useQuery({ queryKey: ["proposals"], queryFn: () => listProposals() });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["proposals"] });
    queryClient.invalidateQueries({ queryKey: ["activity"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["storefront-draft"] });
  };

  const approveMutation = useMutation({ mutationFn: approveProposal, onSuccess: invalidate });
  const rejectMutation = useMutation({ mutationFn: (id: string) => rejectProposal(id), onSuccess: invalidate });

  const pending = proposals?.filter((p) => p.status === "proposed") ?? [];
  const resolved = proposals?.filter((p) => p.status !== "proposed") ?? [];

  return (
    <div>
      <h1 className="text-xl font-semibold">Approvals</h1>
      <p className="mt-1 text-sm text-neutral-500">Sensitive AI actions wait here until a human approves them.</p>

      {isLoading && <p className="mt-4 text-sm text-neutral-400">Loading…</p>}

      <div className="mt-4 space-y-2">
        {pending.map((p) => (
          <div key={p.id} className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{TOOL_LABEL[p.tool_name] ?? p.tool_name}</span>
                  <span className={clsx("rounded border px-1.5 py-0.5 text-[11px]", p.risk_classification === "high" ? "border-red-200 bg-red-50 text-red-700" : "border-neutral-200 bg-neutral-50 text-neutral-600")}>
                    {p.risk_classification} risk
                  </span>
                </div>
                <ProposalBody proposal={p} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => approveMutation.mutate(p.id)} className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white">
                  Approve
                </button>
                <button onClick={() => rejectMutation.mutate(p.id)} className="rounded-md border border-neutral-300 px-3 py-1 text-xs">
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
        {pending.length === 0 && !isLoading && <p className="text-sm text-neutral-400">No pending approvals.</p>}
      </div>

      {resolved.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-neutral-500">Resolved</h2>
          <div className="mt-2 space-y-1">
            {resolved.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-md border border-neutral-100 px-3 py-2 text-sm">
                <span>{TOOL_LABEL[p.tool_name] ?? p.tool_name}</span>
                <span className={clsx("rounded border px-1.5 py-0.5 text-[11px]", STATUS_COLOR[p.status])}>{p.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
