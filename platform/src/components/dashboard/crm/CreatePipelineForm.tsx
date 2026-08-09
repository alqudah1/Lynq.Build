"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

/** Support for more than one pipeline — never a single hardcoded sales process. */
export function CreatePipelineForm({ action }: { action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-md border border-border p-4">
      <h3 className="text-xs uppercase tracking-[0.1em] text-subtle">New pipeline</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" name="name" required error={!state.ok ? state.fieldErrors?.name : undefined} />
        <FormField label="Key" name="pipelineKey" required hint="uppercase, e.g. DEFAULT_SALES" error={!state.ok ? state.fieldErrors?.pipelineKey : undefined} />
      </div>
      <label className="flex items-center gap-2 text-xs uppercase tracking-[0.1em] text-subtle">
        <input type="checkbox" name="isDefault" className="h-4 w-4" /> Make this the organization&apos;s default pipeline
      </label>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Create pipeline</SubmitButton>
      </div>
    </form>
  );
}
