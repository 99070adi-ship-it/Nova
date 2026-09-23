import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Link } from "react-router-dom";
import { createActionPlan, getStoreHealth, type ActionPlan, type StoreHealthReport } from "../api/client";
import { useAuth } from "../lib/auth";

const STATUS_COLOR: Record<string, string> = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-700",
  watch: "border-amber-200 bg-amber-50 text-amber-700",
  at_risk: "border-red-200 bg-red-50 text-red-700",
};

export default function OverviewPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const healthMutation = useMutation<StoreHealthReport, Error, void>({ mutationFn: getStoreHealth });
  const actionPlanMutation = useMutation<ActionPlan, Error, void>({
    mutationFn: createActionPlan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const report = healthMutation.data;

  return (
    <div>
      <h1 className="text-xl font-semibold">Overview</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Signed in as <span className="font-medium text-neutral-700">{user?.full_name}</span> ({user?.role}).
      </p>

      <div className="mt-6 max-w-md rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-sm font-semibold">Create My Store</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Tell NOVA about your brand and products — it turns raw input into a working store.
        </p>
        <Link to="/create-store" className="mt-4 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
          Start
        </Link>
      </div>

      <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Store Health</h2>
            <p className="mt-1 text-sm text-neutral-500">
              Store Manager delegates to Sales, Inventory, Customer, and Storefront agents for a real read on how the store is doing.
            </p>
          </div>
          <button
            onClick={() => healthMutation.mutate()}
            disabled={healthMutation.isPending}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {healthMutation.isPending ? "Checking…" : "How is my store doing?"}
          </button>
        </div>

        {healthMutation.isError && <p className="mt-3 text-sm text-red-600">{healthMutation.error.message}</p>}

        {report && (
          <div className="mt-4">
            <div className="space-y-2">
              {report.findings.map((f) => (
                <div key={`${f.category}-${f.metric}`} className="rounded-md border border-neutral-100 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs uppercase tracking-wide text-neutral-400">{f.category}</span>
                      <span className={clsx("rounded border px-1.5 py-0.5 text-[11px]", STATUS_COLOR[f.status])}>{f.status}</span>
                    </div>
                    <span className="text-[11px] text-neutral-400">{f.severity} severity</span>
                  </div>
                  <p className="mt-1 text-sm">{f.finding}</p>
                  {f.suggested_action && <p className="mt-1 text-xs text-neutral-500">Suggested: {f.suggested_action}</p>}
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-4">
              <p className="text-sm text-neutral-500">
                Auto-fix low-risk issues now; anything sensitive goes to Approvals for review.
              </p>
              <button
                onClick={() => actionPlanMutation.mutate()}
                disabled={actionPlanMutation.isPending}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {actionPlanMutation.isPending ? "Working…" : "Fix what you can"}
              </button>
            </div>

            {actionPlanMutation.isError && <p className="mt-3 text-sm text-red-600">{actionPlanMutation.error.message}</p>}

            {actionPlanMutation.data && (
              <div className="mt-4 space-y-1">
                {actionPlanMutation.data.items.map((item) => (
                  <div key={item.proposal_id} className="flex items-center justify-between rounded-md border border-neutral-100 px-3 py-2 text-sm">
                    <span>{item.description}</span>
                    <span
                      className={clsx(
                        "rounded border px-1.5 py-0.5 text-[11px]",
                        item.status === "executed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700",
                      )}
                    >
                      {item.status === "executed" ? "done (auto)" : "awaiting approval"}
                    </span>
                  </div>
                ))}
                {actionPlanMutation.data.items.length === 0 && (
                  <p className="text-sm text-neutral-400">Nothing to fix — no real fixable issues found.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
