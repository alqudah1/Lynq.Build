"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

/**
 * A generic client wrapper around a Server Action that returns
 * `ActionResult` — native `<form action={...}>` requires a void-returning
 * function, so any action reporting success/failure back to the page
 * (rather than redirecting) needs this `useActionState` wrapper. Mirrors
 * the same shape `SetDefaultPipelineForm`/`InlineStatusForm`/etc. each
 * hand-roll individually in CRM — factored out once here since Sales OS
 * has many more of these simple, non-dialog action forms.
 */
export function ActionForm({
  action,
  hiddenFields,
  children,
  className,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  hiddenFields?: Record<string, string | number>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);
  return (
    <form action={formAction} className={className}>
      {hiddenFields ? Object.entries(hiddenFields).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />) : null}
      {children}
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
