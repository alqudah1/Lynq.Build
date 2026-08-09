"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

export function CreateWorkflowForm({ action }: { action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5 max-w-xl">
      <FormField label="Workflow name" name="name" required error={!state.ok ? state.fieldErrors?.name : undefined} />
      <FormField label="Workflow key" name="workflowKey" required hint="Uppercase letters/digits/underscores (e.g. KNOWLEDGE_REPORT). Immutable after creation." error={!state.ok ? state.fieldErrors?.workflowKey : undefined} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-xs uppercase tracking-[0.1em] text-subtle">
          Description
        </label>
        <textarea id="description" name="description" rows={3} className="border border-border bg-background px-3 py-2 text-sm text-foreground" />
      </div>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Create workflow</SubmitButton>
      </div>
    </form>
  );
}
