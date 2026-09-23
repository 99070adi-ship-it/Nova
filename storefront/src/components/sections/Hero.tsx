import { Link } from "react-router-dom";

interface Props {
  configuration: Record<string, unknown>;
}

export default function Hero({ configuration }: Props) {
  const headline = (configuration.headline as string) ?? "Welcome";
  const subheadline = configuration.subheadline as string | undefined;
  const ctaText = configuration.cta_text as string | undefined;
  const ctaHref = (configuration.cta_href as string) ?? "/products";

  return (
    <section className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">{headline}</h1>
      {subheadline && <p className="mt-3 text-lg text-neutral-500">{subheadline}</p>}
      {ctaText && (
        <Link to={ctaHref === "/shop" ? "/products" : ctaHref} className="mt-8 rounded-full bg-neutral-900 px-6 py-3 text-sm font-medium text-white">
          {ctaText}
        </Link>
      )}
    </section>
  );
}
