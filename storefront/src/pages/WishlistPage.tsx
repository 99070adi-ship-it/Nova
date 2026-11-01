import ProductCard from "../components/ProductCard";
import SLink from "../components/SLink";
import { useStore } from "../components/StoreContext";
import { useTitle } from "../lib/useTitle";
import { useWishlist } from "../lib/wishlist";

export default function WishlistPage() {
  const { products, info, productsLoading } = useStore();
  const slugs = useWishlist();
  useTitle(`Saved items | ${info.store_name}`);
  // Only products that still exist are shown; anything that was removed from the store quietly drops out.
  const items = slugs.map((s) => products.find((p) => p.slug === s)).filter((p): p is NonNullable<typeof p> => !!p);
  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <h1 className="text-3xl font-medium tracking-tight">Saved items</h1>
      <p className="mt-2 text-sm text-muted">Saved on this device only. There are no accounts, so they won't follow you to another browser.</p>
      {!productsLoading && items.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-lg font-medium">Nothing saved yet</p>
          <p className="mt-2 text-sm text-muted">Tap the heart on any product to keep it here.</p>
          <SLink to="/products" className="sf-btn mt-8">Browse the shop</SLink>
        </div>
      ) : (
        <div className="mt-10 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">{items.map((p) => <ProductCard key={p.id} product={p} />)}</div>
      )}
    </div>
  );
}
