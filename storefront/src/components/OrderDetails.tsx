import type { Order } from "../api/client";
import { money, variantLabel } from "../lib/format";
import SLink from "./SLink";

const STATUS: Record<string, string> = { pending: "Received", fulfilled: "Fulfilled", cancelled: "Cancelled", refunded: "Refunded" };
const PAYMENT: Record<string, string> = { pending: "Not paid (demo order)", paid: "Paid", refunded: "Refunded" };

export function OrderDetails({ order, headline }: { order: Order; headline: string }) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-14" data-testid="order-details">
      <p className="sf-eyebrow">{order.demo ? "Demo order" : "Order"}</p>
      <h1 className="mt-2 text-3xl font-medium tracking-tight">{headline}</h1>
      <p className="mt-3 text-muted">{order.note}</p>
      <dl className="mt-8 grid grid-cols-2 gap-y-3 border-y border-line py-5 text-sm">
        <dt className="text-muted">Order number</dt><dd className="break-all font-mono text-xs" data-testid="order-id">{order.id}</dd>
        <dt className="text-muted">Placed</dt><dd>{new Date(order.created_at).toLocaleString()}</dd>
        <dt className="text-muted">Name</dt><dd>{order.customer_name}</dd>
        <dt className="text-muted">Email</dt><dd>{order.customer_email}</dd>
        <dt className="text-muted">Order status</dt><dd data-testid="order-status">{STATUS[order.status] ?? order.status}</dd>
        <dt className="text-muted">Payment</dt><dd data-testid="payment-status">{PAYMENT[order.payment_status] ?? order.payment_status}</dd>
      </dl>
      <ul className="divide-y divide-line">
        {order.items.map((it) => (
          <li key={it.sku} className="flex justify-between gap-4 py-4 text-sm">
            <span>{it.quantity} × {it.title}{variantLabel(it.attributes) ? ` (${variantLabel(it.attributes)})` : ""}</span>
            <span>{money(it.line_total, order.currency)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex justify-between border-t border-line pt-4 font-medium"><span>Total</span><span data-testid="order-total">{money(order.total, order.currency)}</span></p>
      <SLink to="/products" className="sf-btn mt-10">Continue shopping</SLink>
    </div>
  );
}
