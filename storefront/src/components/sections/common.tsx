import SLink from "../SLink";

export const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

/** A call-to-action target from published content: an internal path, or an https URL. Anything else is dropped, so a
 * section can never link to javascript: or another protocol. */
export function Cta({ text, href, className, onClick }: { text?: string; href?: string; className: string; onClick?: () => void }) {
  if (!text) return null;
  const target = !href || href === "/shop" ? "/products" : href;
  if (/^https:\/\//i.test(target)) return <a href={target} className={className} onClick={onClick} rel="noopener noreferrer">{text}</a>;
  if (!target.startsWith("/") || target.startsWith("//")) return null;
  return <SLink to={target} className={className} onClick={onClick}>{text}</SLink>;
}
