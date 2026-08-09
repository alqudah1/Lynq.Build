"use client";

import { useActionState } from "react";
import { createProjectAction } from "@/lib/dashboard/actions/projects";
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

export function CreateProjectForm({ organizationSlug, workspaces }: { organizationSlug: string; workspaces: { id: string; name: string }[] }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => createProjectAction(organizationSlug, formData), initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormField label="Project name" name="name" required error={!state.ok ? state.fieldErrors?.name : undefined} />
      <FormField
        label="Project key"
        name="projectKey"
        required
        hint="Short, stable code (e.g. KIDS, REBATE) — cannot be changed after creation."
        placeholder="KIDS"
        error={!state.ok ? state.fieldErrors?.projectKey : undefined}
      />
      {workspaces.length > 0 ? (
        <SelectField label="Workspace" name="workspaceId" defaultValue="" options={[{ value: "", label: "No workspace (organization-wide)" }, ...workspaces.map((w) => ({ value: w.id, label: w.name }))]} />
      ) : null}
      <SelectField label="Priority" name="priority" defaultValue="normal" options={PRIORITY_OPTIONS} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="objective" className="text-xs uppercase tracking-[0.1em] text-subtle">
          Objective
        </label>
        <textarea id="objective" name="objective" rows={2} className="lynq-transition rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-xs uppercase tracking-[0.1em] text-subtle">
          Description
        </label>
        <textarea id="description" name="description" rows={4} className="lynq-transition rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60" />
      </div>
      {!state.ok && !state.fieldErrors ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Create project</SubmitButton>
      </div>
    </form>
  );
}
