import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  ApiError, getStoreInfo, getStorefront, getStorefrontPreview, listCollections, listProducts,
  type Collection, type Product, type StoreInfo, type Storefront,
} from "../api/client";
import { setCartStore } from "../lib/cart";
import { editorRequested, previewVersionId, rememberOrgSlug, resolveOrgSlug } from "../lib/store";
import { setWishlistStore } from "../lib/wishlist";

interface StoreState {
  org: string;
  preview: string | null;
  /** Store Builder asked for its visual-editing preview (honoured only when the embedding parent is verified). */
  editor: boolean;
  info: StoreInfo;
  storefront: Storefront | null; // null until published (live) or when the preview link is invalid
  storefrontError: ApiError | null;
  storefrontLoading: boolean;
  products: Product[];
  collections: Collection[];
  productsLoading: boolean;
}

const Ctx = createContext<StoreState | null>(null);

export function useStore(): StoreState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside <StoreProvider>");
  return v;
}

/** Resolves the store, its published (or previewed) storefront, catalog and collections once for the whole site. */
export function StoreProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const preview = previewVersionId(location.search);
  const editor = editorRequested(location.search);

  // A draft-preview link carries only the version id; the draft itself says which store it belongs to.
  const previewQuery = useQuery({
    queryKey: ["preview", preview],
    queryFn: () => getStorefrontPreview(preview!),
    enabled: !!preview,
    retry: false,
  });
  const org = preview ? (previewQuery.data?.org_slug ?? null) : resolveOrgSlug(location.search);
  if (preview && org) rememberOrgSlug(org); // before the store queries run, so the API client resolves the same store

  useEffect(() => {
    setCartStore(org);
    setWishlistStore(org);
  }, [org]);

  const info = useQuery({ queryKey: ["info", org], queryFn: getStoreInfo, enabled: !!org, retry: false });
  const liveStorefront = useQuery({
    queryKey: ["storefront", org],
    queryFn: getStorefront,
    enabled: !!org && info.isSuccess && !preview,
    retry: false,
  });
  const storefrontData = preview ? previewQuery.data : liveStorefront.data;
  const storefrontError = preview ? previewQuery.error : liveStorefront.error;
  const products = useQuery({ queryKey: ["products", org], queryFn: listProducts, enabled: !!org && info.isSuccess });
  const collections = useQuery({ queryKey: ["collections", org], queryFn: listCollections, enabled: !!org && info.isSuccess });

  const value = useMemo<StoreState | null>(() => {
    if (!org || !info.data) return null;
    return {
      org, preview, editor, info: info.data, storefront: storefrontData ?? null,
      storefrontError: storefrontError instanceof ApiError ? storefrontError : null,
      storefrontLoading: preview ? previewQuery.isLoading : liveStorefront.isLoading || liveStorefront.isPending,
      products: products.data ?? [], collections: collections.data ?? [], productsLoading: products.isLoading,
    };
  }, [org, preview, editor, info.data, storefrontData, storefrontError, previewQuery.isLoading, liveStorefront.isLoading, liveStorefront.isPending, products.data, products.isLoading, collections.data]);

  if (preview && previewQuery.isLoading) return <Message title="" body="Loading the preview…" busy />;
  if (preview && previewQuery.error) return <Message title="" body="This preview link is invalid or has expired." />;
  if (!org) return <Message title="Choose a store" body="This address doesn't say which store to show. Open the store from its own link." />;
  if (info.isLoading) return <Message title="" body="Loading the store…" busy />;
  if (info.error || !value) {
    const notFound = info.error instanceof ApiError && info.error.status === 404;
    return (
      <Message
        title={notFound ? "Store not found" : "The store is unavailable"}
        body={notFound ? "We couldn't find a store at this address." : "We couldn't reach the store just now. Please try again in a moment."}
      />
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function Message({ title, body, busy = false }: { title: string; body: string; busy?: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 text-center text-ink" role={busy ? "status" : "alert"}>
      <div>
        {title && <h1 className="text-xl font-semibold">{title}</h1>}
        <p className="mt-2 text-sm text-muted">{body}</p>
      </div>
    </div>
  );
}
