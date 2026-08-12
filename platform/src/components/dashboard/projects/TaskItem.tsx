"use client";

import { useActionState, useState } from "react";
import type { ProjectTask } from "@/lib/projects/tasks";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { InlineStatusForm } from "./InlineStatusForm";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { Card } from "@/components/ui/Card";

const TASK_STATUS_OPTIONS = [
  { value: "backlog", label: "Backlog" },
  { value: "ready", label: "Ready" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "review", label: "Review" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const DOMAIN_OPTIONS = ["identity", "offerings", "market", "execution", "growth", "governance", "capability", "wisdom"];

const initialState: ActionResult = { ok: true };

export interface TaskItemProps {
  task: ProjectTask;
  assignees: { userId: string; name: string | null; email: string }[];
  members: { userId: string; name: string | null; email: string }[];
  otherTasks: { id: string; title: string }[];
  blockedByTitles: string[];
  executionCount: number;
  canManageTaskBoard?: boolean;
  transitionAction: (formData: FormData) => Promise<ActionResult>;
  assignAction: (formData: FormData) => Promise<ActionResult>;
  unassignAction: (userId: string) => Promise<ActionResult>;
  addDependencyAction: (formData: FormData) => Promise<ActionResult>;
  launchAgentAction: (formData: FormData) => Promise<ActionResult>;
}

function UnassignButton({ userId, unassignAction }: { userId: string; unassignAction: (userId: string) => Promise<ActionResult> }) {
  const [, formAction] = useActionState(async () => unassignAction(userId), initialState);
  return (
    <form action={formAction}>
      <button type="submit" className="text-xs text-subtle underline hover:text-foreground">
        Remove
      </button>
    </form>
  );
}

export function TaskItem({ task, assignees, members, otherTasks, blockedByTitles, executionCount, canManageTaskBoard = false, transitionAction, assignAction, unassignAction, addDependencyAction, launchAgentAction }: TaskItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [assignState, assignFormAction] = useActionState(async (_prev: ActionResult, formData: FormData) => assignAction(formData), initialState);
  const [depState, depFormAction] = useActionState(async (_prev: ActionResult, formData: FormData) => addDependencyAction(formData), initialState);
  const [agentState, agentFormAction] = useActionState(async (_prev: ActionResult, formData: FormData) => launchAgentAction(formData), initialState);

  const assignableMembers = members.filter((m) => !assignees.some((a) => a.userId === m.userId));

  return (
    <Card as="li" padding="md" className={isOpen ? "border-border-strong" : ""}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-controls={`task-detail-${task.id}`}
          className="min-w-0 flex-1 text-left"
        >
          <p className="text-sm font-medium text-foreground">{task.title}</p>
          <p className="text-xs uppercase tracking-[0.08em] text-subtle">
            {task.priority} priority{blockedByTitles.length > 0 ? ` · blocked by ${blockedByTitles.join(", ")}` : ""}
            {executionCount > 0 ? ` · ${executionCount} agent run${executionCount === 1 ? "" : "s"}` : ""}
          </p>
          {task.dueDate ? <p className="mt-1 text-xs text-muted">Due {task.dueDate.toLocaleDateString()}</p> : null}
          <p className="mt-2 text-xs font-medium text-foreground underline underline-offset-4">{isOpen ? "Close task" : "Open task"}</p>
        </button>
        {isOpen ? <InlineStatusForm label={`Status for ${task.title}`} name="toStatus" currentValue={task.status} options={TASK_STATUS_OPTIONS} expectedRevision={task.revision} action={transitionAction} /> : null}
      </div>

      {isOpen ? <div id={`task-detail-${task.id}`} className="mt-5 border-t border-border pt-5">
        <h3 className="text-xs font-medium uppercase tracking-[0.1em] text-subtle">Task brief</h3>
        {task.description ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">{task.description}</p> : <p className="mt-3 text-sm text-muted">No written brief has been added yet.</p>}

      {assignees.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {assignees.map((a) => (
            <li key={a.userId} className="flex items-center gap-1 rounded-sm border border-border bg-elevated px-2 py-1 text-xs text-foreground">
              {a.name ?? a.email}
              {canManageTaskBoard ? <UnassignButton userId={a.userId} unassignAction={unassignAction} /> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canManageTaskBoard ? <details className="mt-3">
        <summary className="cursor-pointer text-xs uppercase tracking-[0.08em] text-subtle">More actions</summary>
        <div className="mt-3 flex flex-col gap-4">
          {assignableMembers.length > 0 ? (
            <form action={assignFormAction} className="flex flex-wrap items-end gap-2">
              <SelectField label="Assign to" name="userId" options={assignableMembers.map((m) => ({ value: m.userId, label: m.name ?? m.email }))} />
              <SubmitButton>Assign & notify</SubmitButton>
              {assignState.ok && assignState.message ? <StatusMessage tone="success" message={assignState.message} /> : null}
              {!assignState.ok ? <StatusMessage tone="error" message={assignState.message} /> : null}
            </form>
          ) : null}

          {otherTasks.length > 0 ? (
            <form action={depFormAction} className="flex flex-wrap items-end gap-2">
              <SelectField label="Blocked by" name="blockingTaskId" options={otherTasks.map((t) => ({ value: t.id, label: t.title }))} />
              <SubmitButton>Add dependency</SubmitButton>
              {!depState.ok ? <StatusMessage tone="error" message={depState.message} /> : null}
            </form>
          ) : null}

          <form action={agentFormAction} className="flex flex-col gap-2 border-t border-border pt-3">
            <p className="text-xs uppercase tracking-[0.08em] text-subtle">Launch Company Knowledge Analyst</p>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-subtle">Topic</span>
              <input
                name="topic"
                required
                className="lynq-transition min-h-11 rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60"
                placeholder={`Knowledge report for ${task.title}`}
              />
            </label>
            <fieldset className="flex flex-wrap gap-3">
              <legend className="text-xs text-subtle">Allowed Brain domains</legend>
              {DOMAIN_OPTIONS.map((domain) => (
                <label key={domain} className="flex items-center gap-1 text-xs text-foreground">
                  <input type="checkbox" name="allowedDomains" value={domain} />
                  {domain}
                </label>
              ))}
            </fieldset>
            <div>
              <SubmitButton pendingLabel="Launching…">Launch</SubmitButton>
            </div>
            {!agentState.ok ? <StatusMessage tone="error" message={agentState.message} /> : null}
          </form>
        </div>
      </details> : null}
      </div> : null}
    </Card>
  );
}
