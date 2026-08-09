"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

export function RevokeAgentGrantForm({ expectedRevision, action }: { expectedRevision: number; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="expectedRevision" value={expectedRevision} />
      <SubmitButton variant="danger">Revoke</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
