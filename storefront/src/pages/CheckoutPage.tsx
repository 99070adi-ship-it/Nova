import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, checkout, validateCart } from "../api/client";
import SLink, { useStoreNav } from "../components/SLink";
import { useStore } from "../components/StoreContext";
import { cart, useCart } from "../lib/cart";
import { money, newIdempotencyKey, variantLabel } from "../lib/format";
import { saveLastOrder } from "../lib/lastOrder";
import { useTitle } from "../lib/useTitle";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * DEMO checkout. There is no payment provider behind it: no card details are asked for, no payment is taken, and the order
 * it creates stays "payment pending" forever. The page says so, and the shopper must acknowledge it before ordering.
 */
export default function CheckoutPage() {
  const items = useCart();
  const { info, preview } = useStore();
  const navigate = useNavigate();
  const nav = useStoreNav();
  useTitle(`Checkout | ${info.store_name}`);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [ack, setAck] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; ack?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // One key per checkout attempt: a double-click, a retry after a dropped response or a re-submit all resolve to ONE order.
  const keyRef = useRef<string>(newIdempotencyKey());

  const signature = items.map((i) => `${i.variantId}:${i.quantity}`).join(",");
  const { data, isLoading } = useQuery({
    queryKey: ["cart", info.slug, signature],
    queryFn: () => validateCart(items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity }))),
    enabled: items.length > 0,
    staleTime: 0,
  });

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-5 py-28 text-center">
        <h1 className="text-3xl font-medium tracking-tight">Nothing to check out</h1>
        <p className="mt-3 text-muted">Your cart is empty.</p>
        <SLink to="/products" className="sf-btn mt-8">Continue shopping</SLink>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return; // a second click while the first is in flight does nothing
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Enter your name.";
    if (!EMAIL.test(email.trim())) next.email = "Enter a valid email address.";
    if (!ack) next.ack = "Please confirm that you understand this is a demo checkout.";
    setErrors(next);
    setServerError(null);
    if (Object.keys(next).length > 0) return;
    setSubmitting(true);
    try {
      const order = await checkout({
        idempotency_key: keyRef.current,
        customer_email: email.trim(),
        customer_name: name.trim(),
        items: items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
        demo_checkout_acknowledged: ack,
      });
      saveLastOrder(order);
      cart.clear();
      navigate(nav(`/order/${order.id}`), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setServerError(`${err.message} Review your cart, fix the items marked, and try again.`);
        keyRef.current = newIdempotencyKey(); // the cart will change, so this is a new attempt
      } else if (err instanceof ApiError && err.status === 422) {
        setServerError(err.message === "Request validation failed" ? "Please check the details you entered." : err.message);
      } else {
        // The order may or may not have been created: keep the SAME key so retrying can never create a second one.
        setServerError("We couldn't place the order. Nothing was charged. Please try again.");
      }
      setSubmitting(false);
    }
  };

  const blocked = !!preview;
  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <h1 className="text-3xl font-medium tracking-tight">Checkout</h1>
      <div role="note" className="mt-6 rounded-theme border border-ink p-4 text-sm" data-testid="demo-notice">
        <p className="font-medium">Demo checkout</p>
        <p className="mt-1 text-muted">No payment is taken and no card details are collected. Placing an order creates a demo order in this store: it is not paid and nothing will be shipped.</p>
      </div>
      <div className="mt-10 grid gap-12 md:grid-cols-[1fr_340px]">
        <form onSubmit={submit} noValidate className="space-y-6">
          <div>
            <label htmlFor="co-name" className="text-sm font-medium">Full name</label>
            <input id="co-name" className="sf-input mt-1.5" autoComplete="name" value={name} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }} aria-invalid={!!errors.name} aria-describedby={errors.name ? "co-name-err" : undefined} />
            {errors.name && <p id="co-name-err" role="alert" className="mt-1 text-sm">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="co-email" className="text-sm font-medium">Email</label>
            <input id="co-email" type="email" className="sf-input mt-1.5" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })); }} aria-invalid={!!errors.email} aria-describedby={errors.email ? "co-email-err" : "co-email-help"} />
            <p id="co-email-help" className="mt-1 text-xs text-muted">You'll need this email and your order number to look the order up later.</p>
            {errors.email && <p id="co-email-err" role="alert" className="mt-1 text-sm">{errors.email}</p>}
          </div>
          <p className="text-sm text-muted">Shipping isn't offered in this demo, so there's no address to enter.</p>
          <div>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={ack} onChange={(e) => { setAck(e.target.checked); setErrors((x) => ({ ...x, ack: undefined })); }} className="mt-0.5 h-4 w-4" aria-invalid={!!errors.ack} />
              <span>I understand this is a demo checkout: no payment is taken and nothing will ship.</span>
            </label>
            {errors.ack && <p role="alert" className="mt-1 text-sm">{errors.ack}</p>}
          </div>
          {serverError && <p role="alert" className="rounded-theme border border-ink p-3 text-sm" data-testid="checkout-error">{serverError} <SLink to="/cart" className="underline">Back to cart</SLink></p>}
          <button type="submit" className="sf-btn w-full" disabled={submitting || blocked || isLoading || (data ? !data.can_checkout : false)}>
            {submitting ? "Placing demo order…" : "Place demo order"}
          </button>
          {blocked && <p className="text-sm text-muted">Orders can't be placed while previewing a draft.</p>}
          {data && !data.can_checkout && <p role="status" className="text-sm">Some items in your cart need attention. <SLink to="/cart" className="underline">Review your cart</SLink>.</p>}
        </form>
        <aside className="h-fit rounded-theme bg-surface p-6" aria-label="Order summary">
          <h2 className="sf-eyebrow">Order summary</h2>
          {isLoading && <p role="status" className="mt-4 text-sm text-muted">Checking prices and stock…</p>}
          <ul className="mt-4 space-y-3 text-sm">
            {data?.lines.filter((l) => l.title).map((l) => (
              <li key={l.variant_id} className="flex justify-between gap-3">
                <span>{l.quantity} × {l.title}{variantLabel(l.attributes) ? ` (${variantLabel(l.attributes)})` : ""}</span>
                <span>{l.unit_price !== null ? money(l.unit_price * l.quantity) : ""}</span>
              </li>
            ))}
          </ul>
          {data && (
            <dl className="mt-5 border-t border-line pt-4 text-sm">
              <div className="flex justify-between font-medium"><dt>Total</dt><dd data-testid="checkout-total">{money(data.subtotal, data.currency)}</dd></div>
              <p className="mt-2 text-xs text-muted">{data.shipping_note}</p>
            </dl>
          )}
        </aside>
      </div>
    </div>
  );
}
