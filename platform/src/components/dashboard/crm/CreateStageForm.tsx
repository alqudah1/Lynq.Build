"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

export function CreateStageForm({ pipelineId, action }: { pipelineId: string; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="pipelineId" value={pipelineId} />
      <FormField label="Stage name" name="name" required error={!state.ok ? state.fieldErrors?.name : undefined} />
      <FormField label="Stage key" name="stageKey" required hint="e.g. NEGOTIATION" error={!state.ok ? state.fieldErrors?.stageKey : undefined} />
      <label className="flex items-center gap-2 text-xs uppercase tracking-[0.1em] text-subtle">
        <input type="checkbox" name="isClosed" className="h-4 w-4" /> Closed
      </label>
      <label className="flex items-center gap-2 text-xs uppercase tracking-[0.1em] text-subtle">
        <input type="checkbox" name="isWon" className="h-4 w-4" /> Won
      </label>
      <label className="flex items-center gap-2 text-xs uppercase tracking-[0.1em] text-subtle">
        <input type="checkbox" name="isLost" className="h-4 w-4" /> Lost
      </label>
      <SubmitButton>Add stage</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
