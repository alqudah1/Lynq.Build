"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

export function StartExecutionForm({ projects, action }: { projects: { id: string; name: string }[]; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4 border border-border p-4">
      <h3 className="text-xs uppercase tracking-[0.1em] text-subtle">Start execution</h3>
      {projects.length > 0 ? (
        <SelectField label="Linked project (optional)" name="projectId" options={[{ value: "", label: "None" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="input" className="text-xs uppercase tracking-[0.1em] text-subtle">
          Input (JSON, optional)
        </label>
        <textarea id="input" name="input" rows={2} placeholder='{ "topic": "Q3 pricing changes" }' className="border border-border bg-background px-3 py-2 font-mono text-xs text-foreground" />
      </div>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton pendingLabel="Starting…">Start execution</SubmitButton>
      </div>
    </form>
  );
}
