"use client";

import { useActionState } from "react";
import type { WorkflowHumanTask } from "@/lib/workflows/human-tasks";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

const initialState: ActionResult = { ok: true };

export function HumanTaskCard({ task, completeAction }: { task: WorkflowHumanTask; completeAction: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => completeAction(formData), initialState);

  return (
    <Card as="li" padding="sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{task.title}</p>
        {task.status !== "pending" ? <Badge tone={task.status === "completed" ? "success" : "neutral"}>{task.status === "completed" ? "Completed" : "Cancelled"}</Badge> : null}
      </div>
      {task.instructions ? <p className="mt-1 text-sm text-muted">{task.instructions}</p> : null}
      {task.dueDate ? <p className="mt-1 text-xs uppercase tracking-[0.08em] text-subtle">Due {task.dueDate.toLocaleDateString()}</p> : null}
      {task.status === "pending" ? (
        <form action={formAction} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="expectedRevision" value={task.revision} />
          <label htmlFor={`notes-${task.id}`} className="text-xs uppercase tracking-[0.1em] text-subtle">
            Notes (optional)
          </label>
          <textarea id={`notes-${task.id}`} name="notes" rows={2} className="lynq-transition rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60" />
          <div>
            <SubmitButton pendingLabel="Completing…">Mark complete</SubmitButton>
          </div>
          {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
        </form>
      ) : null}
    </Card>
  );
}
