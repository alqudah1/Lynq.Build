"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

export function SetDefaultPipelineForm({ action }: { action: () => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async () => action(), initialState);
  return (
    <form action={formAction}>
      <SubmitButton>Make default</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
