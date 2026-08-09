"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

export function CreatePhaseForm({ action }: { action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border border-border p-4">
      <div className="min-w-48 flex-1">
        <FormField label="New phase name" name="name" required error={!state.ok ? state.fieldErrors?.name : undefined} />
      </div>
      <SubmitButton>Add phase</SubmitButton>
      {!state.ok && !state.fieldErrors ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
