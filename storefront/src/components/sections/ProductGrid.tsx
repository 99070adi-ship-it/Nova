import { ed } from "../../editor/ed";
import { useStore } from "../StoreContext";
import ProductCard, { ProductGridSkeleton } from "../ProductCard";
import SLink from "../SLink";
import { str } from "./common";

export default function ProductGrid({ configuration: c }: { configuration: Record<string, unknown> }) {
  const { products, collections, productsLoading } = useStore();
  const title = str(c.title) ?? "Shop";
  const limit = typeof c.limit === "number" && c.limit > 0 ? Math.min(c.limit, 100) : 8;
  const collectionId = str(c.collection_id);
  const collection = collectionId ? collections.find((x) => x.id === collectionId) : undefined;
  const pool = collection ? products.filter((p) => collection.product_ids.includes(p.id)) : products;
  // Prefer what can be bought, but never hide the rest: sold-out products stay visible, last.
  const ordered = [...pool].sort((a, b) => Number(b.variants.some((v) => v.in_stock)) - Number(a.variants.some((v) => v.in_stock)));
  const shown = ordered.slice(0, limit);
  return (
    <div className="mx-auto max-w-6xl px-5">
      <div className="mb-8 flex items-end justify-between">
        <h2 className="text-2xl font-medium tracking-tight" {...ed("product_grid.heading")}>{title}</h2>
        <SLink to={collection ? `/collections/${collection.slug}` : "/products"} className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline">View all</SLink>
      </div>
      <div {...ed("product_grid.products")}>
        {productsLoading ? <ProductGridSkeleton count={Math.min(limit, 8)} /> : shown.length === 0 ? (
          <p className="text-sm text-muted">Nothing to show here yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">{shown.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        )}
      </div>
    </div>
  );
}
