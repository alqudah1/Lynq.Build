"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

/** Starts a new draft version — "editing a published workflow creates a new draft version, never mutates the one in use." When a published version already exists, its nodes/edges are cloned as the new draft's starting point. */
export function CreateVersionForm({ action, cloneFromVersionId }: { action: (formData: FormData) => Promise<ActionResult>; cloneFromVersionId?: string }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      {cloneFromVersionId ? <input type="hidden" name="cloneFromVersionId" value={cloneFromVersionId} /> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="changeReason" className="text-xs uppercase tracking-[0.1em] text-subtle">
          Change reason {cloneFromVersionId ? "(required when editing a published workflow)" : "(optional)"}
        </label>
        <input id="changeReason" name="changeReason" className="min-h-11 border border-border bg-background px-3 py-2 text-sm text-foreground" />
      </div>
      <SubmitButton>{cloneFromVersionId ? "Create new draft from current version" : "Create draft version"}</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
