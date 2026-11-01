import { ed } from "../../editor/ed";
import { pick } from "../SectionRenderer";
import { str } from "./common";

export default function BrandStory({ configuration: c }: { configuration: Record<string, unknown> }) {
  const heading = str(c.heading);
  const body = str(c.body);
  if (!heading && !body) return null;
  const left = pick(c.align, ["left", "center"] as const, "center") === "left";
  return (
    <div className={`mx-auto max-w-2xl px-5 ${left ? "text-left" : "text-center"}`}>
      <p className="sf-eyebrow">Our story</p>
      {heading && <h2 className="mt-3 text-3xl font-medium leading-tight tracking-tight" {...ed("brand_story.heading")}>{heading}</h2>}
      {body && <p className="mt-5 text-lg leading-relaxed text-muted" {...ed("brand_story.body")}>{body}</p>}
    </div>
  );
}
