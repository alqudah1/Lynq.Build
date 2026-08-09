"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

export function CreateTagForm({ action }: { action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <FormField label="Name" name="name" required error={!state.ok ? state.fieldErrors?.name : undefined} />
      <FormField label="Key" name="tagKey" required hint="uppercase, e.g. HOT_LEAD" error={!state.ok ? state.fieldErrors?.tagKey : undefined} />
      <SubmitButton>Create tag</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
