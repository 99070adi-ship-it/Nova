import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { getStorefront, getStorefrontPreview, recordEvent } from "../api/client";
import SectionRenderer from "../components/SectionRenderer";
import StoreHeader from "../components/StoreHeader";

export default function HomePage() {
  const [searchParams] = useSearchParams();
  const previewVersionId = searchParams.get("preview");

  const { data: storefront, isLoading, error } = useQuery({
    queryKey: ["storefront", previewVersionId],
    queryFn: () => (previewVersionId ? getStorefrontPreview(previewVersionId) : getStorefront()),
  });

  useEffect(() => {
    if (!previewVersionId) recordEvent("page_view"); // previews are never real customer traffic
  }, [previewVersionId]);

  if (isLoading) return <p className="p-6 text-sm text-neutral-400">Loading…</p>;
  if (error || !storefront) {
    return (
      <p className="p-6 text-sm text-neutral-400">
        {previewVersionId ? "This preview link is invalid or has expired." : "This store hasn't published a storefront yet."}
      </p>
    );
  }

  const homePage = storefront.pages.find((p) => p.slug === "home") ?? storefront.pages[0];

  return (
    <div>
      {previewVersionId && (
        <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-amber-950">
          Preview — draft, not live
        </div>
      )}
      <StoreHeader storeName={storefront.store_name} />
      {homePage?.sections
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((section, i) => <SectionRenderer key={i} section={section} />)}
    </div>
  );
}
