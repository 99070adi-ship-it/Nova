import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, getProduct, recordEvent, type Variant } from "../api/client";
import Img from "../components/Img";
import ProductCard from "../components/ProductCard";
import SLink from "../components/SLink";
import { useStore } from "../components/StoreContext";
import { cart } from "../lib/cart";
import { money, variantLabel } from "../lib/format";
import { useTitle } from "../lib/useTitle";
import { useWishlist, wishlist } from "../lib/wishlist";
import NotFound from "./NotFound";

export function availabilityText(v: Variant): { text: string; tone: "ok" | "low" | "out" } {
  if (!v.in_stock) return { text: "Sold out", tone: "out" };
  if (v.low_stock) return { text: `Only ${v.available} left`, tone: "low" };
  return { text: "In stock", tone: "ok" };
}

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const { info, preview, collections, products } = useStore();
  const { data: product, isLoading, error } = useQuery({ queryKey: ["product", info.slug, slug], queryFn: () => getProduct(slug!), enabled: !!slug, retry: false });
  const [variantId, setVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const saved = useWishlist().includes(slug ?? "");

  useTitle(product ? (product.seo_title ?? `${product.title} | ${info.store_name}`) : undefined, product?.seo_description ?? product?.description);
  useEffect(() => {
    if (slug && !preview) recordEvent("product_view", slug);
  }, [slug, preview]);
  useEffect(() => {
    setVariantId(null);
    setQuantity(1);
    setFeedback(null);
    setImageIndex(0);
  }, [slug]);

  const variant: Variant | undefined = useMemo(() => {
    if (!product) return undefined;
    return product.variants.find((v) => v.id === variantId) ?? product.variants.find((v) => v.in_stock) ?? product.variants[0];
  }, [product, variantId]);

  const related = useMemo(() => {
    if (!product) return [];
    const inCollection = new Set(collections.filter((c) => c.product_ids.includes(product.id)).flatMap((c) => c.product_ids));
    return products.filter((p) => p.id !== product.id && (inCollection.has(p.id) || (product.category && p.category === product.category))).slice(0, 4);
  }, [product, collections, products]);

  if (isLoading) return <div className="mx-auto max-w-5xl px-5 py-16" role="status"><div className="grid gap-10 md:grid-cols-2"><div className="aspect-square rounded-theme bg-surface" /><div className="space-y-4"><div className="h-8 w-2/3 rounded bg-surface" /><div className="h-5 w-1/4 rounded bg-surface" /></div></div></div>;
  if (error instanceof ApiError && error.status === 404) return <NotFound what="product" />;
  if (error || !product || !variant) return <div className="mx-auto max-w-xl px-5 py-24 text-center" role="alert"><p className="text-lg font-medium">We couldn't load this product.</p><p className="mt-2 text-sm text-muted">Please try again in a moment.</p></div>;

  const avail = availabilityText(variant);
  const max = Math.min(variant.available, info.max_quantity_per_line);
  const hasColors = product.variants.length > 1;
  const image = product.images[imageIndex] ?? product.images[0];
  const canBuy = variant.in_stock && !preview;

  const add = () => {
    const q = Math.min(Math.max(1, quantity), Math.max(1, max));
    const res = cart.add(variant.id, q, max);
    recordEvent("add_to_cart", slug);
    setFeedback(res.added === 0 ? `You already have the most we can offer (${max}) in your cart.` : res.capped ? `Added ${res.added}. That's the most available for this item.` : `Added ${res.added} to your cart.`);
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <nav aria-label="Breadcrumb" className="text-xs text-muted">
        <SLink to="/products" className="hover:text-ink">Shop</SLink>
        {product.category && <> / <span>{product.category}</span></>} / <span className="text-ink">{product.title}</span>
      </nav>
      <div className="mt-6 grid gap-10 md:grid-cols-2">
        <div>
          <Img src={image?.url} alt={image?.alt_text ?? product.title} fallbackLabel={product.title} className="aspect-square w-full rounded-theme" />
          {product.images.length > 1 && (
            <ul className="mt-3 flex gap-2">
              {product.images.map((im, i) => (
                <li key={im.url}>
                  <button type="button" onClick={() => setImageIndex(i)} aria-label={`Show image ${i + 1}`} aria-current={i === imageIndex} className={`h-16 w-16 overflow-hidden rounded-theme border ${i === imageIndex ? "border-ink" : "border-line"}`}>
                    <Img src={im.url} alt="" fallbackLabel={product.title} className="h-full w-full" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h1 className="text-3xl font-medium tracking-tight">{product.title}</h1>
          <p className="mt-3 text-2xl" data-testid="price">{money(variant.price)}</p>
          {product.description && <p className="mt-5 leading-relaxed text-muted">{product.description}</p>}

          {hasColors && (
            <fieldset className="mt-7">
              <legend className="sf-eyebrow">Colour: <span className="text-ink normal-case tracking-normal">{variantLabel(variant.attributes)}</span></legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {product.variants.map((v) => (
                  <button
                    key={v.id} type="button" onClick={() => { setVariantId(v.id); setQuantity(1); setFeedback(null); }}
                    aria-pressed={v.id === variant.id} disabled={false}
                    className={`rounded-theme border px-4 py-2 text-sm ${v.id === variant.id ? "border-ink bg-ink text-ink-on" : "border-line hover:border-ink"} ${v.in_stock ? "" : "opacity-50 line-through"}`}
                  >
                    {variantLabel(v.attributes) || v.sku}
                    {!v.in_stock && <span className="sr-only"> (sold out)</span>}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <p role="status" className={`mt-6 text-sm ${avail.tone === "out" ? "text-ink font-medium" : avail.tone === "low" ? "font-medium" : "text-muted"}`} data-testid="availability">{avail.text}</p>

          <div className="mt-4 flex items-center gap-4">
            <div className="flex items-center rounded-theme border border-line" role="group" aria-label="Quantity">
              <button type="button" className="h-11 w-11 text-lg disabled:opacity-30" aria-label="Decrease quantity" disabled={!canBuy || quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
              <span className="w-10 text-center text-sm" aria-live="polite" data-testid="quantity">{quantity}</span>
              <button type="button" className="h-11 w-11 text-lg disabled:opacity-30" aria-label="Increase quantity" disabled={!canBuy || quantity >= max} onClick={() => setQuantity((q) => Math.min(max, q + 1))}>+</button>
            </div>
            <button type="button" className="sf-btn flex-1" disabled={!canBuy} onClick={add}>{variant.in_stock ? "Add to cart" : "Sold out"}</button>
          </div>
          {preview && <p className="mt-3 text-xs text-muted">Adding to cart is turned off while previewing a draft.</p>}
          <div aria-live="polite" className="mt-3 min-h-5 text-sm" data-testid="cart-feedback">
            {feedback && <p>{feedback} <SLink to="/cart" className="underline underline-offset-4">View cart</SLink></p>}
          </div>

          <button type="button" onClick={() => wishlist.toggle(product.slug)} aria-pressed={saved} className="mt-4 text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
            {saved ? "Saved. Remove from saved items" : "Save for later"}
          </button>
          <dl className="mt-8 divide-y divide-line border-y border-line text-sm">
            <div className="flex justify-between py-3"><dt className="text-muted">SKU</dt><dd>{variant.sku}</dd></div>
            {typeof variant.attributes?.material === "string" && <div className="flex justify-between py-3"><dt className="text-muted">Material</dt><dd className="capitalize">{variant.attributes.material}</dd></div>}
            {product.category && <div className="flex justify-between py-3"><dt className="text-muted">Collection</dt><dd>{product.category}</dd></div>}
          </dl>
        </div>
      </div>
      {related.length > 0 && (
        <section className="mt-20" aria-labelledby="related">
          <h2 id="related" className="mb-8 text-2xl font-medium tracking-tight">You may also like</h2>
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-4">{related.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        </section>
      )}
    </div>
  );
}
