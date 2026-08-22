"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

export function ImportProspectsForm({ action }: { action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_previous: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-5 rounded-md border border-border p-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="prospectsFile" className="text-xs uppercase tracking-[0.1em] text-subtle">LYNQ prospect export</label>
        <input
          id="prospectsFile"
          name="prospectsFile"
          type="file"
          accept="application/json,.json"
          required
          className="min-h-11 rounded-sm border border-border bg-surface px-3 py-2 text-sm text-foreground file:mr-4 file:rounded-sm file:border-0 file:bg-foreground file:px-3 file:py-2 file:text-xs file:font-medium file:text-background"
        />
        <p className="text-sm text-muted">Up to 100 reviewed prospects. Re-importing the same file is safe: LYNQ uses stable source IDs to prevent duplicates.</p>
      </div>

      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : state.message ? <StatusMessage tone="success" message={state.message} /> : null}

      <div>
        <SubmitButton>Stage prospects in CRM</SubmitButton>
      </div>
    </form>
  );
}
