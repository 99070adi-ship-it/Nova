import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { validateCart, type CartLine } from "../api/client";
import Img from "../components/Img";
import SLink from "../components/SLink";
import { useStore } from "../components/StoreContext";
import { cart, useCart } from "../lib/cart";
import { money, variantLabel } from "../lib/format";
import { useTitle } from "../lib/useTitle";

export function issueText(line: CartLine, cap: number): string | null {
  if (line.issues.includes("unavailable")) return "This item is no longer available.";
  if (line.issues.includes("out_of_stock")) return "This item is sold out.";
  if (line.issues.includes("insufficient_stock")) return `Only ${line.available} available.`;
  if (line.issues.includes("quantity_capped")) return `There's a limit of ${cap} per order.`;
  return null;
}

export default function CartPage() {
  const items = useCart();
  const { info, preview } = useStore();
  useTitle(`Cart | ${info.store_name}`);
  const signature = items.map((i) => `${i.variantId}:${i.quantity}`).join(",");
  const query = useQuery({
    queryKey: ["cart", info.slug, signature],
    queryFn: () => validateCart(items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity }))),
    enabled: items.length > 0,
    staleTime: 0,
    retry: 1,
  });
  // Lines the server says cannot exist at all are dropped from the stored cart, so it can't be stuck with them.
  useEffect(() => {
    query.data?.lines.filter((l) => l.issues.includes("unavailable")).forEach((l) => cart.remove(l.variant_id));
  }, [query.data]);

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-5 py-28 text-center">
        <h1 className="text-3xl font-medium tracking-tight">Your cart is empty</h1>
        <p className="mt-3 text-muted">When you add something it will show up here.</p>
        <SLink to="/products" className="sf-btn mt-8">Continue shopping</SLink>
      </div>
    );
  }

  const data = query.data;
  const cap = info.max_quantity_per_line;
  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <h1 className="text-3xl font-medium tracking-tight">Your cart</h1>
      {query.isLoading && <p role="status" className="mt-8 text-muted">Checking prices and stock…</p>}
      {query.error && <p role="alert" className="mt-8">We couldn't check your cart just now. <button className="underline" onClick={() => query.refetch()}>Try again</button></p>}
      {data && (
        <div className="mt-8 grid gap-12 md:grid-cols-[1fr_320px]">
          <ul className="divide-y divide-line border-y border-line">
            {data.lines.filter((l) => !l.issues.includes("unavailable")).map((line) => {
              const issue = issueText(line, cap);
              return (
                <li key={line.variant_id} className="flex gap-4 py-6" data-testid="cart-line">
                  <Img src={line.image_url} alt={line.title ?? ""} fallbackLabel={line.title ?? "?"} className="h-24 w-24 shrink-0 rounded-theme" />
                  <div className="flex-1">
                    <div className="flex justify-between gap-3">
                      <div>
                        <SLink to={`/products/${line.product_slug}`} className="font-medium hover:underline">{line.title}</SLink>
                        <p className="text-sm text-muted">{variantLabel(line.attributes)}</p>
                      </div>
                      <p className="text-sm" data-testid="line-total">{line.unit_price !== null ? money(line.unit_price * line.quantity) : ""}</p>
                    </div>
                    {issue && (
                      <p role="alert" className="mt-2 text-sm font-medium">
                        {issue}{" "}
                        {line.issues.includes("insufficient_stock") && line.available > 0 && (
                          <button className="underline underline-offset-4" onClick={() => cart.setQuantity(line.variant_id, line.available, line.max_quantity)}>Set to {line.available}</button>
                        )}
                        {line.issues.includes("quantity_capped") && <button className="underline underline-offset-4" onClick={() => cart.setQuantity(line.variant_id, cap, cap)}>Set to {cap}</button>}
                      </p>
                    )}
                    <div className="mt-4 flex items-center gap-5 text-sm">
                      <div className="flex items-center rounded-theme border border-line" role="group" aria-label={`Quantity for ${line.title}`}>
                        <button className="h-9 w-9 disabled:opacity-30" aria-label="Decrease quantity" disabled={line.quantity <= 1} onClick={() => cart.setQuantity(line.variant_id, line.quantity - 1, line.max_quantity || cap)}>−</button>
                        <span className="w-8 text-center" data-testid="line-quantity">{line.quantity}</span>
                        <button className="h-9 w-9 disabled:opacity-30" aria-label="Increase quantity" disabled={line.quantity >= Math.max(1, line.max_quantity)} onClick={() => cart.setQuantity(line.variant_id, line.quantity + 1, line.max_quantity || cap)}>+</button>
                      </div>
                      <button className="text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => cart.remove(line.variant_id)}>Remove</button>
                      {line.unit_price !== null && <span className="text-muted">{money(line.unit_price)} each</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <aside className="h-fit rounded-theme bg-surface p-6" aria-label="Order summary">
            <h2 className="sf-eyebrow">Summary</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd data-testid="subtotal">{money(data.subtotal, data.currency)}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-muted">{data.shipping_note}</p>
            {preview ? <p className="mt-6 text-sm">Checkout is turned off while previewing a draft.</p> : data.can_checkout ? (
              <SLink to="/checkout" className="sf-btn mt-6 w-full">Checkout</SLink>
            ) : (
              <>
                <button className="sf-btn mt-6 w-full" disabled>Checkout</button>
                <p role="status" className="mt-3 text-xs">Fix the items marked above to continue.</p>
              </>
            )}
            <SLink to="/products" className="mt-4 block text-center text-sm text-muted underline-offset-4 hover:text-ink hover:underline">Continue shopping</SLink>
          </aside>
        </div>
      )}
    </div>
  );
}
