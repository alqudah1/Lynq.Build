"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

export function SeedTemplatesForm({ action }: { action: () => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async () => action(), initialState);

  return (
    <form action={formAction}>
      <SubmitButton pendingLabel="Creating…">Create starter templates</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
