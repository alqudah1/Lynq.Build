"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { isItemActive } from "./NavList";
import { LogoutButton } from "./LogoutButton";
import type { NavItem } from "@/lib/dashboard/nav-items";

/**
 * Desktop-only top bar (UI/UX refinement pass) — contextual page title
 * (derived from the active nav item, matching `NavList`'s own active-item
 * logic exactly rather than duplicating it), a visual-only search
 * affordance, and a compact user menu. Deliberately does **not** include a
 * global "primary create action": every list page already has its own
 * correctly-scoped create control (new project, new contact, new
 * pipeline, ...); a second, generically-routed create button here would
 * either duplicate that or be non-functional, and the pass's own
 * instruction is explicit — "do not add nonfunctional controls."
 *
 * The search input is real but intentionally `disabled` — it renders the
 * affordance the design asked for without pretending a search backend
 * exists (none does yet); a disabled control reads honestly as "not yet
 * wired up" rather than silently doing nothing on submit.
 */
export function TopBar({ navItems, dashboardHref, user }: { navItems: NavItem[]; dashboardHref: string; user: { name: string | null; email: string } }) {
  const pathname = usePathname();
  const activeItem = navItems.find((item) => item.href && isItemActive(item.href, pathname, dashboardHref));
  const title = activeItem?.label ?? "Dashboard";

  return (
    <header className="lynq-glass hidden items-center justify-between gap-6 border-b border-glass-border px-8 py-4 md:flex">
      <h1 className="text-sm font-medium tracking-[0.02em] text-foreground">{title}</h1>

      <div className="flex flex-1 items-center justify-end gap-4">
        <div className="relative w-full max-w-xs">
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle">
            ⌕
          </span>
          <input
            type="search"
            disabled
            aria-label="Search (coming soon)"
            placeholder="Search…"
            className="lynq-transition h-9 w-full rounded-sm border border-border bg-elevated py-1.5 pl-9 pr-3 text-sm text-foreground placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60"
          />
          <kbd aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm border border-border px-1.5 py-0.5 text-[0.6rem] text-subtle">
            ⌘K
          </kbd>
        </div>

        <UserMenu user={user} />
      </div>
    </header>
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
