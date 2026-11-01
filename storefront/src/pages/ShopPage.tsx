import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { Product } from "../api/client";
import ProductCard, { ProductGridSkeleton } from "../components/ProductCard";
import SLink from "../components/SLink";
import { useStore } from "../components/StoreContext";
import { useTitle } from "../lib/useTitle";

export type SortKey = "featured" | "price-asc" | "price-desc" | "name";

const lowest = (p: Product) => (p.variants.length ? Math.min(...p.variants.map((v) => v.price)) : Infinity);

/** Case-insensitive match on title, category, tags and description. Every word must match somewhere. */
export function searchProducts(products: Product[], query: string): Product[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return products;
  return products.filter((p) => {
    const haystack = [p.title, p.category ?? "", p.description ?? "", ...p.tags].join(" ").toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

export function sortProducts(products: Product[], sort: SortKey): Product[] {
  const copy = [...products];
  if (sort === "price-asc") copy.sort((a, b) => lowest(a) - lowest(b) || a.title.localeCompare(b.title));
  else if (sort === "price-desc") copy.sort((a, b) => lowest(b) - lowest(a) || a.title.localeCompare(b.title));
  else if (sort === "name") copy.sort((a, b) => a.title.localeCompare(b.title));
  return copy; // "featured" keeps the store's own order (newest first)
}

export default function ShopPage() {
  const { products, collections, productsLoading, info } = useStore();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const sort = (["price-asc", "price-desc", "name"].includes(params.get("sort") ?? "") ? params.get("sort") : "featured") as SortKey;
  const category = params.get("category") ?? "";
  useTitle(`Shop | ${info.store_name}`);

  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].sort(), [products]);
  const results = useMemo(() => {
    const filtered = searchProducts(products, q).filter((p) => !category || p.category === category);
    return sortProducts(filtered, sort);
  }, [products, q, sort, category]);

  const update = (next: Record<string, string>) => {
    const copy = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) (v ? copy.set(k, v) : copy.delete(k));
    setParams(copy, { replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <h1 className="text-3xl font-medium tracking-tight">{q ? `Results for “${q}”` : "Shop"}</h1>
      {collections.length > 0 && (
        <nav aria-label="Collections" className="mt-5 flex flex-wrap gap-2">
          {collections.map((c) => <SLink key={c.id} to={`/collections/${c.slug}`} className="rounded-full border border-line px-4 py-1.5 text-sm text-muted hover:border-ink hover:text-ink">{c.title}</SLink>)}
        </nav>
      )}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-y border-line py-3 text-sm">
        <p role="status" aria-live="polite" className="text-muted">{productsLoading ? "Loading…" : `${results.length} ${results.length === 1 ? "product" : "products"}`}</p>
        <div className="flex flex-wrap items-center gap-3">
          {categories.length > 1 && (
            <label className="flex items-center gap-2">
              <span className="text-muted">Category</span>
              <select value={category} onChange={(e) => update({ category: e.target.value })} className="sf-input !w-auto !py-1.5">
                <option value="">All</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2">
            <span className="text-muted">Sort</span>
            <select value={sort} onChange={(e) => update({ sort: e.target.value === "featured" ? "" : e.target.value })} className="sf-input !w-auto !py-1.5">
              <option value="featured">Featured</option>
              <option value="price-asc">Price, low to high</option>
              <option value="price-desc">Price, high to low</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
      </div>
      <div className="mt-8">
        {productsLoading ? <ProductGridSkeleton /> : results.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-lg font-medium">{q ? `No products match “${q}”` : "Nothing here yet"}</p>
            <p className="mt-2 text-sm text-muted">{q ? "Try a shorter or different word, or clear the filters." : "Check back soon."}</p>
            {(q || category) && <button type="button" className="sf-btn-ghost mt-6" onClick={() => setParams({}, { replace: true })}>Clear search and filters</button>}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">{results.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        )}
      </div>
    </div>
  );
}
