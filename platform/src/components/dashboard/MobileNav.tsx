"use client";

import { useEffect, useRef, useState } from "react";
import { OrganizationSwitcher } from "./OrganizationSwitcher";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { NavList } from "./NavList";
import { LogoutButton } from "./LogoutButton";
import type { SidebarProps } from "./Sidebar";

/**
 * Mobile drawer (Step 5A) — same information hierarchy as the desktop
 * sidebar (organization switcher, workspace switcher, primary nav, account
 * controls), no hover-dependent controls, every interactive target at
 * least 44px (`min-h-11 min-w-11`). Escape closes and returns focus to the
 * trigger button; opening moves focus to the drawer's close button; body
 * scroll is locked while open.
 */
export function MobileNav({ user, organizations, currentOrganizationSlug, workspaces, navItems, dashboardHref, isLeadership = true }: SidebarProps) {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    if (open) closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function closeAndReturnFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="md:hidden">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="mobile-dashboard-nav"
        onClick={() => setOpen(true)}
        className="lynq-transition flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-border text-foreground hover:border-border-strong"
      >
        <span className="sr-only">Open navigation menu</span>
        <span aria-hidden="true">☰</span>
      </button>

      {open ? (
        <div id="mobile-dashboard-nav" role="dialog" aria-modal="true" aria-label="Navigation" className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#0b0b0c] text-foreground shadow-2xl motion-safe:animate-[lynq-fade-in_150ms_var(--lynq-ease)]">
          <div className="flex items-center justify-between border-b border-border p-4">
            <span className="text-xs uppercase tracking-[0.2em] text-subtle">Menu</span>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeAndReturnFocus}
              className="lynq-transition flex min-h-11 min-w-11 items-center justify-center rounded-sm text-foreground hover:bg-white/[0.06]"
            >
              <span className="sr-only">Close navigation menu</span>
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
            {organizations.length > 1 ? <div className="flex flex-col gap-2">
              <span className="px-3 text-[0.65rem] uppercase tracking-[0.2em] text-subtle">Organization</span>
              <OrganizationSwitcher organizations={organizations} currentSlug={currentOrganizationSlug} />
            </div> : null}
            {currentOrganizationSlug && isLeadership && workspaces.length > 1 ? (
              <div className="flex flex-col gap-2">
                <span className="px-3 text-[0.65rem] uppercase tracking-[0.2em] text-subtle">Workspace</span>
                <WorkspaceSwitcher organizationSlug={currentOrganizationSlug} workspaces={workspaces} />
              </div>
            ) : null}
            <nav aria-label="Primary">
              <NavList items={navItems} dashboardHref={dashboardHref} onNavigate={closeAndReturnFocus} />
            </nav>
            <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
              <div className="px-3">
                <p className="truncate text-sm text-foreground">{user.name ?? user.email}</p>
                <p className="truncate text-xs text-subtle">{user.email}</p>
              </div>
              <LogoutButton />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
