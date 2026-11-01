import { assetUrl, recordEvent } from "../../api/client";
import { ed } from "../../editor/ed";
import { pick } from "../SectionRenderer";
import Img from "../Img";
import { Cta, str } from "./common";

export default function Hero({ configuration: c }: { configuration: Record<string, unknown> }) {
  const headline = str(c.headline) ?? "Welcome";
  const sub = str(c.subheadline);
  const image = assetUrl(c.image_url);
  const align = pick(c.align, ["left", "center"] as const, image ? "left" : "center");
  const centered = align === "center";
  return (
    <div className={`mx-auto grid max-w-6xl items-center gap-10 px-5 ${image && !centered ? "md:grid-cols-2" : ""}`}>
      <div className={centered ? "mx-auto max-w-2xl text-center" : ""}>
        <h1 className="text-4xl font-medium leading-[1.08] tracking-tight md:text-6xl" {...ed("hero.headline")}>{headline}</h1>
        {sub && <p className={`mt-5 max-w-xl text-lg text-muted ${centered ? "mx-auto" : ""}`} {...ed("hero.subheadline")}>{sub}</p>}
        <div className="mt-9" {...(str(c.cta_text) ? ed("hero.cta") : {})}>
          <Cta text={str(c.cta_text)} href={str(c.cta_href)} className="sf-btn" onClick={() => recordEvent("hero_click")} />
        </div>
      </div>
      {image && (
        <div {...ed("hero.image")} className={centered ? "mx-auto w-full max-w-md" : ""}>
          <Img src={image} alt="" className="aspect-square w-full rounded-theme" fallbackLabel={headline} />
        </div>
      )}
    </div>
  );
}
