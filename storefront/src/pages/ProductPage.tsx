import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getProduct, getStorefront } from "../api/client";
import StoreHeader from "../components/StoreHeader";

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: storefront } = useQuery({ queryKey: ["storefront"], queryFn: getStorefront });
  const { data: product, isLoading, error } = useQuery({
    queryKey: ["product", slug],
    queryFn: () => getProduct(slug!),
    enabled: !!slug,
  });

  return (
    <div>
      <StoreHeader storeName={storefront?.store_name ?? "Store"} />
      <div className="mx-auto max-w-3xl px-6 py-12">
        {isLoading && <p className="text-sm text-neutral-400">Loading…</p>}
        {error && <p className="text-sm text-neutral-400">Product not found.</p>}
        {product && (
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
            <div className="aspect-square rounded-lg bg-neutral-100" />
            <div>
              <h1 className="text-2xl font-semibold">{product.title}</h1>
              {product.category && <p className="mt-1 text-sm text-neutral-500">{product.category}</p>}
              <p className="mt-4 text-xl">${product.variants[0]?.price.toFixed(2)}</p>
              {product.description && <p className="mt-4 text-sm text-neutral-600">{product.description}</p>}
              <button className="mt-6 w-full rounded-full bg-neutral-900 px-6 py-3 text-sm font-medium text-white">Add to cart</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
