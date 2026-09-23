import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { ApiError, createProduct, listProducts } from "../api/client";
import ProductImagesPanel from "../components/ProductImagesPanel";

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const { data: products, isLoading } = useQuery({ queryKey: ["products"], queryFn: listProducts });

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [sku, setSku] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      createProduct({
        title,
        slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
        variants: [{ sku, price: parseFloat(price) }],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setTitle("");
      setPrice("");
      setSku("");
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to create product"),
  });

  return (
    <div>
      <h1 className="text-xl font-semibold">Products</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-white p-4"
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required className="rounded-md border border-neutral-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">SKU</label>
          <input value={sku} onChange={(e) => setSku(e.target.value)} required className="rounded-md border border-neutral-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">Price</label>
          <input
            type="number"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />
        </div>
        <button type="submit" disabled={createMutation.isPending} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white">
          Add product
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </form>

      <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Title</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Price</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="px-4 py-3 text-neutral-400" colSpan={5}>
                  Loading…
                </td>
              </tr>
            )}
            {products?.map((p) => (
              <Fragment key={p.id}>
                <tr className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-2 font-medium">{p.title}</td>
                  <td className="px-4 py-2 text-neutral-500">{p.status}</td>
                  <td className="px-4 py-2 text-neutral-500">{p.variants[0]?.sku}</td>
                  <td className="px-4 py-2 text-neutral-500">${p.variants[0]?.price.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                      className="text-xs text-neutral-500 hover:underline"
                    >
                      {expandedId === p.id ? "Hide images" : "Images"}
                    </button>
                  </td>
                </tr>
                {expandedId === p.id && (
                  <tr>
                    <td colSpan={5} className="p-0">
                      <ProductImagesPanel productId={p.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {products?.length === 0 && (
              <tr>
                <td className="px-4 py-3 text-neutral-400" colSpan={5}>
                  No products yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
