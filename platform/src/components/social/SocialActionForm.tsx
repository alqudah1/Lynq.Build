"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

/**
 * `ActionForm` plus the success message: the shared dashboard wrapper only
 * surfaces failures, but Social actions that queue background work (syncs,
 * "run now", AI recommendations) must say what actually happened. Same
 * contract — a bound server action returning `ActionResult`.
 */
export function SocialActionForm({
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
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : state.message ? <StatusMessage tone="success" message={state.message} /> : null}
    </form>
  );
}
