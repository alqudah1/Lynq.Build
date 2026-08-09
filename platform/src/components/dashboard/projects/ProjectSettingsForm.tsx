"use client";

import { useActionState } from "react";
import type { Project } from "@/lib/projects/projects";
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

/** `projectKey` and `status` are never editable here — the key is immutable after creation, and status only ever changes through the explicit transition control. */
export function ProjectSettingsForm({ project, action }: { project: Project; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="expectedRevision" value={project.revision} />
      <FormField label="Project name" name="name" defaultValue={project.name} required error={!state.ok ? state.fieldErrors?.name : undefined} />
      <SelectField label="Priority" name="priority" defaultValue={project.priority} options={PRIORITY_OPTIONS} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="objective" className="text-xs uppercase tracking-[0.1em] text-subtle">
          Objective
        </label>
        <textarea id="objective" name="objective" rows={2} defaultValue={project.objective ?? ""} className="lynq-transition rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-xs uppercase tracking-[0.1em] text-subtle">
          Description
        </label>
        <textarea id="description" name="description" rows={4} defaultValue={project.description ?? ""} className="lynq-transition rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60" />
      </div>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Save changes</SubmitButton>
      </div>
    </form>
  );
}
