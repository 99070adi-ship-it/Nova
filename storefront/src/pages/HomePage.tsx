import { useEffect, useRef } from "react";
import { recordEvent, recordPreviewLoaded } from "../api/client";
import SectionRenderer from "../components/SectionRenderer";
import { useStore } from "../components/StoreContext";
import ProductGrid from "../components/sections/ProductGrid";
import { insideBuilder } from "../editor/protocol";
import { useTitle } from "../lib/useTitle";

export default function HomePage() {
  const { storefront, preview, editor, info, storefrontError, storefrontLoading } = useStore();
  // Store Builder's embedded emulator is an editing surface, not the owner opening their preview: only an unframed preview counts.
  const embeddedInBuilder = insideBuilder(editor, preview);
  useTitle(info.store_name);
  const home = storefront?.pages.find((p) => p.slug === "home") ?? storefront?.pages[0];
  const sections = (home?.sections ?? []).slice().sort((a, b) => a.order - b.order);

  useEffect(() => {
    if (!preview) recordEvent("page_view"); // previews are never real customer traffic
  }, [preview]);

  const reported = useRef<string | null>(null);
  useEffect(() => {
    // After commit: the sections are actually in the DOM, not merely fetched.
    if (!preview || embeddedInBuilder || sections.length === 0 || reported.current === preview) return;
    reported.current = preview;
    void recordPreviewLoaded(preview);
  }, [preview, embeddedInBuilder, sections.length]);

  if (storefrontLoading && !storefront) return <div role="status" className="mx-auto max-w-6xl px-5 py-24 text-center text-sm text-muted">Loading…</div>;
  if (!storefront || sections.length === 0) {
    return (
      <div>
        <section className="mx-auto max-w-2xl px-5 py-24 text-center">
          <h1 className="text-4xl font-medium tracking-tight">{info.store_name}</h1>
          <p className="mt-4 text-muted">
            {storefrontError?.status === 404 || !storefront ? "This store hasn't published its homepage yet. You can still browse the products." : "This page has no content yet."}
          </p>
        </section>
        <ProductGrid configuration={{ title: "Products", limit: 8 }} />
      </div>
    );
  }
  return <div>{sections.map((s, i) => <SectionRenderer key={`${s.type}-${i}`} section={s} />)}</div>;
}
