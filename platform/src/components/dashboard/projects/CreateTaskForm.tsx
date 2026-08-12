"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export function CreateTaskForm({
  action,
  phases,
  milestones,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  phases: { id: string; name: string }[];
  milestones: { id: string; title: string }[];
}) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-border p-4">
      <p className="text-xs uppercase tracking-[0.08em] text-subtle">New task</p>
      <FormField label="Title" name="title" required error={!state.ok ? state.fieldErrors?.title : undefined} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-xs uppercase tracking-[0.1em] text-subtle">Brief and deliverables</label>
        <textarea id="description" name="description" rows={6} maxLength={5000} placeholder="Explain the outcome, deliverables, approval rules, and any useful links." className="lynq-transition rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground placeholder:text-subtle hover:border-border-strong focus-visible:border-accent/60" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SelectField label="Priority" name="priority" defaultValue="normal" options={PRIORITY_OPTIONS} />
        {phases.length > 0 ? <SelectField label="Phase" name="phaseId" defaultValue="" options={[{ value: "", label: "No phase" }, ...phases.map((p) => ({ value: p.id, label: p.name }))]} /> : null}
        {milestones.length > 0 ? <SelectField label="Milestone" name="milestoneId" defaultValue="" options={[{ value: "", label: "No milestone" }, ...milestones.map((m) => ({ value: m.id, label: m.title }))]} /> : null}
        <FormField label="Due date" name="dueDate" type="date" hint="Optional" />
      </div>
      {!state.ok && !state.fieldErrors ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Add task</SubmitButton>
      </div>
    </form>
  );
}
