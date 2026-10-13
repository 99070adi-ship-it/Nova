import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { getStorefront, getStorefrontPreview, recordEvent, recordPreviewLoaded } from "../api/client";
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

  const homePage = storefront?.pages.find((p) => p.slug === "home") ?? storefront?.pages[0];
  const renderedSections = homePage?.sections.length ?? 0;
  const reportedPreviewRef = useRef<string | null>(null);
  useEffect(() => {
    // After commit, i.e. the sections are actually in the DOM — not merely fetched.
    if (!previewVersionId || renderedSections === 0 || reportedPreviewRef.current === previewVersionId) return;
    reportedPreviewRef.current = previewVersionId;
    void recordPreviewLoaded(previewVersionId);
  }, [previewVersionId, renderedSections]);

  if (isLoading) return <p className="p-6 text-sm text-neutral-400">Loading…</p>;
  if (error || !storefront) {
    return (
      <p className="p-6 text-sm text-neutral-400">
        {previewVersionId ? "This preview link is invalid or has expired." : "This store hasn't published a storefront yet."}
      </p>
    );
  }

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
