import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { getCustomerActivity, getLowStockProducts, getSalesSummary } from "../api/client";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

export default function AnalyticsPage() {
  const { data: sales, isLoading: salesLoading } = useQuery({ queryKey: ["analytics-sales"], queryFn: () => getSalesSummary(30) });
  const { data: lowStock } = useQuery({ queryKey: ["analytics-low-stock"], queryFn: getLowStockProducts });
  const { data: customers } = useQuery({ queryKey: ["analytics-customers"], queryFn: () => getCustomerActivity(30) });

  return (
    <div>
      <h1 className="text-xl font-semibold">Analytics</h1>
      <p className="mt-1 text-sm text-neutral-500">Last 30 days.</p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Revenue" value={salesLoading ? "…" : `$${(sales?.revenue ?? 0).toFixed(2)}`} />
        <StatCard label="Orders" value={salesLoading ? "…" : sales?.orders ?? 0} />
        <StatCard label="Low stock items" value={lowStock?.length ?? "…"} />
        <StatCard label="Inactive customers" value={customers?.filter((c) => c.inactive).length ?? "…"} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Top products</h2>
          <div className="mt-3 space-y-2">
            {sales?.top_products.map((p) => (
              <div key={p.title} className="flex items-center justify-between text-sm">
                <span>{p.title}</span>
                <span className="text-neutral-500">
                  ${p.revenue.toFixed(2)} · {p.units} units
                </span>
              </div>
            ))}
            {sales?.top_products.length === 0 && <p className="text-sm text-neutral-400">No sales yet.</p>}
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Low stock</h2>
          <div className="mt-3 space-y-2">
            {lowStock?.map((p) => (
              <div key={p.sku} className="flex items-center justify-between text-sm">
                <span>
                  {p.title} <span className="text-neutral-400">({p.sku})</span>
                </span>
                <span className="font-medium text-amber-600">{p.on_hand} left</span>
              </div>
            ))}
            {lowStock?.length === 0 && <p className="text-sm text-neutral-400">Nothing low on stock.</p>}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Customers</h2>
        <div className="mt-3 space-y-1">
          {customers?.map((c) => (
            <div key={c.email} className="flex items-center justify-between text-sm">
              <span>{c.name}</span>
              <span className="flex items-center gap-2 text-neutral-500">
                {c.order_count} orders
                {c.inactive && <span className={clsx("rounded border px-1.5 py-0.5 text-[11px]", "border-amber-200 bg-amber-50 text-amber-700")}>inactive</span>}
              </span>
            </div>
          ))}
          {customers?.length === 0 && <p className="text-sm text-neutral-400">No customers yet.</p>}
        </div>
      </div>
    </div>
  );
}
