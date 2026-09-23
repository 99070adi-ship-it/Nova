import type { Section } from "../api/client";
import BrandStory from "./sections/BrandStory";
import Hero from "./sections/Hero";
import ProductGrid from "./sections/ProductGrid";

export default function SectionRenderer({ section }: { section: Section }) {
  switch (section.type) {
    case "hero":
      return <Hero configuration={section.configuration} />;
    case "product_grid":
      return <ProductGrid configuration={section.configuration} />;
    case "brand_story":
      return <BrandStory configuration={section.configuration} />;
    default:
      // Forward-compatible with section types future phases add (featured_collection,
      // promo_banner, …) that this Prototype 1 renderer doesn't know yet.
      return null;
  }
}
