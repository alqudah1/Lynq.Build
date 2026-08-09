"use client";

import { useState } from "react";
import Link from "next/link";
import { OrganizationSwitcher } from "./OrganizationSwitcher";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { NavList } from "./NavList";
import { LogoutButton } from "./LogoutButton";
import type { OrganizationSwitcherItem, WorkspaceSwitcherItem } from "@/lib/dashboard/view-models";
import type { NavItem } from "@/lib/dashboard/nav-items";

export interface SidebarProps {
  user: { name: string | null; email: string };
  organizations: OrganizationSwitcherItem[];
  currentOrganizationSlug: string | null;
  workspaces: WorkspaceSwitcherItem[];
  navItems: NavItem[];
  dashboardHref: string;
}

/**
 * Desktop persistent sidebar (Step 5A, restyled in the UI/UX refinement
 * pass). `<aside>` is the landmark for the whole panel; `<nav
 * aria-label="Primary">` scopes only the actual navigation links inside it
 * — the switchers and account controls are real, interactive, but not
 * "navigation" in the landmark sense. Collapse state is local, visual-only
 * UI state (never persisted server-side, never affects data or routing) —
 * collapsing hides labels/switchers down to an icon-only rail; the org/
 * workspace switchers and account block stay reachable via the "Expand"
 * toggle, never hidden without a way back.
 */
export function Sidebar({ user, organizations, currentOrganizationSlug, workspaces, navItems, dashboardHref }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      aria-label="Dashboard sidebar"
      className={`lynq-glass lynq-transition hidden shrink-0 flex-col gap-6 border-r border-glass-border p-4 md:flex ${collapsed ? "w-[4.5rem] items-center px-2" : "w-64"}`}
    >
      <div className="flex w-full items-center justify-between gap-2 px-1">
        <Link href={dashboardHref} className="lynq-transition flex items-center gap-2 text-foreground hover:opacity-85" aria-label="LYNQ dashboard home">
          <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-accent/30 bg-accent-wash font-serif text-sm italic text-accent-foreground">
            L
          </span>
          {!collapsed ? <span className="font-serif text-lg italic font-light">LYNQ</span> : null}
        </Link>
        {!collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="lynq-transition flex h-7 w-7 items-center justify-center rounded-sm text-subtle hover:bg-white/[0.06] hover:text-foreground"
            aria-label="Collapse sidebar"
          >
            <span aria-hidden="true">«</span>
          </button>
        ) : null}
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="lynq-transition flex h-9 w-9 items-center justify-center rounded-sm text-subtle hover:bg-white/[0.06] hover:text-foreground"
          aria-label="Expand sidebar"
        >
          <span aria-hidden="true">»</span>
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="px-3 text-[0.65rem] uppercase tracking-[0.2em] text-subtle">Organization</span>
          <OrganizationSwitcher organizations={organizations} currentSlug={currentOrganizationSlug} />
        </div>
      )}

      {!collapsed && currentOrganizationSlug ? (
        <div className="flex flex-col gap-2">
          <span className="px-3 text-[0.65rem] uppercase tracking-[0.2em] text-subtle">Workspace</span>
          <WorkspaceSwitcher organizationSlug={currentOrganizationSlug} workspaces={workspaces} />
        </div>
      ) : null}

      <nav aria-label="Primary" className={collapsed ? "w-full" : "w-full flex-1 overflow-y-auto"}>
        <NavList items={navItems} dashboardHref={dashboardHref} collapsed={collapsed} />
      </nav>

      <div className={`mt-auto flex w-full flex-col gap-2 border-t border-border pt-4 ${collapsed ? "items-center" : ""}`}>
        {!collapsed ? (
          <div className="px-3">
            <p className="truncate text-sm text-foreground">{user.name ?? user.email}</p>
            <p className="truncate text-xs text-subtle">{user.email}</p>
          </div>
        ) : null}
        <LogoutButton />
      </div>
    </aside>
  );
}
