import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listProducts } from "../../api/client";

interface Props {
  configuration: Record<string, unknown>;
}

export default function ProductGrid({ configuration }: Props) {
  const title = (configuration.title as string) ?? "Shop";
  const limit = (configuration.limit as number) ?? 12;
  const { data: products, isLoading } = useQuery({ queryKey: ["public-products"], queryFn: listProducts });

  const shown = products?.slice(0, limit) ?? [];

  return (
    <section className="px-6 py-16">
      <h2 className="mb-6 text-xl font-semibold">{title}</h2>
      {isLoading && <p className="text-sm text-neutral-400">Loading…</p>}
      {!isLoading && shown.length === 0 && <p className="text-sm text-neutral-400">No products published yet.</p>}
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4">
        {shown.map((p) => (
          <Link key={p.id} to={`/products/${p.slug}`} className="group">
            <div className="aspect-square rounded-lg bg-neutral-100" />
            <p className="mt-2 text-sm font-medium group-hover:underline">{p.title}</p>
            <p className="text-sm text-neutral-500">${p.variants[0]?.price.toFixed(2)}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
