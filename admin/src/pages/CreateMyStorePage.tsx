import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { STOREFRONT_ORIGIN } from "../lib/storefrontUrl";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  ProductDraft,
  acceptProductDraft,
  addProductToCollection,
  createCollection,
  createProductDraft,
  generateProductDraftContent,
  generateStorefront,
  getCurrentStoreCreation,
  getStorefrontDraft,
  listCollections,
  listProductDrafts,
  listProducts,
  rejectProductDraft,
  startStoreCreation,
  submitBrandInput,
  updateProductDraft,
  useVeloraSampleProducts,
} from "../api/client";

const FIELD_BADGE: Record<string, string> = {
  known: "bg-emerald-50 text-emerald-700 border-emerald-200",
  suggested: "bg-blue-50 text-blue-700 border-blue-200",
  requires_confirmation: "bg-amber-50 text-amber-700 border-amber-200",
};

// price/sku are never AI-generated (ARCHITECTURE.md "Product ingestion") — they stay
// requires_confirmation forever on a photo-only draft unless the owner fills them in here.
const EDITABLE_FIELDS: { key: string; label: string; type: "text" | "number" | "textarea" }[] = [
  { key: "title", label: "Title", type: "text" },
  { key: "price", label: "Price", type: "number" },
  { key: "sku", label: "SKU", type: "text" },
  { key: "category", label: "Category", type: "text" },
  { key: "description", label: "Description", type: "textarea" },
  { key: "seo_title", label: "SEO title", type: "text" },
  { key: "seo_description", label: "SEO description", type: "textarea" },
];

function DraftFieldsEditor({ draft, onClose, onSaved }: { draft: ProductDraft; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(EDITABLE_FIELDS.map((f) => [f.key, draft.fields[f.key] != null ? String(draft.fields[f.key]) : ""]))
  );
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, string | number> = {};
      for (const f of EDITABLE_FIELDS) {
        const raw = values[f.key].trim();
        if (raw === "") continue; // untouched — leave this field's value/status exactly as-is
        payload[f.key] = f.type === "number" ? parseFloat(raw) : raw;
      }
      return updateProductDraft(draft.id, payload);
    },
    onSuccess: () => {
      setError(null);
      onSaved();
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to save changes"),
  });

  return (
    <div className="mt-3 space-y-3 border-t border-neutral-200 pt-3">
      {EDITABLE_FIELDS.map((f) => (
        <div key={f.key}>
          <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-neutral-600">
            {f.label}
            <span className={clsx("rounded border px-1 py-0 text-[10px]", FIELD_BADGE[draft.field_status[f.key]])}>
              {draft.field_status[f.key]}
            </span>
          </label>
          {f.type === "textarea" ? (
            <textarea
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              rows={2}
              className="w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
            />
          ) : (
            <input
              type={f.type}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
            />
          )}
        </div>
      ))}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white"
        >
          {mutation.isPending ? "Saving…" : "Save changes"}
        </button>
        <button onClick={onClose} className="rounded-md border border-neutral-300 px-3 py-1 text-xs">
          Cancel
        </button>
      </div>
    </div>
  );
}

function BrandInputForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [name, setName] = useState("Velora");
  const [sellsWhat, setSellsWhat] = useState("");
  const [targetCustomer, setTargetCustomer] = useState("");
  const [positioning, setPositioning] = useState("");
  const [vibeText, setVibeText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      submitBrandInput({
        name,
        sells_what: sellsWhat || null,
        target_customer: targetCustomer || null,
        positioning: positioning || null,
        vibe_text: vibeText || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-progress"] });
      onSubmitted();
    },
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
        <label htmlFor="brand-name" className="mb-1 block text-sm font-medium">Brand / store name</label>
        <input id="brand-name" data-nova-target="brand_form.name" value={name} onChange={(e) => setName(e.target.value)} required className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label htmlFor="brand-sells_what" className="mb-1 block text-sm font-medium">What do you sell?</label>
        <input id="brand-sells_what" data-nova-target="brand_form.sells_what" value={sellsWhat} onChange={(e) => setSellsWhat(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" placeholder="Premium leather handbags" />
      </div>
      <div>
        <label htmlFor="brand-target_customer" className="mb-1 block text-sm font-medium">Target customer</label>
        <input id="brand-target_customer" data-nova-target="brand_form.target_customer" value={targetCustomer} onChange={(e) => setTargetCustomer(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" placeholder="Women 22-40" />
      </div>
      <div>
        <label htmlFor="brand-positioning" className="mb-1 block text-sm font-medium">Positioning</label>
        <input id="brand-positioning" data-nova-target="brand_form.positioning" value={positioning} onChange={(e) => setPositioning(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" placeholder="Premium but accessible" />
      </div>
      <div>
        <label htmlFor="brand-vibe_text" className="mb-1 block text-sm font-medium">Brand vibe</label>
        <input id="brand-vibe_text" data-nova-target="brand_form.vibe_text" value={vibeText} onChange={(e) => setVibeText(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" placeholder="Minimal, luxurious, editorial" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button data-nova-target="brand_form.save" type="submit" disabled={mutation.isPending} className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
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
        <input
          data-nova-target="product_form.title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">SKU (if known)</label>
        <input
          data-nova-target="product_form.sku"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">Price (if known)</label>
        <input
          data-nova-target="product_form.price"
          type="number"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">Category</label>
        <input
          data-nova-target="product_form.category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
      </div>
      <button
        data-nova-target="product_form.save"
        type="submit"
        disabled={mutation.isPending}
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
      >
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
    queryClient.invalidateQueries({ queryKey: ["onboarding-progress"] });
  };

  const acceptMutation = useMutation({ mutationFn: acceptProductDraft, onSuccess: invalidate });
  const rejectMutation = useMutation({ mutationFn: rejectProductDraft, onSuccess: invalidate });
  const generateMutation = useMutation({ mutationFn: generateProductDraftContent, onSuccess: invalidate });
  const samplesMutation = useMutation({ mutationFn: useVeloraSampleProducts, onSuccess: invalidate });
  const [editingId, setEditingId] = useState<string | null>(null);

  const addProductForm = (
    <>
      <ProductDraftForm onCreated={invalidate} />

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3">
        <p className="flex-1 text-xs text-neutral-500">
          Not ready to add your own products yet? Start with five example products to see the rest of NOVA in action.
        </p>
        <button
          onClick={() => samplesMutation.mutate()}
          disabled={samplesMutation.isPending}
          className="whitespace-nowrap rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50"
        >
          {samplesMutation.isPending ? "Adding…" : "Use VELORA Sample Products"}
        </button>
      </div>
      {samplesMutation.isError && (
        <p className="mt-2 text-xs text-red-600">
          {samplesMutation.error instanceof ApiError ? samplesMutation.error.message : "Failed to add sample products"}
        </p>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      {addProductForm}

      <div className="space-y-2">
        {isLoading && <p className="text-sm text-neutral-400">Loading…</p>}
        {drafts?.map((d, index) => {
          const canAccept = d.status === "owner_reviewing" || d.status === "generated";
          const canGenerate = d.status === "pending_generation" || d.status === "owner_reviewing";
          const canEdit = d.status !== "accepted" && d.status !== "rejected";
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
                      data-nova-target={index === 0 ? "draft_form.generate_first" : undefined}
                      onClick={() => generateMutation.mutate(d.id)}
                      disabled={generateMutation.isPending}
                      className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-100"
                    >
                      {generateMutation.isPending && generateMutation.variables === d.id ? "Generating…" : "Generate content"}
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => setEditingId(editingId === d.id ? null : d.id)}
                      className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-100"
                    >
                      {editingId === d.id ? "Close" : "Edit fields"}
                    </button>
                  )}
                  {canAccept && (
                    <>
                      <button
                        data-nova-target={index === 0 ? "draft_form.accept_first" : undefined}
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
              {editingId === d.id && (
                <DraftFieldsEditor draft={d} onClose={() => setEditingId(null)} onSaved={invalidate} />
              )}
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

function CollectionsPanel() {
  // Onboarding step 5 — the one real-task UI this pipeline needed that didn't exist anywhere in
  // the app yet (no other page lets an owner create a collection at all). Minimal by design: a
  // name and an optional product to start it with, using the same real /collections endpoints
  // the backend has always supported.
  const queryClient = useQueryClient();
  const { data: collections } = useQuery({ queryKey: ["collections"], queryFn: listCollections });
  const { data: products } = useQuery({ queryKey: ["products"], queryFn: listProducts });
  const [title, setTitle] = useState("");
  const [productId, setProductId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const slug = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `collection-${Date.now()}`;
      const collection = await createCollection({ title, slug });
      if (productId) await addProductToCollection(collection.id, productId);
      return collection;
    },
    onSuccess: () => {
      setTitle("");
      setProductId("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["onboarding-progress"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to create collection"),
  });

  return (
    <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold">Organize into collections</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Group your products so customers can browse by theme — e.g. "New Arrivals."
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) createMutation.mutate();
        }}
        className="mt-3 flex flex-wrap items-end gap-2"
      >
        <input
          data-nova-target="collection_form.title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Collection name"
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">No product yet</option>
          {products?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <button
          data-nova-target="collection_form.create"
          type="submit"
          disabled={createMutation.isPending}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          {createMutation.isPending ? "Creating…" : "Create collection"}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {collections && collections.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-neutral-500">
          {collections.map((c) => (
            <li key={c.id}>• {c.title}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GenerateStorefrontPanel({ onGenerated }: { onGenerated: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const generateMutation = useMutation({
    mutationFn: generateStorefront,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-progress"] });
      onGenerated();
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to generate storefront"),
  });

  return (
    <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold">Ready to build your storefront?</h2>
      <p className="mt-1 text-sm text-neutral-500">
        NOVA will generate a homepage from your brand and accepted products. You can still edit everything in Store Builder afterward.
      </p>
      <button
        data-nova-target="storefront_gen.generate"
        onClick={() => generateMutation.mutate()}
        disabled={generateMutation.isPending}
        className="mt-3 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
      >
        {generateMutation.isPending ? "Generating…" : "Generate storefront"}
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ReadyForReviewPanel() {
  // Nothing has published yet at this point in the journey — linking to the live site would show
  // a stale or empty store. The draft's own id is the real preview (ARCHITECTURE.md "Real store
  // preview"), same shared query the Store Builder page uses.
  const { data: draft } = useQuery({ queryKey: ["storefront-draft"], queryFn: getStorefrontDraft });

  return (
    <div className="max-w-md rounded-lg border border-neutral-200 bg-white p-6">
      <h2 className="text-sm font-semibold">Your storefront is ready to review</h2>
      <p className="mt-1 text-sm text-neutral-500">Preview it, ask NOVA to change anything, then publish when you're happy.</p>
      <div className="mt-4 flex gap-2">
        <Link to="/store-builder" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
          Open Store Builder
        </Link>
        {draft && (
          <a
            href={`${STOREFRONT_ORIGIN}/?preview=${draft.id}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100"
          >
            Preview storefront ↗
          </a>
        )}
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

      <div className="mt-2">
        {session.status === "brand_input" && (
          <BrandInputForm onSubmitted={() => queryClient.invalidateQueries({ queryKey: ["store-creation"] })} />
        )}
        {(session.status === "product_input" || session.status === "generating_products") && (
          <>
            <ProductDraftsPanel />
            <CollectionsPanel />
            <GenerateStorefrontPanel onGenerated={() => queryClient.invalidateQueries({ queryKey: ["store-creation"] })} />
          </>
        )}
        {(session.status === "generating_storefront" || session.status === "ready_for_review" || session.status === "completed") && (
          <ReadyForReviewPanel />
        )}
      </div>
    </div>
  );
}
