import clsx from "clsx";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

const BASE =
  "group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium transition-[background-color,color,box-shadow] duration-instant ease-settle";
const IDLE = "text-fg-2 hover:bg-sunken hover:text-fg";
const ACTIVE = "bg-raised text-fg shadow-elev-1 ring-1 ring-line";

function Mark({ active }: { active?: boolean }) {
  return <span aria-hidden className={clsx("h-3.5 w-3.5 shrink-0 rounded-[4px] border-[1.5px]", active ? "border-corona" : "border-fg-3/70")} />;
}

/** Sidebar item. Active = raised + hairline + a Corona mark, never a heavy black block. */
export function NavItem({ to, children, badge, onNavigate }: { to: string; children: ReactNode; badge?: ReactNode; onNavigate?: () => void }) {
  return (
    <NavLink to={to} onClick={onNavigate} className={({ isActive }) => clsx(BASE, isActive ? ACTIVE : IDLE)}>
      {({ isActive }) => (
        <>
          <Mark active={isActive} />
          <span className="truncate">{children}</span>
          {badge}
        </>
      )}
    </NavLink>
  );
}

export function ExternalNavItem({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={clsx(BASE, IDLE)}>
      <Mark />
      <span className="truncate">{children}</span>
    </a>
  );
}

/** Count bubble for a nav item (e.g. pending approvals). Corona because it asks for attention. */
export function NavCount({ n }: { n: number }) {
  return <span className="ml-auto rounded-full bg-corona px-1.5 text-[11px] font-medium leading-[18px] text-corona-on tabular-nums">{n}</span>;
}
