import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import NovaGuideWidget from "./NovaGuideWidget";
import NovaTourFinale from "./NovaTourFinale";
import { ExternalNavItem, NavCount, NavItem } from "./ui";
import { listProposals } from "../api/client";
import { useAuth } from "../lib/auth";
import { liveStorefrontUrl } from "../lib/storefrontUrl";

interface NavEntry {
  label: string;
  to: string;
  external?: boolean;
  /** The one external link whose href depends on the signed-in user's own org slug — computed
   * at render time rather than baked into this static list. */
  isLiveStorefrontLink?: boolean;
}

interface NavGroup {
  label: string;
  items: NavEntry[];
}

// Grouped around how a business owner thinks about their store, not around CRUD entities
// (ARCHITECTURE.md "Navigation regrouping" — Home / Commerce / Grow / Store / NOVA / Settings).
const NAV_GROUPS: NavGroup[] = [
  { label: "Home", items: [{ label: "Command Center", to: "/overview" }] },
  {
    label: "Commerce",
    items: [
      { label: "Products", to: "/products" },
      { label: "Inventory", to: "/inventory" },
      { label: "Orders", to: "/orders" },
      { label: "Customers", to: "/customers" },
    ],
  },
  {
    label: "Grow",
    items: [
      { label: "Analytics", to: "/analytics" },
      { label: "Marketing", to: "/marketing" },
    ],
  },
  {
    label: "Store",
    items: [
      { label: "Storefront ↗", to: "http://localhost:5174/", external: true, isLiveStorefrontLink: true },
      { label: "Store Builder", to: "/store-builder" },
    ],
  },
  {
    label: "NOVA",
    items: [
      { label: "AI Workspace", to: "/ai-workspace" },
      { label: "Photo Studio", to: "/photo-studio" },
      { label: "Approvals", to: "/approvals" },
      { label: "Activity", to: "/activity" },
    ],
  },
  { label: "Settings", items: [{ label: "Settings", to: "/settings" }] },
];

const PAGE_TITLES: Record<string, string> = Object.fromEntries([
  ...NAV_GROUPS.flatMap((g) => g.items.filter((i) => !i.external).map((i) => [i.to, i.label])),
  ["/create-store", "Create My Store"],
]);

function initials(name: string | undefined): string {
  return (name ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  // The same real proposals the Approvals page lists — the count is never decorative.
  const { data: proposals } = useQuery({ queryKey: ["proposals"], queryFn: () => listProposals() });
  const pending = proposals?.filter((p) => p.status === "proposed").length ?? 0;

  return (
    <div className="flex h-full flex-col gap-5 px-4 py-5">
      <Link to="/overview" onClick={onNavigate} className="flex items-center gap-2.5 px-2.5" aria-label="NOVA home">
        <span aria-hidden className="h-3 w-3 rounded-full bg-corona shadow-glow" />
        <span className="text-[17px] font-semibold tracking-tight">NOVA</span>
      </Link>

      <nav aria-label="Primary" className="flex-1 space-y-5 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="eyebrow mb-1 px-2.5 !text-[10px]">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) =>
                item.external ? (
                  <ExternalNavItem key={item.to} href={item.isLiveStorefrontLink ? liveStorefrontUrl(user?.org_slug) : item.to}>
                    {item.label}
                  </ExternalNavItem>
                ) : (
                  <NavItem
                    key={item.to}
                    to={item.to}
                    onNavigate={onNavigate}
                    badge={item.to === "/approvals" && pending > 0 ? <NavCount n={pending} /> : undefined}
                  >
                    {item.label}
                  </NavItem>
                ),
              )}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-3 rounded-lg bg-sunken px-3 py-2.5">
        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-inverse text-xs font-medium text-inverse-on">
          {initials(user?.full_name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium leading-tight">{user?.full_name}</p>
          <p className="text-[11px] capitalize leading-tight text-fg-3">{user?.role}</p>
        </div>
        <button onClick={() => void logout()} className="rounded-md px-1.5 py-1 text-xs text-fg-3 hover:bg-raised hover:text-fg">
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function AppLayout() {
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const title = PAGE_TITLES[location.pathname] ?? "";

  // Close the mobile drawer on any navigation (including the Guide navigating by itself).
  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className="flex min-h-screen">
      {/* Desktop rail: 248px. Below md it becomes a drawer opened from the header. */}
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 border-r border-line bg-raised md:block">
        <Sidebar />
      </aside>

      {navOpen && (
        <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button aria-label="Close navigation" className="absolute inset-0 bg-fg/30" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[280px] border-r border-line bg-raised shadow-float">
            <Sidebar onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-line bg-raised/90 px-4 backdrop-blur md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="grid h-9 w-9 place-items-center rounded-md border border-line-strong text-fg-2 hover:bg-sunken md:hidden"
              aria-label="Open navigation"
              onClick={() => setNavOpen(true)}
            >
              <span aria-hidden className="block h-0.5 w-4 bg-current shadow-[0_5px_0_currentColor,0_-5px_0_currentColor]" />
            </button>
            <p className="truncate text-[13px] text-fg-3">
              Workspace <span className="px-1 text-line-strong">/</span> <span className="font-medium text-fg">{title}</span>
            </p>
          </div>
          <a href="/" className="shrink-0 text-[13px] text-fg-3 hover:text-fg">
            Watch NOVA in action
          </a>
        </header>

        <main className={`mx-auto w-full flex-1 px-4 pb-28 pt-6 md:px-8 md:pt-8 ${location.pathname.startsWith("/store-builder") ? "max-w-none" : "max-w-[1200px]"}`}>
          <Outlet />
        </main>
      </div>

      {/* Global and persistent across every route — docked bottom-right by default, springs up
          into the full guide box the instant a real onboarding step is available (see
          NovaGuideWidget.tsx), then docks back down as an ordinary help/FAQ chat once every
          server-defined step is done. Rendered once here rather than per-page, so it survives
          cross-page navigation. The app chrome is never blurred or disabled. */}
      <NovaGuideWidget />
      <NovaTourFinale />
    </div>
  );
}
