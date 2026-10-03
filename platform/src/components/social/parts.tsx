import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";

/**
 * Small hook-free building blocks shared by the pass-2 Social pages (inbox,
 * analytics, advertising, connections, automation, settings). Same visual
 * language as the overview's KPI tiles and section headings.
 */

export function StatTile({ label, value, detail, tone }: { label: string; value: ReactNode; detail?: ReactNode; tone?: "danger" | "warning" }) {
  return (
    <Card padding="sm" className="flex flex-col gap-1">
      <span className="text-[0.65rem] uppercase tracking-[0.12em] text-subtle">{label}</span>
      <span className={`text-2xl ${tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-foreground"}`}>{value}</span>
      {detail ? <span className="text-xs text-subtle">{detail}</span> : null}
    </Card>
  );
}

export function SectionHeading({ id, children, action }: { id: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id={id} className="text-xs uppercase tracking-[0.1em] text-subtle">{children}</h2>
      {action}
    </div>
  );
}

/** A small neutral chip (env names, capabilities, pillars). */
export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "on" | "off" }) {
  const cls = tone === "on" ? "border-success/30 text-success" : tone === "off" ? "border-border text-subtle line-through decoration-subtle/60" : "border-border text-muted";
  return <span className={`inline-flex min-h-6 items-center rounded-sm border px-2 py-0.5 text-xs ${cls}`}>{children}</span>;
}

/**
 * A horizontal share-of-total meter. Only rendered for a real, known value
 * and a positive total — a missing number is never drawn as an empty bar.
 */
export function Meter({ value, total, label }: { value: number | null; total: number | null; label: string }) {
  if (value === null || total === null || total <= 0) return null;
  const pct = Math.max(0, Math.min(100, (value / total) * 100));
  return (
    <div className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-white/[0.08]" role="img" aria-label={`${label}: ${pct.toFixed(0)}% of total`}>
      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

export const LINK_BUTTON = "lynq-transition inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-5 text-xs font-medium uppercase tracking-[0.08em]";
export const CONTROL = "lynq-transition min-h-11 w-full rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground placeholder:text-subtle hover:border-border-strong focus-visible:border-accent/60";
export const FIELD_LABEL = "text-xs uppercase tracking-[0.1em] text-subtle";
