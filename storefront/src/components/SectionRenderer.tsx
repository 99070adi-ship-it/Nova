import type { CSSProperties } from "react";
import type { Section } from "../api/client";
import { ed } from "../editor/ed";
import BrandStory from "./sections/BrandStory";
import CollectionGrid from "./sections/CollectionGrid";
import FeatureBanner from "./sections/FeatureBanner";
import Hero from "./sections/Hero";
import ProductGrid from "./sections/ProductGrid";

const PADDING = { compact: "2.5rem", regular: "4rem", spacious: "7rem" } as const;
type Spacing = keyof typeof PADDING;
type Background = "default" | "surface" | "inverse";

// What each section looks like when its `background` is left at "default".
const DEFAULT_BACKGROUND: Record<string, Background> = { hero: "surface", feature_banner: "inverse" };

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed as readonly string[]).includes(value as string) ? (value as T) : fallback;

/** Wraps every section with its presentation settings (background, spacing) and its editor tags. The settings are validated
 * here as well as on the server, so a stored value can never produce anything but an approved look. */
function SectionFrame({ section, children }: { section: Section; children: React.ReactNode }) {
  const c = section.configuration;
  const spacing = pick<Spacing>(c.spacing, ["compact", "regular", "spacious"], "regular");
  const requested = pick<Background>(c.background, ["default", "surface", "inverse"], "default");
  const background = requested === "default" ? (DEFAULT_BACKGROUND[section.type] ?? "default") : requested;
  const style: CSSProperties = { paddingBlock: PADDING[spacing] };
  if (background === "inverse") {
    (style as Record<string, string>)["--sf-primary"] = "var(--sf-bg-base)";
    (style as Record<string, string>)["--sf-bg"] = "var(--sf-primary-base)";
  }
  const cls = background === "inverse" ? "bg-canvas text-ink" : background === "surface" ? "bg-surface text-ink" : "";
  return (
    <section data-nova-section={section.id} data-section-type={section.type} className={cls} style={style} {...ed(`${section.type}.section`)}>
      {children}
    </section>
  );
}

function Body({ section }: { section: Section }) {
  const c = section.configuration;
  switch (section.type) {
    case "hero":
      return <Hero configuration={c} />;
    case "product_grid":
      return <ProductGrid configuration={c} />;
    case "collection_grid":
      return <CollectionGrid configuration={c} />;
    case "feature_banner":
      return <FeatureBanner configuration={c} />;
    case "brand_story":
      return <BrandStory configuration={c} />;
    default:
      return null;
  }
}

/** Renders every section type Store Builder and the generators can produce. An unknown type renders nothing (forward
 * compatible) rather than breaking the page. */
export default function SectionRenderer({ section }: { section: Section }) {
  if (!["hero", "product_grid", "collection_grid", "feature_banner", "brand_story"].includes(section.type)) return null;
  return <SectionFrame section={section}><Body section={section} /></SectionFrame>;
}

export { pick };
