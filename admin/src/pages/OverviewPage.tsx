import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  createActionPlan,
  getCustomerActivity,
  getLatestActionPlan,
  getLatestStoreHealth,
  getLowStockProducts,
  getOnboardingProgress,
  getSalesSummary,
  getStoreHealth,
  listProposals,
  type ActionPlan,
  type StoreHealthFinding,
  type StoreHealthReport,
} from "../api/client";
import { useAuth } from "../lib/auth";
import {
  Badge,
  Button,
  buttonClass,
  Card,
  EmptyState,
  ErrorState,
  InsightCard,
  LoadingState,
  ProposalCard,
  StatTile,
  type BadgeTone,
} from "../components/ui";

// Command Center. Everything on this page is real data from endpoints that already exist: the
// analytics summaries, the latest Store Health report, the latest Action Plan and the pending
// proposals. Nothing here is decorative or simulated.

const STATUS_BADGE: Record<StoreHealthFinding["status"], { tone: BadgeTone; label: string }> = {
  at_risk: { tone: "danger", label: "At risk" },
  watch: { tone: "warning", label: "Watch" },
  good: { tone: "success", label: "Healthy" },
};

const PLAN_STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  executed: { tone: "success", label: "Done" },
  proposed: { tone: "proposed", label: "Awaiting approval" },
  rejected: { tone: "neutral", label: "Rejected" },
  execution_failed: { tone: "danger", label: "Failed" },
};

const AGENT_LABEL: Record<string, string> = {
  sales_agent: "Sales Agent",
  inventory_agent: "Inventory Agent",
  customer_agent: "Customer Agent",
};

// Which specialist produced a finding of each category (Store Manager delegates by domain).
const CATEGORY_AGENT: Record<string, string> = {
  sales: "sales_agent",
  inventory: "inventory_agent",
  customers: "customer_agent",
};

