import { ed } from "../../editor/ed";
import { pick } from "../SectionRenderer";
import { Cta, str } from "./common";

export default function FeatureBanner({ configuration: c }: { configuration: Record<string, unknown> }) {
  const heading = str(c.heading);
  if (!heading) return null;
  const left = pick(c.align, ["left", "center"] as const, "center") === "left";
  return (
    <div className={`mx-auto max-w-4xl px-5 ${left ? "text-left" : "text-center"}`}>
      {str(c.eyebrow) && <p className="text-[11px] font-medium uppercase tracking-label opacity-70" {...ed("feature_banner.eyebrow")}>{str(c.eyebrow)}</p>}
      <h2 className="mt-3 text-3xl font-medium leading-tight tracking-tight md:text-4xl" {...ed("feature_banner.heading")}>{heading}</h2>
      {str(c.body) && <p className={`mt-4 max-w-xl opacity-80 ${left ? "" : "mx-auto"}`} {...ed("feature_banner.body")}>{str(c.body)}</p>}
      <div className="mt-8" {...(str(c.cta_text) ? ed("feature_banner.cta") : {})}>
        <Cta text={str(c.cta_text)} href={str(c.cta_href)} className="inline-flex items-center rounded-theme border border-current px-6 py-3 text-sm font-medium transition-opacity hover:opacity-80" />
      </div>
    </div>
  );
}
