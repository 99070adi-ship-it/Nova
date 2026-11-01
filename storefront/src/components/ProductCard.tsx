import type { Product } from "../api/client";
import { money } from "../lib/format";
import { useWishlist, wishlist } from "../lib/wishlist";
import Img from "./Img";
import SLink from "./SLink";

export function priceRange(p: Product): { text: string; inStock: boolean } {
  const prices = p.variants.map((v) => v.price);
  const inStock = p.variants.some((v) => v.in_stock);
  if (prices.length === 0) return { text: "", inStock: false };
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return { text: min === max ? money(min) : `From ${money(min)}`, inStock };
}

export default function ProductCard({ product }: { product: Product }) {
  const saved = useWishlist().includes(product.slug);
  const { text, inStock } = priceRange(product);
  const img = product.images[0];
  return (
    <div className="group relative">
      <SLink to={`/products/${product.slug}`} className="block" aria-label={`${product.title}, ${text}${inStock ? "" : ", sold out"}`}>
        <div className="relative aspect-square overflow-hidden rounded-theme bg-surface">
          <Img src={img?.url} alt={img?.alt_text ?? product.title} fallbackLabel={product.title} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
          {!inStock && <span className="absolute left-3 top-3 rounded-full bg-canvas px-2.5 py-1 text-[11px] font-medium uppercase tracking-label text-ink">Sold out</span>}
        </div>
        <p className="mt-3 text-sm font-medium">{product.title}</p>
        {product.category && <p className="text-xs text-muted">{product.category}</p>}
        <p className="mt-1 text-sm text-muted">{text}</p>
      </SLink>
      <button
        type="button"
        onClick={() => wishlist.toggle(product.slug)}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${product.title} from saved items` : `Save ${product.title}`}
        className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-canvas/90 text-ink shadow-sm transition-transform hover:scale-105"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M12 20.5S4 15.4 4 9.6C4 7 6 5 8.4 5c1.5 0 2.8.8 3.6 2 .8-1.2 2.1-2 3.6-2C18 5 20 7 20 9.6c0 5.8-8 10.9-8 10.9z" />
        </svg>
      </button>
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="aspect-square rounded-theme bg-surface" />
          <div className="mt-3 h-3 w-2/3 rounded bg-surface" />
          <div className="mt-2 h-3 w-1/3 rounded bg-surface" />
        </div>
      ))}
    </div>
  );
}
