import { ed } from "../../editor/ed";
import { useStore } from "../StoreContext";
import Img from "../Img";
import SLink from "../SLink";
import { str } from "./common";

export default function CollectionGrid({ configuration: c }: { configuration: Record<string, unknown> }) {
  const { collections, products } = useStore();
  const limit = typeof c.limit === "number" && c.limit > 0 ? Math.min(c.limit, 12) : 6;
  // Only collections that really have products appear, each shown with a real product from it.
  const tiles = collections
    .map((col) => ({ col, first: products.find((p) => col.product_ids.includes(p.id)) }))
    .filter((t) => t.first)
    .slice(0, limit);
  if (tiles.length === 0) return null;
  return (
    <div className="mx-auto max-w-6xl px-5">
      <h2 className="mb-8 text-2xl font-medium tracking-tight" {...ed("collection_grid.heading")}>{str(c.title) ?? "Shop by collection"}</h2>
      <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-5" {...ed("collection_grid.collections")}>
        {tiles.map(({ col, first }) => (
          <SLink key={col.id} to={`/collections/${col.slug}`} className="group block">
            <div className="aspect-[4/5] overflow-hidden rounded-theme bg-surface">
              <Img src={first!.images[0]?.url} alt="" fallbackLabel={col.title} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
            </div>
            <p className="mt-3 text-sm font-medium">{col.title}</p>
            <p className="text-xs text-muted">{col.product_ids.length} {col.product_ids.length === 1 ? "piece" : "pieces"}</p>
          </SLink>
        ))}
      </div>
    </div>
  );
}
