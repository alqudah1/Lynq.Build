"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

export function PublishControl({ canPublish, expectedRevision, action }: { canPublish: boolean; expectedRevision: number; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  if (!canPublish) {
    return <p className="text-sm text-subtle">Run validation and resolve every issue before this version can be published.</p>;
  }

  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="expectedRevision" value={expectedRevision} />
      <SubmitButton pendingLabel="Publishing…">Publish this version</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
