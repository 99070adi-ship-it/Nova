import { useState, type FormEvent } from "react";
import { ApiError, lookupOrder, type Order } from "../api/client";
import { useStore } from "../components/StoreContext";
import { useTitle } from "../lib/useTitle";
import { OrderDetails } from "../components/OrderDetails";

/** There are no customer accounts, so an order is found with its number AND the email it was placed with. */
export default function OrderLookupPage({ initialOrderId = "" }: { initialOrderId?: string }) {
  const { info } = useStore();
  useTitle(`Find an order | ${info.store_name}`);
  const [orderId, setOrderId] = useState(initialOrderId);
  const [email, setEmail] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[0-9a-f-]{36}$/i.test(orderId.trim()) || !email.includes("@")) {
      setError("Enter the order number from your confirmation and the email you used.");
      return;
    }
    setBusy(true);
    try {
      setOrder(await lookupOrder(orderId.trim(), email.trim()));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? "We couldn't find an order with that number and email." : err instanceof ApiError && err.status === 422 ? err.message : "We couldn't look that up just now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (order) return <OrderDetails order={order} headline="Your order" />;
  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <h1 className="text-3xl font-medium tracking-tight">Find an order</h1>
      <p className="mt-3 text-sm text-muted">This store doesn't have customer accounts. Enter the order number from your confirmation and the email you ordered with.</p>
      <form onSubmit={submit} noValidate className="mt-8 space-y-5">
        <div>
          <label htmlFor="lk-id" className="text-sm font-medium">Order number</label>
          <input id="lk-id" className="sf-input mt-1.5 font-mono text-xs" value={orderId} onChange={(e) => setOrderId(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="lk-email" className="text-sm font-medium">Email</label>
          <input id="lk-email" type="email" className="sf-input mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        {error && <p role="alert" className="text-sm font-medium">{error}</p>}
        <button className="sf-btn w-full" disabled={busy}>{busy ? "Looking…" : "Find my order"}</button>
      </form>
    </div>
  );
}
