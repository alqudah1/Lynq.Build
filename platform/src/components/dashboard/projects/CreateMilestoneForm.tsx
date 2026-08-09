"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

export function CreateMilestoneForm({ action }: { action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border border-border p-4">
      <div className="min-w-48 flex-1">
        <FormField label="New milestone title" name="title" required error={!state.ok ? state.fieldErrors?.title : undefined} />
      </div>
      <div>
        <FormField label="Target date" name="targetDate" type="date" />
      </div>
      <SubmitButton>Add milestone</SubmitButton>
      {!state.ok && !state.fieldErrors ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
