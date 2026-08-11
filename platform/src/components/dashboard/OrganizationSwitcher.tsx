"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { OrganizationSwitcherItem } from "@/lib/dashboard/view-models";

/**
 * Displays only the organizations the server already resolved via
 * `listOrganizationsForUser` (Step 5A) — this component never fetches or
 * decides membership itself, it only renders what it was given. Switching
 * is a real navigation (`<Link>` to `/app/{slug}`), which re-runs the
 * server-side session/membership gate on the destination route — never a
 * client-side state change that could show org content without a fresh
 * server check.
 */
export function OrganizationSwitcher({
  organizations,
  currentSlug,
}: {
  organizations: OrganizationSwitcherItem[];
  currentSlug: string | null;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const current = organizations.find((org) => org.slug === currentSlug) ?? null;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  if (organizations.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="px-3 py-2 text-xs text-subtle">No organizations yet</p>
        <Link
          href="/app/new"
          className="lynq-transition flex min-h-11 items-center rounded-sm border border-border px-3 text-sm text-foreground hover:border-border-strong"
        >
          + New organization
        </Link>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="lynq-transition flex min-h-11 w-full items-center justify-between rounded-sm border border-border px-3 py-2 text-left text-sm text-foreground hover:border-border-strong"
      >
        <span className="truncate">{current?.name ?? "Select organization"}</span>
        <span aria-hidden="true" className="text-subtle">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open ? (
        <ul id={menuId} role="menu" aria-label="Organizations" className="lynq-menu-surface absolute z-20 mt-1.5 w-full rounded-md p-1 shadow-md motion-safe:animate-[lynq-fade-in_120ms_var(--lynq-ease)]">
          {organizations.map((org) => (
            <li key={org.slug} role="none">
              <Link
                role="menuitem"
                href={`/app/${org.slug}`}
                aria-current={org.slug === currentSlug ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="lynq-transition flex min-h-11 items-center justify-between rounded-sm px-3 py-2 text-sm text-foreground hover:bg-white/[0.05] aria-[current=page]:bg-glass-strong aria-[current=page]:text-accent-foreground"
              >
                <span className="truncate">{org.name}</span>
                <span className="text-[0.65rem] uppercase tracking-[0.1em] text-subtle">{org.role}</span>
              </Link>
            </li>
          ))}
          <li role="none" className="mt-1 border-t border-border pt-1">
            <Link
              role="menuitem"
              href="/app/new"
              onClick={() => setOpen(false)}
              className="lynq-transition flex min-h-11 items-center rounded-sm px-3 py-2 text-sm text-foreground hover:bg-white/[0.05]"
            >
              + New organization
            </Link>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
