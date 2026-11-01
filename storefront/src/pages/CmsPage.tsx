import { useParams } from "react-router-dom";
import SectionRenderer from "../components/SectionRenderer";
import { useStore } from "../components/StoreContext";
import NotFound from "./NotFound";
import { useTitle } from "../lib/useTitle";

/** Any additional page published from Store Builder (e.g. "Our story"). */
export default function CmsPage() {
  const { slug } = useParams<{ slug: string }>();
  const { storefront, info } = useStore();
  const page = storefront?.pages.find((p) => p.slug === slug && p.slug !== "home");
  useTitle(page ? `${page.title} | ${info.store_name}` : undefined);
  if (!page) return <NotFound />;
  return <div>{page.sections.slice().sort((a, b) => a.order - b.order).map((s, i) => <SectionRenderer key={`${s.type}-${i}`} section={s} />)}</div>;
}
