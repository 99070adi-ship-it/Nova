import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  createActionPlan,
  getLatestActionPlan,
  getLatestStoreHealth,
  getStoreHealth,
  type ActionPlan,
  type StoreHealthReport,
} from "../api/client";
import { useAuth } from "../lib/auth";

const STATUS_COLOR: Record<string, string> = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-700",
  watch: "border-amber-200 bg-amber-50 text-amber-700",
  at_risk: "border-red-200 bg-red-50 text-red-700",
};

const PROPOSAL_STATUS_COLOR: Record<string, string> = {
  executed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  proposed: "border-amber-200 bg-amber-50 text-amber-700",
  rejected: "border-neutral-200 bg-neutral-100 text-neutral-500",
  execution_failed: "border-red-200 bg-red-50 text-red-700",
};

const AGENT_LABEL: Record<string, string> = {
  sales_agent: "Sales Agent",
  inventory_agent: "Inventory Agent",
  customer_agent: "Customer Agent",
};

// The point of Store Manager delegating to sub-agents (ARCHITECTURE.md "Store Manager
// orchestration UI") should be visible, not just their prose summaries — which real tool(s) each
// one actually called to back up what it's telling you.
function DelegationTrace({ report }: { report: StoreHealthReport }) {
  const [open, setOpen] = useState(false);
  const agentKeys = Object.keys(report.narrative);
  if (agentKeys.length === 0) return null;

  return (
    <div className="mt-4 border-t border-neutral-100 pt-4">
      <button onClick={() => setOpen((o) => !o)} className="text-xs font-medium text-neutral-500 hover:text-neutral-700">
        {open ? "Hide" : "Show"} delegation trace ({agentKeys.length} agents consulted)
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {agentKeys.map((key) => (
            <div key={key} className="rounded-md border border-neutral-100 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{AGENT_LABEL[key] ?? key}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {report.trace[key]?.map((call, i) => (
                  <span key={i} className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[11px] font-mono text-neutral-600">
                    {call.name}()
                  </span>
                ))}
              </div>
              <p className="mt-2 text-sm text-neutral-700">{report.narrative[key]}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OverviewPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // "Needs attention" reads whatever Store Health last found — no fresh multi-agent run (and no
  // LLM calls) just from loading this page. "How is my store doing?" below is the explicit
  // action that actually triggers a new one.
  const { data: latestReport, isLoading: latestLoading } = useQuery({
    queryKey: ["store-health-latest"],
    queryFn: getLatestStoreHealth,
  });

  const healthMutation = useMutation<StoreHealthReport, Error, void>({
    mutationFn: getStoreHealth,
    onSuccess: (result) => queryClient.setQueryData(["store-health-latest"], result),
  });
  // Review of the last action plan persists across visits too, with item statuses kept live
  // against Approvals rather than frozen at plan-creation time (see api/client.ts).
  const { data: latestPlan } = useQuery({ queryKey: ["action-plan-latest"], queryFn: getLatestActionPlan });

  const actionPlanMutation = useMutation<ActionPlan, Error, void>({
    mutationFn: createActionPlan,
    onSuccess: (result) => {
      queryClient.setQueryData(["action-plan-latest"], result);
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const report = healthMutation.data ?? latestReport ?? undefined;
  const plan = actionPlanMutation.data ?? latestPlan ?? undefined;

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
            data-nova-target="store_health.check"
            onClick={() => healthMutation.mutate()}
            disabled={healthMutation.isPending}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {healthMutation.isPending ? "Checking…" : report ? "Refresh" : "How is my store doing?"}
          </button>
        </div>

        {healthMutation.isError && <p className="mt-3 text-sm text-red-600">{healthMutation.error.message}</p>}

        {latestLoading && !report && <p className="mt-3 text-sm text-neutral-400">Loading…</p>}

        {report && (
          <div className="mt-4">
            <p className="text-xs text-neutral-400">
              As of {new Date(report.generated_at ?? Date.now()).toLocaleString()}
            </p>
            <div className="mt-2 space-y-2">
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

            <DelegationTrace report={report} />

            <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-4">
              <p className="text-sm text-neutral-500">
                Auto-fix low-risk issues now; anything sensitive goes to Approvals for review.
              </p>
              <button
                data-nova-target="store_health.fix"
                onClick={() => actionPlanMutation.mutate()}
                disabled={actionPlanMutation.isPending}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {actionPlanMutation.isPending ? "Working…" : plan ? "Fix what you can (again)" : "Fix what you can"}
              </button>
            </div>

            {actionPlanMutation.isError && <p className="mt-3 text-sm text-red-600">{actionPlanMutation.error.message}</p>}

            {plan && (
              <div className="mt-4">
                <p className="text-xs text-neutral-400">
                  Last action plan — {new Date(plan.generated_at ?? Date.now()).toLocaleString()}
                </p>
                <div className="mt-2 space-y-1">
                  {plan.items.map((item) => (
                    <div key={item.proposal_id} className="flex items-center justify-between rounded-md border border-neutral-100 px-3 py-2 text-sm">
                      <span>{item.description}</span>
                      <span
                        className={clsx(
                          "rounded border px-1.5 py-0.5 text-[11px]",
                          PROPOSAL_STATUS_COLOR[item.status] ?? "border-neutral-200 bg-neutral-50 text-neutral-600",
                        )}
                      >
                        {item.status === "executed" ? "done" : item.status === "proposed" ? "awaiting approval" : item.status}
                      </span>
                    </div>
                  ))}
                  {plan.items.length === 0 && (
                    <p className="text-sm text-neutral-400">Nothing to fix — no real fixable issues found.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
