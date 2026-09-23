import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { approveProposal, listProposals, rejectProposal } from "../api/client";

const STATUS_COLOR: Record<string, string> = {
  proposed: "bg-amber-50 text-amber-700 border-amber-200",
  executed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-neutral-100 text-neutral-500 border-neutral-200",
  execution_failed: "bg-red-50 text-red-700 border-red-200",
  stale: "bg-red-50 text-red-700 border-red-200",
  expired: "bg-neutral-100 text-neutral-500 border-neutral-200",
};

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
                  <span className="font-medium">{p.tool_name}</span>
                  <span className={clsx("rounded border px-1.5 py-0.5 text-[11px]", p.risk_classification === "high" ? "border-red-200 bg-red-50 text-red-700" : "border-neutral-200 bg-neutral-50 text-neutral-600")}>
                    {p.risk_classification} risk
                  </span>
                </div>
                <pre className="mt-1 max-w-xl overflow-x-auto text-xs text-neutral-500">{JSON.stringify(p.arguments, null, 0)}</pre>
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
                <span>{p.tool_name}</span>
                <span className={clsx("rounded border px-1.5 py-0.5 text-[11px]", STATUS_COLOR[p.status])}>{p.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
