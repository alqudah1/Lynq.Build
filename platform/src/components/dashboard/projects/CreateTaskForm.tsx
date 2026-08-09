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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SelectField label="Priority" name="priority" defaultValue="normal" options={PRIORITY_OPTIONS} />
        {phases.length > 0 ? <SelectField label="Phase" name="phaseId" defaultValue="" options={[{ value: "", label: "No phase" }, ...phases.map((p) => ({ value: p.id, label: p.name }))]} /> : null}
        {milestones.length > 0 ? <SelectField label="Milestone" name="milestoneId" defaultValue="" options={[{ value: "", label: "No milestone" }, ...milestones.map((m) => ({ value: m.id, label: m.title }))]} /> : null}
      </div>
      {!state.ok && !state.fieldErrors ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Add task</SubmitButton>
      </div>
    </form>
  );
}
