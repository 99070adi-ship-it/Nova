import { NavLink, Outlet } from "react-router-dom";
import clsx from "clsx";
import { useAuth } from "../lib/auth";

interface NavItem {
  label: string;
  to: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operate",
    items: [
      { label: "Overview", to: "/overview" },
      { label: "Products", to: "/products" },
      { label: "Inventory", to: "/inventory" },
      { label: "Orders", to: "/orders" },
      { label: "Customers", to: "/customers" },
      { label: "Marketing", to: "/marketing" },
    ],
  },
  {
    label: "Grow",
    items: [
      { label: "Analytics", to: "/analytics" },
      { label: "AI Workspace", to: "/ai-workspace" },
    ],
  },
  {
    label: "Store",
    items: [
      { label: "Store Builder", to: "/store-builder" },
      { label: "Storefront", to: "/storefront-preview" },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Activity", to: "/activity" },
      { label: "Settings", to: "/settings" },
    ],
  },
];

export default function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-neutral-200 bg-white px-3 py-4">
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
                {group.items.map((item) => (
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
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
          <div />
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
    </div>
  );
}
