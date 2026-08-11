"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

export function AddMyWorkForm({
  projects,
  action,
}: {
  projects: { id: string; name: string }[];
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(async (_previous: ActionResult, formData: FormData) => action(formData), initialState);

  if (projects.length === 0) return null;

  return (
    <div className="flex flex-col items-start gap-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="lynq-transition flex min-h-11 items-center rounded-sm border border-border px-4 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong"
      >
        + Add work
      </button>
      {open ? (
        <form action={formAction} className="flex w-full max-w-2xl flex-col gap-3 rounded-md border border-border bg-elevated p-4">
          <p className="text-xs uppercase tracking-[0.08em] text-subtle">Add work for yourself</p>
          <SelectField label="Project" name="projectId" defaultValue="" options={[{ value: "", label: "Choose a project" }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} />
          <FormField label="What needs to be done?" name="title" required error={!state.ok ? state.fieldErrors?.title : undefined} />
          <FormField label="Notes (optional)" name="description" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField label="Priority" name="priority" defaultValue="normal" options={[{ value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }]} />
            <FormField label="Due date (optional)" name="dueDate" type="date" />
          </div>
          {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
          <div className="flex gap-3">
            <SubmitButton>Add to my work</SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-3 text-sm text-muted hover:text-foreground">Cancel</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
