"use client";

import { useActionState } from "react";
import type { WorkflowExecutionStatus } from "@/lib/workflows/validation";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

function ControlForm({ label, expectedRevision, action, variant }: { label: string; expectedRevision: number; action: (formData: FormData) => Promise<ActionResult>; variant?: "primary" | "danger" }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="expectedRevision" value={expectedRevision} />
      <SubmitButton variant={variant}>{label}</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}

const PAUSABLE: WorkflowExecutionStatus[] = ["queued", "running", "waiting", "waiting_for_approval"];

export function ExecutionControls({
  status,
  expectedRevision,
  canManage,
  pauseAction,
  resumeAction,
  cancelAction,
  retryAction,
}: {
  status: WorkflowExecutionStatus;
  expectedRevision: number;
  canManage: boolean;
  pauseAction: (formData: FormData) => Promise<ActionResult>;
  resumeAction: (formData: FormData) => Promise<ActionResult>;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
  retryAction: (formData: FormData) => Promise<ActionResult>;
}) {
  if (!canManage) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {PAUSABLE.includes(status) ? <ControlForm label="Pause" expectedRevision={expectedRevision} action={pauseAction} /> : null}
      {status === "paused" ? <ControlForm label="Resume" expectedRevision={expectedRevision} action={resumeAction} /> : null}
      {status === "failed" ? <ControlForm label="Retry" expectedRevision={expectedRevision} action={retryAction} /> : null}
      {!["completed", "failed", "cancelled"].includes(status) ? <ControlForm label="Cancel" expectedRevision={expectedRevision} action={cancelAction} variant="danger" /> : null}
    </div>
  );
}
