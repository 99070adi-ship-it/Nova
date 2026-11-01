import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { ApiError, createProduct, listProducts } from "../api/client";
import ProductImagesPanel from "../components/ProductImagesPanel";
import { Badge, Button, Card, EmptyState, Field, Input, LoadingState, Table, Td, Th, Tr } from "../components/ui";

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
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Commerce</p>
        <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight">Products</h1>
      </header>

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <Field label="Title" htmlFor="product-title" className="min-w-[200px] flex-1">
            <Input id="product-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label="SKU" htmlFor="product-sku" className="w-40">
            <Input id="product-sku" value={sku} onChange={(e) => setSku(e.target.value)} required />
          </Field>
          <Field label="Price" htmlFor="product-price" className="w-28">
            <Input id="product-price" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </Field>
          <Button type="submit" disabled={createMutation.isPending}>
            Add product
          </Button>
          {error && <span className="basis-full text-sm text-bad">{error}</span>}
        </form>
      </Card>

      {isLoading && <LoadingState label="Loading products…" rows={4} />}

      {products && products.length === 0 && (
        <EmptyState title="No products yet" body="Add one above, or let NOVA build your catalog from Create My Store." />
      )}

      {products && products.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Title</Th>
              <Th>Status</Th>
              <Th>SKU</Th>
              <Th>Price</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <Fragment key={p.id}>
                <Tr>
                  <Td className="font-medium">{p.title}</Td>
                  <Td>
                    <Badge tone={p.status === "published" ? "success" : "neutral"}>{p.status}</Badge>
                  </Td>
                  <Td num className="text-fg-2">
                    {p.variants[0]?.sku}
                  </Td>
                  <Td num className="text-fg-2">
                    ${p.variants[0]?.price.toFixed(2)}
                  </Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                      {expandedId === p.id ? "Hide images" : "Images"}
                    </Button>
                  </Td>
                </Tr>
                {expandedId === p.id && (
                  <tr>
                    <td colSpan={5} className="p-0">
                      <ProductImagesPanel productId={p.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
