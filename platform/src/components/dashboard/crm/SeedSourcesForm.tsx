"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

export function SeedSourcesForm({ action }: { action: () => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async () => action(), initialState);
  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <p className="text-sm text-muted">No sources yet.</p>
      <SubmitButton>Seed built-in sources</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
