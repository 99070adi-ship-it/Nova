import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useState } from "react";
import {
  ApiError,
  acceptProductDraft,
  createProductDraft,
  generateProductDraftContent,
  getCurrentStoreCreation,
  listProductDrafts,
  rejectProductDraft,
  startStoreCreation,
  submitBrandInput,
} from "../api/client";

const FIELD_BADGE: Record<string, string> = {
  known: "bg-emerald-50 text-emerald-700 border-emerald-200",
  suggested: "bg-blue-50 text-blue-700 border-blue-200",
  requires_confirmation: "bg-amber-50 text-amber-700 border-amber-200",
};

function BrandInputForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [name, setName] = useState("Velora");
  const [sellsWhat, setSellsWhat] = useState("");
  const [targetCustomer, setTargetCustomer] = useState("");
  const [positioning, setPositioning] = useState("");
  const [vibeText, setVibeText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      submitBrandInput({
        name,
        sells_what: sellsWhat || null,
        target_customer: targetCustomer || null,
        positioning: positioning || null,
        vibe_text: vibeText || null,
      }),
    onSuccess: onSubmitted,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to save brand input"),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="max-w-lg space-y-4 rounded-lg border border-neutral-200 bg-white p-6"
    >
      <div>
        <label className="mb-1 block text-sm font-medium">Brand / store name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">What do you sell?</label>
        <input value={sellsWhat} onChange={(e) => setSellsWhat(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" placeholder="Premium leather handbags" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Target customer</label>
        <input value={targetCustomer} onChange={(e) => setTargetCustomer(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" placeholder="Women 22-40" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Positioning</label>
        <input value={positioning} onChange={(e) => setPositioning(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" placeholder="Premium but accessible" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Brand vibe</label>
        <input value={vibeText} onChange={(e) => setVibeText(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" placeholder="Minimal, luxurious, editorial" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={mutation.isPending} className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
        Continue to products
      </button>
    </form>
  );
}

function ProductDraftForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createProductDraft({
        title: title || null,
        price: price ? parseFloat(price) : null,
        sku: sku || null,
        category: category || null,
        source_image_refs: imageUrl ? [imageUrl] : null,
      }),
    onSuccess: () => {
      onCreated();
      setTitle("");
      setPrice("");
      setSku("");
      setCategory("");
      setImageUrl("");
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to add product"),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-white p-4"
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">Photo URL</label>
        <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className="w-56 rounded-md border border-neutral-300 px-2 py-1 text-sm" placeholder="https://…" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">Name (if known)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">SKU (if known)</label>
        <input value={sku} onChange={(e) => setSku(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">Price (if known)</label>
        <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">Category</label>
        <input value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1 text-sm" />
      </div>
      <button type="submit" disabled={mutation.isPending} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white">
        Add product
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  );
}

function ProductDraftsPanel() {
  const queryClient = useQueryClient();
  const { data: drafts, isLoading } = useQuery({ queryKey: ["product-drafts"], queryFn: listProductDrafts });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["product-drafts"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
  };

  const acceptMutation = useMutation({ mutationFn: acceptProductDraft, onSuccess: invalidate });
  const rejectMutation = useMutation({ mutationFn: rejectProductDraft, onSuccess: invalidate });
  const generateMutation = useMutation({ mutationFn: generateProductDraftContent, onSuccess: invalidate });

  return (
    <div className="space-y-4">
      <ProductDraftForm onCreated={invalidate} />

      <div className="space-y-2">
        {isLoading && <p className="text-sm text-neutral-400">Loading…</p>}
        {drafts?.map((d) => {
          const canAccept = d.status === "owner_reviewing" || d.status === "generated";
          const canGenerate = d.status === "pending_generation" || d.status === "owner_reviewing";
          const description = d.fields.description as string | undefined;
          return (
            <div key={d.id} className="rounded-lg border border-neutral-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{(d.fields.title as string) ?? "(untitled)"}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Object.entries(d.field_status).map(([field, status]) => (
                      <span key={field} className={clsx("rounded border px-1.5 py-0.5 text-[11px]", FIELD_BADGE[status])}>
                        {field}: {status}
                      </span>
                    ))}
                  </div>
                  {description && <p className="mt-2 max-w-lg text-xs text-neutral-600">{description}</p>}
                  <p className="mt-1 text-xs text-neutral-400">status: {d.status}</p>
                </div>
                <div className="flex gap-2">
                  {canGenerate && (
                    <button
                      onClick={() => generateMutation.mutate(d.id)}
                      disabled={generateMutation.isPending}
                      className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-100"
                    >
                      {generateMutation.isPending && generateMutation.variables === d.id ? "Generating…" : "Generate content"}
                    </button>
                  )}
                  {canAccept && (
                    <>
                      <button
                        onClick={() => acceptMutation.mutate(d.id)}
                        className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => rejectMutation.mutate(d.id)}
                        className="rounded-md border border-neutral-300 px-3 py-1 text-xs"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
              {acceptMutation.isError && acceptMutation.variables === d.id && (
                <p className="mt-2 text-xs text-red-600">
                  {acceptMutation.error instanceof ApiError ? acceptMutation.error.message : "Accept failed"}
                </p>
              )}
            </div>
          );
        })}
        {drafts?.length === 0 && <p className="text-sm text-neutral-400">No products added yet.</p>}
      </div>
    </div>
  );
}

export default function CreateMyStorePage() {
  const queryClient = useQueryClient();
  const [started, setStarted] = useState(false);

  const startMutation = useMutation({
    mutationFn: startStoreCreation,
    onSuccess: () => {
      setStarted(true);
      queryClient.invalidateQueries({ queryKey: ["store-creation"] });
    },
  });

  const { data: session } = useQuery({
    queryKey: ["store-creation"],
    queryFn: getCurrentStoreCreation,
    enabled: started,
    retry: false,
  });

  useEffect(() => {
    // Idempotent — the backend returns the existing session if one is already active.
    startMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session) {
    return <p className="text-sm text-neutral-400">Starting…</p>;
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">Create My Store</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Step: <span className="font-medium">{session.status}</span>
      </p>

      <div className="mt-6">
        {session.status === "brand_input" ? (
          <BrandInputForm onSubmitted={() => queryClient.invalidateQueries({ queryKey: ["store-creation"] })} />
        ) : (
          <ProductDraftsPanel />
        )}
      </div>
    </div>
  );
}
