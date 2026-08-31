"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { isItemActive } from "./NavList";
import { LogoutButton } from "./LogoutButton";
import type { NavItem } from "@/lib/dashboard/nav-items";

const SECTION_LABELS: Record<string, string> = {
  "workflow-executions": "Automation runs",
  workflows: "Automations",
  projects: "Projects",
  marketing: "Marketing",
  crm: "Customers",
  sales: "Sales",
  communications: "Inbox",
  analytics: "Reports",
  members: "Team",
  integrations: "Connected Apps",
  settings: "Settings",
};

function getPageContext(pathname: string, dashboardHref: string, navItems: NavItem[]) {
  const activeItem = navItems.find((item) => item.href && isItemActive(item.href, pathname, dashboardHref));
  const routeParts = pathname.slice(dashboardHref.length).split("/").filter(Boolean);
  const section = routeParts[0];
  const isDeepPage = routeParts.length > 1;
  const title = activeItem?.label ?? (section ? SECTION_LABELS[section] : undefined) ?? "Office";
  const sectionHref = section === "workflow-executions" ? `${dashboardHref}/workflows` : section ? `${dashboardHref}/${section}` : dashboardHref;
  return { activeItem, isDeepPage, sectionHref, title };
}

/**
 * Desktop-only top bar (UI/UX refinement pass) — contextual page title
 * (derived from the active nav item, matching `NavList`'s own active-item
 * logic exactly rather than duplicating it) and a compact user menu.
 * Deliberately does **not** include a
 * global "primary create action": every list page already has its own
 * correctly-scoped create control (new project, new contact, new
 * pipeline, ...); a second, generically-routed create button here would
 * either duplicate that or be non-functional, and the pass's own
 * instruction is explicit — "do not add nonfunctional controls."
 *
 */
export function TopBar({ navItems, dashboardHref, user }: { navItems: NavItem[]; dashboardHref: string; user: { name: string | null; email: string } }) {
  const pathname = usePathname();
  const { activeItem, isDeepPage, sectionHref, title } = getPageContext(pathname, dashboardHref, navItems);
  const parentLabel = activeItem?.label ?? title;

  return (
    <header className="lynq-glass hidden items-center justify-between gap-6 border-b border-glass-border px-8 py-3 md:flex">
      <div className="flex min-w-0 items-center gap-3">
        {pathname !== dashboardHref ? (
          <Link href={isDeepPage ? sectionHref : dashboardHref} className="lynq-transition inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-elevated px-3 text-xs font-medium text-foreground hover:border-border-strong">
            <span aria-hidden="true">←</span>
            Back to {isDeepPage ? parentLabel : "Office"}
          </Link>
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">{title}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {pathname !== dashboardHref ? <Link href={dashboardHref} className="lynq-transition min-h-9 rounded-md px-3 py-2 text-xs font-medium text-muted hover:bg-accent-wash hover:text-foreground">Office home</Link> : null}
        <UserMenu user={user} />
      </div>
    </header>
  );
}

export function MobileTopBar({ navItems, dashboardHref }: { navItems: NavItem[]; dashboardHref: string }) {
  const pathname = usePathname();
  const { isDeepPage, sectionHref, title } = getPageContext(pathname, dashboardHref, navItems);
  const backHref = isDeepPage ? sectionHref : dashboardHref;

  return (
    <div className="flex min-w-0 items-center gap-3">
      {pathname !== dashboardHref ? (
        <Link href={backHref} aria-label={`Back to ${isDeepPage ? title : "Office"}`} className="lynq-transition inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-elevated text-foreground hover:border-border-strong">
          <span aria-hidden="true">←</span>
        </Link>
      ) : null}
      <div className="min-w-0">
        <p className="font-serif text-base italic font-light text-foreground">LYNQ</p>
        <p className="truncate text-xs text-subtle">{title}</p>
      </div>
    </div>
  );
}

function UserMenu({ user }: { user: { name: string | null; email: string } }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const initial = (user.name ?? user.email).trim().charAt(0).toUpperCase();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="lynq-transition flex h-9 w-9 items-center justify-center rounded-full border border-border bg-elevated text-xs font-medium text-foreground hover:border-border-strong"
      >
        <span aria-hidden="true">{initial}</span>
        <span className="sr-only">Account menu for {user.name ?? user.email}</span>
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label="Account" className="lynq-menu-surface absolute right-0 z-20 mt-2 w-56 rounded-md p-3 shadow-md motion-safe:animate-[lynq-fade-in_120ms_var(--lynq-ease)]">
          <div className="border-b border-border px-1 pb-3">
            <p className="truncate text-sm text-foreground">{user.name ?? user.email}</p>
            <p className="truncate text-xs text-subtle">{user.email}</p>
          </div>
          <div className="pt-3">
            <LogoutButton />
          </div>
        </div>
      ) : null}
    </div>
  );
}
