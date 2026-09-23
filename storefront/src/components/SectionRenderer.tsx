import type { Section } from "../api/client";
import Hero from "./sections/Hero";
import ProductGrid from "./sections/ProductGrid";

export default function SectionRenderer({ section }: { section: Section }) {
  switch (section.type) {
    case "hero":
      return <Hero configuration={section.configuration} />;
    case "product_grid":
      return <ProductGrid configuration={section.configuration} />;
    default:
      // Forward-compatible with section types future phases add (featured_collection,
      // brand_story, promo_banner, …) that this Prototype 1 renderer doesn't know yet.
      return null;
  }
}
