import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStorefront, recordEvent } from "../api/client";
import SectionRenderer from "../components/SectionRenderer";
import StoreHeader from "../components/StoreHeader";

export default function HomePage() {
  const { data: storefront, isLoading, error } = useQuery({ queryKey: ["storefront"], queryFn: getStorefront });

  useEffect(() => {
    recordEvent("page_view");
  }, []);

  if (isLoading) return <p className="p-6 text-sm text-neutral-400">Loading…</p>;
  if (error || !storefront) {
    return <p className="p-6 text-sm text-neutral-400">This store hasn't published a storefront yet.</p>;
  }

  const homePage = storefront.pages.find((p) => p.slug === "home") ?? storefront.pages[0];

  return (
    <div>
      <StoreHeader storeName={storefront.store_name} />
      {homePage?.sections
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((section, i) => <SectionRenderer key={i} section={section} />)}
    </div>
  );
}
