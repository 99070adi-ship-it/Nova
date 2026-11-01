import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { recordEvent } from "../api/client";
import ProductCard, { ProductGridSkeleton } from "../components/ProductCard";
import SLink from "../components/SLink";
import { useStore } from "../components/StoreContext";
import { useTitle } from "../lib/useTitle";
import NotFound from "./NotFound";

export default function CollectionPage() {
  const { slug } = useParams<{ slug: string }>();
  const { collections, products, productsLoading, info, preview } = useStore();
  const collection = collections.find((c) => c.slug === slug);
  useTitle(collection ? `${collection.title} | ${info.store_name}` : undefined, collection?.description);
  useEffect(() => {
    if (collection && !preview) recordEvent("collection_view");
  }, [collection, preview]);

  if (!collection) return productsLoading ? <div className="mx-auto max-w-6xl px-5 py-12"><ProductGridSkeleton /></div> : <NotFound what="collection" />;
  // Exactly the products the server says belong to this collection, nothing inferred.
  const items = products.filter((p) => collection.product_ids.includes(p.id));
  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <nav aria-label="Breadcrumb" className="text-xs text-muted"><SLink to="/products" className="hover:text-ink">Shop</SLink> / {collection.title}</nav>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">{collection.title}</h1>
      {collection.description && <p className="mt-3 max-w-2xl text-muted">{collection.description}</p>}
      <p role="status" className="mt-6 text-sm text-muted">{items.length} {items.length === 1 ? "product" : "products"}</p>
      {items.length === 0 ? <p className="mt-10 text-muted">There are no products in this collection yet.</p> : (
        <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">{items.map((p) => <ProductCard key={p.id} product={p} />)}</div>
      )}
    </div>
  );
}
