"use client";

import { useActionState, useRef } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SelectField } from "@/components/dashboard/SelectField";

const initialState: ActionResult = { ok: true };

/** Shared by project/phase/milestone/task status changes — one small inline `<select>` that submits itself on change, bound to whichever server action + revision the caller supplies. A failed submit (e.g. a stale revision, or an illegal transition) shows inline, never silently discarded. */
export function InlineStatusForm({
  label,
  name,
  currentValue,
  options,
  expectedRevision,
  action,
  hiddenFields,
}: {
  label: string;
  name: string;
  currentValue: string;
  options: { value: string; label: string }[];
  expectedRevision: number;
  action: (formData: FormData) => Promise<ActionResult>;
  hiddenFields?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="expectedRevision" value={expectedRevision} />
      {hiddenFields ? Object.entries(hiddenFields).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />) : null}
      <SelectField label={label} name={name} defaultValue={currentValue} options={options} onChange={() => formRef.current?.requestSubmit()} />
      {!state.ok ? (
        <span role="alert" className="text-xs text-danger">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
