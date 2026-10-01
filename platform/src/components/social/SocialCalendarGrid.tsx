"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

export interface CalendarDay {
  key: string;
  weekday: string;
  dayNumber: number;
  label: string;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
}

export interface CalendarEntryView {
  variantId: string;
  contentItemId: string;
  title: string;
  platform: string;
  platformLabel: string;
  glyph: string;
  status: string;
  statusLabel: string;
  tone: string;
  dayKey: string;
  timeLabel: string;
  originalAt: string;
  revision: number;
  movable: boolean;
  pendingApproval: boolean;
  warningsCount: number;
  blocking: boolean;
  brandName: string | null;
  accountDisplayName: string | null;
  href: string;
}

export interface CalendarGapView {
  platform: string;
  platformLabel: string;
  createHref: string;
}

const TONE_CLASS: Record<string, string> = {
  neutral: "border-border text-muted",
  accent: "border-accent/30 bg-accent-wash text-foreground",
  success: "border-success/30 bg-success-wash text-success",
  warning: "border-warning/30 bg-warning-wash text-warning",
  danger: "border-danger/30 bg-danger-wash text-danger",
  info: "border-info/30 bg-info-wash text-info",
};

/**
 * The Social calendar grid (month / week / day). Drag a post onto another
 * day to move it — the post keeps its time of day; published and
 * publishing posts cannot move. Every move has a keyboard/touch fallback
 * (the "Move to" select). A post awaiting review can be approved right from
 * the calendar. All changes go through server actions; the grid re-renders
 * from the server afterwards, never from optimistic local state.
 */
