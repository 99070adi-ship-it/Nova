import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { approveProposal, listProposals, rejectProposal, type ToolProposal } from "../api/client";
import { ApprovalBar, Badge, DiffRows, EmptyState, LoadingState, ProposalCard, type BadgeTone } from "../components/ui";

const STATUS_TONE: Record<string, BadgeTone> = {
  proposed: "proposed",
  executed: "success",
  rejected: "neutral",
  execution_failed: "danger",
  stale: "danger",
  expired: "neutral",
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
      <DiffRows
        rows={[
          { label: "Goal", value: goal },
          { label: "Target", value: target_segment },
          { label: "Copy", value: campaign_copy },
          { label: "Sending", value: "Drafting only — nothing is sent to customers." },
        ]}
      />
    );
  }

  if (proposal.tool_name === "cancel_order") {
    const { order_id, reason } = proposal.arguments as { order_id?: string; reason?: string };
    return (
      <DiffRows
        rows={[
          { label: "Order", value: <span className="font-mono text-xs">{order_id?.slice(0, 8)}</span> },
          { label: "Reason", value: reason },
        ]}
      />
    );
  }

  return <pre className="max-w-full overflow-x-auto rounded-md bg-sunken p-3 font-mono text-xs text-fg-2">{JSON.stringify(proposal.arguments, null, 0)}</pre>;
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
    <div className="space-y-6">
      <header>
        <p className="eyebrow">NOVA · human in the loop</p>
        <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight">Approvals</h1>
        <p className="mt-1.5 text-sm text-fg-2">Sensitive AI actions wait here until a human approves them.</p>
      </header>

      {isLoading && <LoadingState label="Loading proposals…" rows={2} />}

      <div className="space-y-4">
        {pending.map((p) => (
          <ProposalCard
            key={p.id}
            stage="proposed"
            kicker={`${p.risk_classification} risk`}
            title={TOOL_LABEL[p.tool_name] ?? p.tool_name}
            actions={
              <ApprovalBar
                onApprove={() => approveMutation.mutate(p.id)}
                onReject={() => rejectMutation.mutate(p.id)}
                pending={approveMutation.isPending || rejectMutation.isPending}
              />
            }
          >
            <ProposalBody proposal={p} />
          </ProposalCard>
        ))}
        {pending.length === 0 && !isLoading && (
          <EmptyState
            title="No pending approvals"
            body="When NOVA finds something that needs a decision, it will appear here with exactly what it would do."
          />
        )}
      </div>

      {resolved.length > 0 && (
        <section className="pt-2">
          <h2 className="eyebrow">Resolved</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-raised">
            {resolved.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>{TOOL_LABEL[p.tool_name] ?? p.tool_name}</span>
                <Badge tone={STATUS_TONE[p.status] ?? "neutral"}>{p.status}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
