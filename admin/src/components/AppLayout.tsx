import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router-dom";
import clsx from "clsx";
import NovaGuideWidget from "./NovaGuideWidget";
import { getOnboardingProgress } from "../api/client";
import { useAuth } from "../lib/auth";
import { liveStorefrontUrl } from "../lib/storefrontUrl";

interface NavItem {
  label: string;
  to: string;
  external?: boolean;
  /** The one external link whose href depends on the signed-in user's own org slug — computed
   * at render time (see AppLayout's own render) rather than baked into this static list. */
  isLiveStorefrontLink?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// Grouped around how a business owner thinks about their store, not around CRUD entities
// (ARCHITECTURE.md "Navigation regrouping" — Home / Commerce / Grow / Store / NOVA / Settings).
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Home",
    items: [{ label: "Store Overview", to: "/overview" }],
  },
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
      { label: "Storefront", to: "http://localhost:5174/", external: true, isLiveStorefrontLink: true },
      { label: "Store Builder", to: "/store-builder" },
    ],
  },
  {
    label: "NOVA",
    items: [
      { label: "AI Workspace", to: "/ai-workspace" },
      { label: "Approvals", to: "/approvals" },
      { label: "Activity", to: "/activity" },
    ],
  },
  {
    label: "Settings",
    items: [{ label: "Settings", to: "/settings" }],
  },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  // The whole-onboarding-workflow setup: while a real step is in progress, everything that isn't
  // the current task — the nav sidebar, the header — blurs and goes inert, the same focus
  // treatment NovaGuideWidget's own NovaSpotlight already gives one element during an active
  // demonstration, just applied at the layout level for the full pipeline, every step, not only
  // one lesson. `<main>` (whatever task is actually on screen) is never touched by this — it's
  // the one thing that's supposed to stay in focus.
  const { data: progress } = useQuery({ queryKey: ["onboarding-progress"], queryFn: getOnboardingProgress });
  const inWorkflow = !!progress && progress.current_step !== null;
  const chromeClass = clsx(
    "transition-[filter,opacity] duration-500",
    inWorkflow && "pointer-events-none blur-sm opacity-50",
  );

  return (
    <div className="flex min-h-screen">
      <aside className={clsx("w-56 shrink-0 border-r border-neutral-200 bg-white px-3 py-4", chromeClass)}>
        <div className="mb-6 px-2">
          <span className="text-sm font-semibold">NOVA</span>
        </div>
        <nav className="space-y-5">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) =>
                  item.external ? (
                    <a
                      key={item.to}
                      href={item.isLiveStorefrontLink ? liveStorefrontUrl(user?.org_slug) : item.to}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-md px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
                    >
                      {item.label} ↗
                    </a>
                  ) : (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        clsx(
                          "block rounded-md px-2 py-1.5 text-sm",
                          isActive ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100",
                        )
                      }
                    >
                      {item.label}
                    </NavLink>
                  ),
                )}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className={clsx("flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3", chromeClass)}>
          <a href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
            Watch NOVA in action
          </a>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-600">{user?.full_name}</span>
            <button onClick={() => void logout()} className="text-neutral-500 hover:text-neutral-900">
              Sign out
            </button>
          </div>
        </header>
        <main className="p-6">
          <Outlet />
        </main>
      </div>
      {/* Global and persistent across every route — docked bottom-right by default, bounces up
          into the full guide box the instant a real onboarding step is available (see
          NovaGuideWidget.tsx), then docks back down as an ordinary help/FAQ chat once the whole
          ten-step tour is done. Rendered once here rather than per-page, so it survives the
          cross-page navigation the tour itself now drives. */}
      <NovaGuideWidget />
    </div>
  );
}
