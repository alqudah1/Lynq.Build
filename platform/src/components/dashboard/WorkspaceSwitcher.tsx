"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { WorkspaceSwitcherItem } from "@/lib/dashboard/view-models";

/**
 * Displays only workspaces the server resolved via `listWorkspacesForUser`,
 * filtered to the current organization (Step 5A) — organization membership
 * alone never makes a workspace appear here, including for org owners/
 * admins who hold no explicit workspace membership of their own; the
 * server-side resolver already excludes those, this component just renders
 * whatever (possibly empty) list it was given.
 *
 * The "current" workspace is derived from the URL (`usePathname`), not a
 * server-passed prop — the workspace slug is one route segment deeper
 * than the layout that renders this switcher, so that layout has no
 * reliable way to know it itself. Reading it from the live pathname keeps
 * highlighting correct without threading it through every intermediate
 * layout.
 */
export function WorkspaceSwitcher({
  organizationSlug,
  workspaces,
}: {
  organizationSlug: string;
  workspaces: WorkspaceSwitcherItem[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const pathname = usePathname();
  const currentSlug = pathname.split("/")[3] ?? null;
  const current = workspaces.find((ws) => ws.slug === currentSlug) ?? null;

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

  if (workspaces.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="px-3 py-2 text-xs text-subtle">No workspaces assigned</p>
        <Link
          href={`/app/${organizationSlug}/workspaces/new`}
          className="lynq-transition flex min-h-11 items-center rounded-sm border border-border px-3 text-sm text-foreground hover:border-border-strong"
        >
          + New workspace
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
        <span className="truncate">{current?.name ?? "Select workspace"}</span>
        <span aria-hidden="true" className="text-subtle">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open ? (
        <ul id={menuId} role="menu" aria-label="Workspaces" className="lynq-glass-strong absolute z-20 mt-1.5 w-full rounded-md p-1 shadow-md motion-safe:animate-[lynq-fade-in_120ms_var(--lynq-ease)]">
          {workspaces.map((ws) => (
            <li key={ws.slug} role="none">
              <Link
                role="menuitem"
                href={`/app/${organizationSlug}/${ws.slug}`}
                aria-current={ws.slug === currentSlug ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="lynq-transition flex min-h-11 items-center justify-between rounded-sm px-3 py-2 text-sm text-foreground hover:bg-white/[0.05] aria-[current=page]:bg-glass-strong aria-[current=page]:text-accent-foreground"
              >
                <span className="truncate">{ws.name}</span>
                <span className="text-[0.65rem] uppercase tracking-[0.1em] text-subtle">{ws.role}</span>
              </Link>
            </li>
          ))}
          <li role="none" className="mt-1 border-t border-border pt-1">
            <Link
              role="menuitem"
              href={`/app/${organizationSlug}/workspaces/new`}
              onClick={() => setOpen(false)}
              className="lynq-transition flex min-h-11 items-center rounded-sm px-3 py-2 text-sm text-foreground hover:bg-white/[0.05]"
            >
              + New workspace
            </Link>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
