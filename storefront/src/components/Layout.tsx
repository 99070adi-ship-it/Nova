import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cartCount, useCart } from "../lib/cart";
import { themeStyle, webFontHref, resolveTheme } from "../lib/theme";
import { useWishlist } from "../lib/wishlist";
import { ed } from "../editor/ed";
import { insideBuilder } from "../editor/protocol";
import SLink, { useStoreNav } from "./SLink";
import { useStore } from "./StoreContext";

function useWebFont(fontStack: string) {
  useEffect(() => {
    const href = webFontHref(fontStack);
    if (!href) return;
    let link = document.querySelector<HTMLLinkElement>("link[data-sf-font]");
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.setAttribute("data-sf-font", "");
      document.head.appendChild(link);
    }
    link.href = href;
  }, [fontStack]);
}

export default function Layout({ children }: { children: ReactNode }) {
  const { info, storefront, preview, editor } = useStore();
  // Inside Store Builder the admin shows its own "draft preview" label, so the storefront's banner steps aside.
  const inBuilder = insideBuilder(editor, preview);
  const tokens = storefront?.theme;
  useWebFont(resolveTheme(tokens).font);
  // The theme also goes on <html>, so the page background, overscroll area and anything outside the layout match it.
  useEffect(() => {
    const root = document.documentElement;
    const vars = themeStyle(tokens) as Record<string, string>;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.buttonStyle = resolveTheme(tokens).buttonStyle;
    return () => {
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
      delete root.dataset.buttonStyle;
    };
  }, [tokens]);
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const nav = useStoreNav();
  const count = cartCount(useCart());
  const saved = useWishlist().length;
  const [q, setQ] = useState("");

  useEffect(() => setMenu(false), [location.pathname]);

  const pages = (storefront?.pages ?? []).filter((p) => p.slug !== "home").sort((a, b) => a.order - b.order);
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    navigate(nav(`/products${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`));
  };

  return (
    <div style={themeStyle(tokens)} className="flex min-h-screen flex-col bg-canvas font-body text-ink">
      {preview && !inBuilder && (
        <div role="status" className="bg-ink px-4 py-2 text-center text-xs font-medium uppercase tracking-label text-ink-on">
          Preview — draft, not live · orders can't be placed here
        </div>
      )}
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-ink focus:px-3 focus:py-2 focus:text-ink-on">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur" {...ed("theme.style")}>
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-4">
          <button type="button" className="md:hidden" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <SLink to="/" className="text-lg font-semibold tracking-tight">{info.store_name}</SLink>
          <nav aria-label="Primary" className="ml-6 hidden items-center gap-6 text-sm text-muted md:flex">
            <SLink to="/products" className="hover:text-ink">Shop</SLink>
            {pages.map((p) => <SLink key={p.slug} to={`/pages/${p.slug}`} className="hover:text-ink">{p.title}</SLink>)}
          </nav>
          <form onSubmit={onSearch} role="search" className="ml-auto hidden max-w-xs flex-1 md:block">
            <label htmlFor="sf-search" className="sr-only">Search products</label>
            <input id="sf-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="sf-input !rounded-full !py-2" />
          </form>
          <div className="ml-auto flex items-center gap-4 text-sm md:ml-0">
            <SLink to="/wishlist" className="relative hover:opacity-70" aria-label={`Saved items${saved ? `, ${saved}` : ""}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 20.5S4 15.4 4 9.6C4 7 6 5 8.4 5c1.5 0 2.8.8 3.6 2 .8-1.2 2.1-2 3.6-2C18 5 20 7 20 9.6c0 5.8-8 10.9-8 10.9z" /></svg>
              {saved > 0 && <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] text-ink-on">{saved}</span>}
            </SLink>
            <SLink to="/cart" className="relative hover:opacity-70" aria-label={`Cart${count ? `, ${count} items` : ""}`} data-testid="cart-link">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8zM9 8V6a3 3 0 0 1 6 0v2" /></svg>
              {count > 0 && <span data-testid="cart-count" className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] text-ink-on">{count}</span>}
            </SLink>
          </div>
        </div>
        {menu && (
          <nav aria-label="Mobile" className="border-t border-line px-5 py-4 md:hidden">
            <form onSubmit={onSearch} role="search" className="mb-4">
              <label htmlFor="sf-search-m" className="sr-only">Search products</label>
              <input id="sf-search-m" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="sf-input" />
            </form>
            <ul className="space-y-3 text-sm">
              <li><SLink to="/products">Shop</SLink></li>
              {pages.map((p) => <li key={p.slug}><SLink to={`/pages/${p.slug}`}>{p.title}</SLink></li>)}
              <li><SLink to="/wishlist">Saved items</SLink></li>
              <li><SLink to="/orders">Find an order</SLink></li>
            </ul>
          </nav>
        )}
      </header>
      <main id="main" className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

function Footer() {
  const { info, collections, storefront } = useStore();
  const pages = (storefront?.pages ?? []).filter((p) => p.slug !== "home");
  return (
    <footer className="mt-24 border-t border-line bg-surface" {...ed("theme.style")}>
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 text-sm md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="text-lg font-semibold">{info.store_name}</p>
          <p className="mt-3 max-w-sm text-muted">Browse the collection, save what you love and check out in a few steps.</p>
        </div>
        <div>
          <p className="sf-eyebrow">Shop</p>
          <ul className="mt-3 space-y-2 text-muted">
            <li><SLink to="/products" className="hover:text-ink">All products</SLink></li>
            {collections.slice(0, 6).map((c) => <li key={c.id}><SLink to={`/collections/${c.slug}`} className="hover:text-ink">{c.title}</SLink></li>)}
          </ul>
        </div>
        <div>
          <p className="sf-eyebrow">Help</p>
          <ul className="mt-3 space-y-2 text-muted">
            {pages.map((p) => <li key={p.slug}><SLink to={`/pages/${p.slug}`} className="hover:text-ink">{p.title}</SLink></li>)}
            <li><SLink to="/orders" className="hover:text-ink">Find an order</SLink></li>
            <li><SLink to="/wishlist" className="hover:text-ink">Saved items</SLink></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line px-5 py-5 text-center text-xs text-muted">
        {info.demo_checkout && <p>This is a demo store. Checkout creates a demo order: no payment is taken and nothing ships.</p>}
        <p className="mt-1">© {new Date().getFullYear()} {info.store_name}</p>
      </div>
    </footer>
  );
}
