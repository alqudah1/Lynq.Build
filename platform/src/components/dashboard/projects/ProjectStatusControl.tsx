"use client";

import { useActionState } from "react";
import type { ProjectStatus } from "@/lib/projects/validation";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const initialState: ActionResult = { ok: true };

const STATUS_LABELS: Record<ProjectStatus, string> = {
  proposed: "Proposed",
  planning: "Planning",
  active: "Active",
  paused: "Paused",
  blocked: "Blocked",
  completed: "Completed",
  cancelled: "Cancelled",
  archived: "Archived",
};

const STATUS_TONE: Record<ProjectStatus, BadgeTone> = {
  proposed: "neutral",
  planning: "info",
  active: "success",
  paused: "warning",
  blocked: "danger",
  completed: "success",
  cancelled: "neutral",
  archived: "neutral",
};

/** Only ever offers statuses the project's own current state actually allows next — computed server-side by `getLegalProjectTransitions`, never a client-side guess. */
export function ProjectStatusControl({ currentStatus, legalTargets, expectedRevision, action }: { currentStatus: ProjectStatus; legalTargets: ProjectStatus[]; expectedRevision: number; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  if (legalTargets.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Badge tone={STATUS_TONE[currentStatus]}>{STATUS_LABELS[currentStatus]}</Badge>
        No further transitions available
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="expectedRevision" value={expectedRevision} />
      <div className="flex items-center gap-2 text-sm text-muted">
        Current status: <Badge tone={STATUS_TONE[currentStatus]}>{STATUS_LABELS[currentStatus]}</Badge>
      </div>
      <SelectField label="Move to" name="toStatus" defaultValue={legalTargets[0]} options={legalTargets.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
      <SubmitButton>Update status</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