export function SocialCalendarGrid({
  view,
  days,
  entries,
  gaps,
  reschedule,
  approve,
  canApprove,
}: {
  view: "day" | "week" | "month";
  days: CalendarDay[];
  entries: CalendarEntryView[];
  gaps: Record<string, CalendarGapView[]>;
  reschedule: (variantId: string, formData: FormData) => Promise<ActionResult>;
  approve: (variantId: string, formData: FormData) => Promise<ActionResult>;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const byDay = new Map<string, CalendarEntryView[]>();
  for (const e of entries) byDay.set(e.dayKey, [...(byDay.get(e.dayKey) ?? []), e]);
  const selected = entries.find((e) => e.variantId === selectedId) ?? null;

  function move(entry: CalendarEntryView, targetDate: string) {
    if (!entry.movable || targetDate === entry.dayKey) return;
    setResult(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("expectedRevision", String(entry.revision));
      fd.set("targetDate", targetDate);
      fd.set("originalAt", entry.originalAt);
      const outcome = await reschedule(entry.variantId, fd);
      setResult(outcome.ok ? { ok: true, message: `Moved “${entry.title}”.` } : outcome);
      router.refresh();
    });
  }

  function approveEntry(entry: CalendarEntryView) {
    setResult(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("expectedRevision", String(entry.revision));
      fd.set("decision", "approve");
      const outcome = await approve(entry.variantId, fd);
      setResult(outcome);
      router.refresh();
    });
  }

  function dropHandlers(dayKey: string) {
    return {
      onDragOver: (event: React.DragEvent) => {
        if (!event.dataTransfer.types.includes("application/x-lynq-variant")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dragOver !== dayKey) setDragOver(dayKey);
      },
      onDragLeave: () => setDragOver((current) => (current === dayKey ? null : current)),
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        setDragOver(null);
        const id = event.dataTransfer.getData("application/x-lynq-variant");
        const entry = entries.find((e) => e.variantId === id);
        if (entry) move(entry, dayKey);
      },
    };
  }

  function dragProps(entry: CalendarEntryView) {
    if (!entry.movable) return {};
    return {
      draggable: true,
      onDragStart: (event: React.DragEvent) => {
        event.dataTransfer.setData("application/x-lynq-variant", entry.variantId);
        event.dataTransfer.effectAllowed = "move";
      },
    };
  }

  function renderMove(entry: CalendarEntryView) {
    if (!entry.movable) return null;
    return (
      <label className="flex items-center gap-2 text-xs text-subtle">
        <span className="shrink-0">Move to</span>
        <select
          aria-label={`Move “${entry.title}” to another day`}
          value={entry.dayKey}
          disabled={isPending}
          onChange={(event) => move(entry, event.target.value)}
          className="min-h-9 min-w-0 flex-1 rounded-sm border border-border bg-elevated px-2 text-xs text-foreground"
        >
          {days.some((d) => d.key === entry.dayKey) ? null : <option value={entry.dayKey}>{entry.dayKey}</option>}
          {days.map((d) => (
            <option key={d.key} value={d.key} disabled={d.isPast && d.key !== entry.dayKey}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  function renderEntry(entry: CalendarEntryView) {
    return (
      <div {...dragProps(entry)} className={`flex flex-col gap-2 rounded-sm border bg-elevated p-2.5 ${entry.movable ? "cursor-grab active:cursor-grabbing" : ""} ${TONE_CLASS[entry.tone] ?? TONE_CLASS.neutral}`}>
        <Link href={entry.href} className="flex flex-col gap-0.5 text-foreground hover:underline">
          <span className="text-[0.65rem] uppercase tracking-[0.08em] text-subtle">{entry.timeLabel} · {entry.platformLabel}</span>
          <span className="line-clamp-2 text-sm">{entry.title}</span>
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 text-[0.65rem] uppercase tracking-[0.08em]">
          <span className={`rounded-sm border px-1.5 py-0.5 ${TONE_CLASS[entry.tone] ?? TONE_CLASS.neutral}`}>{entry.statusLabel}</span>
          {entry.blocking ? <span className="rounded-sm border border-danger/30 bg-danger-wash px-1.5 py-0.5 text-danger">Blocked</span> : entry.warningsCount ? <span className="text-warning">{entry.warningsCount} warning{entry.warningsCount === 1 ? "" : "s"}</span> : null}
          {entry.brandName ? <span className="normal-case tracking-normal text-subtle">{entry.brandName}</span> : null}
        </div>
        {renderMove(entry)}
        {entry.pendingApproval && canApprove ? (
          <button type="button" disabled={isPending || entry.blocking} onClick={() => approveEntry(entry)} className="min-h-9 rounded-sm bg-foreground px-3 text-[0.65rem] font-medium uppercase tracking-[0.08em] text-background hover:opacity-90 disabled:opacity-50">
            Approve
          </button>
        ) : null}
      </div>
    );
  }

  function renderGaps(dayKey: string, compact = false) {
    const list = gaps[dayKey] ?? [];
    if (!list.length) return null;
    if (compact) {
      return (
        <Link href={list[0].createHref} className="block rounded-sm border border-dashed border-border px-1.5 py-1 text-[0.65rem] text-subtle hover:border-border-strong hover:text-foreground" title={`No post planned on ${list.map((g) => g.platformLabel).join(", ")}`}>
          + Create
        </Link>
      );
    }
    return (
      <ul className="flex flex-col gap-1.5">
        {list.map((g) => (
          <li key={g.platform} className="flex min-h-11 items-center justify-between gap-2 rounded-sm border border-dashed border-border px-2.5 py-1.5 text-xs text-subtle">
            <span>No {g.platformLabel} post planned</span>
            <Link href={g.createHref} className="shrink-0 text-foreground hover:underline">+ Create</Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div aria-live="polite">
        {isPending ? <p className="text-xs text-subtle">Saving…</p> : null}
        {result ? <StatusMessage tone={result.ok ? "success" : "error"} message={result.ok ? (result.message ?? "Done.") : result.message} /> : null}
      </div>

      {view === "month" ? (
        <>
          <div className="overflow-x-auto">
            <div className="grid min-w-[44rem] grid-cols-7 overflow-hidden rounded-md border border-border">
              {days.slice(0, 7).map((d) => (
                <div key={`h-${d.key}`} aria-hidden="true" className="border-b border-border bg-elevated px-2 py-2 text-[0.65rem] uppercase tracking-[0.1em] text-subtle">{d.weekday}</div>
              ))}
              {days.map((d) => {
                const list = byDay.get(d.key) ?? [];
                return (
                  <div
                    key={d.key}
                    role="group"
                    aria-label={`${d.label}: ${list.length} post${list.length === 1 ? "" : "s"}`}
                    {...dropHandlers(d.key)}
                    className={`flex min-h-28 flex-col gap-1 border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0 ${d.inMonth ? "" : "bg-white/[0.015]"} ${dragOver === d.key ? "bg-accent-wash" : ""}`}
                  >
                    <span className={`text-xs ${d.isToday ? "font-semibold text-foreground" : d.inMonth ? "text-muted" : "text-subtle"}`}>
                      {d.dayNumber}
                      {d.isToday ? <span className="sr-only"> (today)</span> : null}
                    </span>
                    <ul className="flex flex-col gap-1">
                      {list.slice(0, 4).map((e) => (
                        <li key={e.variantId}>
                          <button
                            type="button"
                            {...dragProps(e)}
                            onClick={() => setSelectedId(e.variantId === selectedId ? null : e.variantId)}
                            aria-pressed={e.variantId === selectedId}
                            title={`${e.platformLabel} · ${e.statusLabel} · ${e.timeLabel}`}
                            className={`flex w-full items-center gap-1 truncate rounded-sm border px-1.5 py-1 text-left text-[0.7rem] ${TONE_CLASS[e.tone] ?? TONE_CLASS.neutral} ${e.variantId === selectedId ? "ring-1 ring-accent" : ""}`}
                          >
                            <span aria-hidden="true" className="shrink-0 font-semibold">{e.glyph}</span>
                            <span className="sr-only">{e.platformLabel}, {e.statusLabel}:</span>
                            <span className="truncate text-foreground">{e.title}</span>
                          </button>
                        </li>
                      ))}
                      {list.length > 4 ? <li className="text-[0.65rem] text-subtle">+{list.length - 4} more</li> : null}
                    </ul>
                    {!d.isPast ? renderGaps(d.key, true) : null}
                  </div>
                );
              })}
            </div>
          </div>
          {selected ? (
            <div className="flex flex-col gap-2 rounded-md border border-border-strong p-3 sm:max-w-md">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-[0.1em] text-subtle">Selected post</p>
                <button type="button" onClick={() => setSelectedId(null)} className="min-h-9 px-2 text-xs text-muted hover:text-foreground">Close</button>
              </div>
              {renderEntry(selected)}
            </div>
          ) : (
            <p className="text-xs text-subtle">Drag a post to another day, or select it to move or approve it.</p>
          )}
        </>
      ) : (
        <div className={view === "week" ? "grid gap-3 md:grid-cols-7" : "flex flex-col gap-3"}>
          {days.map((d) => {
            const list = byDay.get(d.key) ?? [];
            return (
              <section
                key={d.key}
                aria-label={d.label}
                {...dropHandlers(d.key)}
                className={`flex min-w-0 flex-col gap-2 rounded-md border p-2 ${d.isToday ? "border-border-strong" : "border-border"} ${dragOver === d.key ? "bg-accent-wash" : ""}`}
              >
                <h3 className={`text-xs uppercase tracking-[0.1em] ${d.isToday ? "text-foreground" : "text-subtle"}`}>{d.label}{d.isToday ? " · Today" : ""}</h3>
                {list.length ? (
                  <ul className="flex flex-col gap-2">
                    {list.map((e) => (
                      <li key={e.variantId}>
                        {renderEntry(e)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!d.isPast ? renderGaps(d.key) : list.length ? null : <p className="text-xs text-subtle">Nothing posted.</p>}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
