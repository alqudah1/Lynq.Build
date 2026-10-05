"use client";

import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

export interface RegeneratePart {
  part: "hook" | "caption" | "cta" | "hashtags" | "image" | "video";
  label: string;
  available: boolean;
  unavailableReason?: string;
}

/**
 * Regenerate one part of a post (hook / caption / CTA / hashtags / image /
 * video) with an optional instruction. Calls the server action directly;
 * the action revalidates the page, so the preview and fields refresh from
 * the database — never from optimistic client state. Video renders run in
 * the background and the page shows a "rendering" state until they land.
 */
export function RegeneratePanel({ action, parts, rendering }: { action: (formData: FormData) => Promise<ActionResult>; parts: RegeneratePart[]; rendering: boolean }) {
  const [instruction, setInstruction] = useState("");
  const [activePart, setActivePart] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputId = useId();

  function run(part: RegeneratePart["part"]) {
    setActivePart(part);
    setResult(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("part", part);
      if (instruction.trim()) formData.set("instruction", instruction.trim().slice(0, 1000));
      const outcome = await action(formData);
      setResult(outcome);
      setActivePart(null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {rendering ? (
        <p role="status" className="flex items-center gap-2 rounded-sm border border-info/30 bg-info-wash px-3 py-2 text-xs text-info">
          <span aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          A video is rendering. Refresh in a few minutes to see it.
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-xs uppercase tracking-[0.1em] text-subtle">Instruction (optional)</label>
        <input id={inputId} value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={1000} placeholder="e.g. shorter, mention the free trial" className="lynq-transition min-h-11 rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground placeholder:text-subtle hover:border-border-strong focus-visible:border-accent/60" />
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {parts.map((p) => (
          <li key={p.part}>
            <button
              type="button"
              onClick={() => run(p.part)}
              disabled={!p.available || isPending || (rendering && p.part === "video")}
              title={!p.available ? p.unavailableReason : undefined}
              className="lynq-transition inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm border border-border px-3 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong disabled:opacity-40"
            >
              {activePart === p.part ? <span aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" /> : null}
              {p.label}
            </button>
          </li>
        ))}
      </ul>
      {parts.some((p) => !p.available && p.unavailableReason) ? (
        <ul className="flex flex-col gap-1 text-xs text-subtle">
          {parts.filter((p) => !p.available && p.unavailableReason).map((p) => <li key={p.part}>{p.label}: {p.unavailableReason}</li>)}
        </ul>
      ) : null}
      {result ? <StatusMessage tone={result.ok ? "success" : "error"} message={result.ok ? (result.message ?? "Done.") : result.message} /> : null}
    </div>
  );
}
