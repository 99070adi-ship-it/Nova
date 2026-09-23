import { useQuery } from "@tanstack/react-query";
import { listOrders } from "../api/client";

export default function OrdersPage() {
  const { data: orders, isLoading } = useQuery({ queryKey: ["orders"], queryFn: listOrders });

  return (
    <div>
      <h1 className="text-xl font-semibold">Orders</h1>
      <p className="mt-1 text-sm text-neutral-500">Orders created here or, from P3 onward, placed through the storefront.</p>
      <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Order</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Payment</th>
              <th className="px-4 py-2">Total</th>
              <th className="px-4 py-2">Items</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="px-4 py-3 text-neutral-400" colSpan={5}>
                  Loading…
                </td>
              </tr>
            )}
            {orders?.map((o) => (
              <tr key={o.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2 font-mono text-xs">{o.id.slice(0, 8)}</td>
                <td className="px-4 py-2 text-neutral-500">{o.status}</td>
                <td className="px-4 py-2 text-neutral-500">{o.payment_status}</td>
                <td className="px-4 py-2 text-neutral-700">${o.total.toFixed(2)}</td>
                <td className="px-4 py-2 text-neutral-500">{o.items.length}</td>
              </tr>
            ))}
            {orders?.length === 0 && (
              <tr>
                <td className="px-4 py-3 text-neutral-400" colSpan={5}>
                  No orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