const TOOL_LABEL: Record<string, string> = {
  draft_campaign: "Marketing — campaign draft",
  cancel_order: "Operations — cancel order",
  update_product_content: "Product — content update",
  publish_storefront: "Storefront — publish",
};

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// The point of Store Manager delegating to sub-agents (ARCHITECTURE.md "Store Manager
// orchestration UI") should be visible, not just their prose summaries — which real tool(s) each
// one actually called to back up what it's telling you.
function DelegationTrace({ report }: { report: StoreHealthReport }) {
  const [open, setOpen] = useState(false);
  const agentKeys = Object.keys(report.narrative);
  if (agentKeys.length === 0) return null;

  return (
    <Card padded={false} className="overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-sunken/60"
      >
        <span className="text-[13px] font-medium text-fg">
          {open ? "Hide" : "Show"} delegation trace
        </span>
        <span className="text-xs text-fg-3">({agentKeys.length} agents consulted)</span>
      </button>
      {open && (
        <div className="divide-y divide-line border-t border-line">
          {agentKeys.map((key) => (
            <div key={key} className="space-y-2 px-4 py-3">
              <p className="eyebrow">{AGENT_LABEL[key] ?? key}</p>
              <div className="flex flex-wrap gap-1.5">
                {report.trace[key]?.map((call, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded border border-line bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-fg-2">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
                    {call.name}()
                  </span>
                ))}
              </div>
              <p className="text-sm text-fg-2">{report.narrative[key]}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Insight({ finding, report }: { finding: StoreHealthFinding; report: StoreHealthReport }) {
  const agentKey = CATEGORY_AGENT[finding.category];
  const tools = agentKey ? report.trace[agentKey]?.map((c) => c.name) ?? [] : [];
  const status = STATUS_BADGE[finding.status];
  return (
    <InsightCard
      badge={<Badge tone={status.tone}>{status.label}</Badge>}
      source={agentKey ? AGENT_LABEL[agentKey] : finding.category}
      title={finding.finding}
      body={finding.suggested_action ? <>Suggested: {finding.suggested_action}</> : undefined}
      evidence={tools.length ? { text: tools.join(" · ") } : null}
    />
  );
}

export default function OverviewPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: progress } = useQuery({ queryKey: ["onboarding-progress"], queryFn: getOnboardingProgress });
  const { data: sales, isLoading: salesLoading } = useQuery({ queryKey: ["analytics-sales"], queryFn: () => getSalesSummary(30) });
  const { data: lowStock } = useQuery({ queryKey: ["analytics-low-stock"], queryFn: getLowStockProducts });
  const { data: customers } = useQuery({ queryKey: ["analytics-customers"], queryFn: () => getCustomerActivity(30) });
  const { data: proposals } = useQuery({ queryKey: ["proposals"], queryFn: () => listProposals() });

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
  const pending = proposals?.filter((p) => p.status === "proposed") ?? [];
  const attention = report?.findings.filter((f) => f.status !== "good") ?? [];
  const healthy = report?.findings.filter((f) => f.status === "good") ?? [];
  const onboardingIncomplete = !!progress && progress.current_step !== null;

  const inactive = customers?.filter((c) => c.inactive).length;
  const aov = sales && sales.orders > 0 ? sales.revenue / sales.orders : null;

  return (
    <div className="space-y-8">
      {/* Greeting: the one place the serif display face leads. */}
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="max-w-2xl">
          <p className="eyebrow">Command Center · last 30 days</p>
          <h1 className="mt-2 font-display text-[44px] leading-[1.05] tracking-[-0.015em] text-fg sm:text-5xl">
            {!report ? (
              <>
                Ask NOVA <span className="italic text-corona">how it's going.</span>
              </>
            ) : attention.length > 0 || pending.length > 0 ? (
              <>
                {attention.length + pending.length} {attention.length + pending.length === 1 ? "thing needs" : "things need"}{" "}
                <span className="italic text-corona">you.</span>
              </>
            ) : (
              <>
                All clear, <span className="italic text-corona">{user?.full_name?.split(" ")[0] ?? "owner"}.</span>
              </>
            )}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-2">
            {report
              ? "Everything below comes from your real orders, inventory and customers, with the evidence NOVA used."
              : "Store Manager asks the Sales, Inventory and Customer agents for a real read on the business."}
          </p>
        </div>
        <Button
          data-nova-target="store_health.check"
          variant={report ? "secondary" : "ai"}
          onClick={() => healthMutation.mutate()}
          disabled={healthMutation.isPending}
        >
          {healthMutation.isPending ? "Checking…" : report ? "Refresh" : "How is my store doing?"}
        </Button>
      </header>

      {onboardingIncomplete && (
        <Card className="flex flex-wrap items-center justify-between gap-4 !border-corona/40 !bg-corona-soft/50">
          <div>
            <h2 className="text-sm font-semibold">Create My Store</h2>
            <p className="mt-0.5 text-sm text-fg-2">Tell NOVA about your brand and products — it turns raw input into a working store.</p>
          </div>
          <Link to="/create-store" className={buttonClass({ variant: "primary" })}>
            Start
          </Link>
        </Card>
      )}

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Revenue · 30 days" value={salesLoading ? "…" : money(sales?.revenue ?? 0)} hint={aov ? `Avg order ${money(aov)}` : undefined} />
        <StatTile label="Orders" value={salesLoading ? "…" : (sales?.orders ?? 0).toLocaleString()} hint="Last 30 days" />
        <StatTile label="Low-stock items" value={lowStock ? lowStock.length : "…"} hint={lowStock && lowStock.length > 0 ? <Badge tone="warning">Needs restock</Badge> : "All stocked"} />
        <StatTile
          label="Inactive customers"
          value={inactive ?? "…"}
          hint={customers ? `of ${customers.length} customers` : undefined}
        />
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Needs your decision" className="space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[17px] font-semibold tracking-tight">Needs your decision</h2>
            {report && <span className="eyebrow">{attention.length} to review</span>}
          </div>

          {healthMutation.isError && (
            <ErrorState
              title="Couldn't read the store"
              body={`${healthMutation.error.message} Nothing was changed. Your last results are still shown.`}
              onRetry={() => healthMutation.mutate()}
            />
          )}

          {latestLoading && !report && <LoadingState label="Loading the latest Store Health…" />}
          {healthMutation.isPending && <LoadingState label="Store Manager is consulting the Sales, Inventory and Customer agents…" />}

          {!latestLoading && !report && !healthMutation.isPending && (
            <EmptyState
              title="No Store Health review yet"
              body="Run one and NOVA will list what needs attention here, each with the evidence it used."
            />
          )}

          {report && (
            <>
              <p className="text-xs text-fg-3">As of {new Date(report.generated_at ?? Date.now()).toLocaleString()}</p>
              {attention.map((f) => (
                <Insight key={`${f.category}-${f.metric}`} finding={f} report={report} />
              ))}
              {attention.length === 0 && <EmptyState title="Nothing needs your attention" body="NOVA found no at-risk or watch items in the last review." />}
              {healthy.length > 0 && (
                <Card className="space-y-2.5">
                  <p className="eyebrow">Healthy</p>
                  {healthy.map((f) => (
                    <div key={`${f.category}-${f.metric}`} className="flex items-start gap-3 text-sm">
                      <Badge tone="success" className="shrink-0">
                        {f.category}
                      </Badge>
                      <span className="text-fg-2">{f.finding}</span>
                    </div>
                  ))}
                </Card>
              )}
            </>
          )}
        </section>

        <aside aria-label="Actions" className="space-y-5">
          {report && (
            <ProposalCard
              stage={plan ? (plan.items.some((i) => i.status === "proposed") ? "proposed" : "applied") : "proposed"}
              kicker="Action plan"
              title={plan ? "What NOVA did and what's waiting" : "Fix what NOVA can"}
              note={
                plan
                  ? `Last action plan — ${new Date(plan.generated_at ?? Date.now()).toLocaleString()}`
                  : "Auto-fix low-risk issues now; anything sensitive goes to Approvals for review."
              }
              actions={
                <div className="space-y-3">
                  {plan && (
                    <ul className="space-y-1.5">
                      {plan.items.map((item) => {
                        const s = PLAN_STATUS[item.status] ?? { tone: "neutral" as BadgeTone, label: item.status };
                        return (
                          <li key={item.proposal_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-line px-3 py-2 text-sm">
                            <span className="min-w-0">{item.description}</span>
                            <Badge tone={s.tone}>{s.label}</Badge>
                          </li>
                        );
                      })}
                      {plan.items.length === 0 && <li className="text-sm text-fg-3">Nothing to fix — no real fixable issues found.</li>}
                    </ul>
                  )}
                  {actionPlanMutation.isError && <p className="text-sm text-bad">{actionPlanMutation.error.message}</p>}
                  <Button
                    data-nova-target="store_health.fix"
                    variant="ai"
                    onClick={() => actionPlanMutation.mutate()}
                    disabled={actionPlanMutation.isPending}
                    className="w-full"
                  >
                    {actionPlanMutation.isPending ? "Working…" : plan ? "Fix what you can (again)" : "Fix what you can"}
                  </Button>
                </div>
              }
            />
          )}

          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="eyebrow">Awaiting your approval</p>
              {pending.length > 0 && <Badge tone="proposed">{pending.length}</Badge>}
            </div>
            {pending.length === 0 ? (
              <p className="text-sm text-fg-3">No pending approvals.</p>
            ) : (
              <ul className="space-y-2">
                {pending.slice(0, 4).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-dashed border-corona/70 bg-corona-soft/40 px-3 py-2 text-sm">
                    <span className="min-w-0">{TOOL_LABEL[p.tool_name] ?? p.tool_name}</span>
                    <Badge tone={p.risk_classification === "high" ? "danger" : "neutral"}>{p.risk_classification} risk</Badge>
                  </li>
                ))}
              </ul>
            )}
            {pending.length > 0 && (
              <Link to="/approvals" className={buttonClass({ variant: "secondary", size: "sm" }) + " w-full"}>
                Review in Approvals
              </Link>
            )}
          </Card>

          {report && <DelegationTrace report={report} />}
        </aside>
      </div>
    </div>
  );
}
