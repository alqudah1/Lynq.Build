"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { CRM_LIFECYCLE_STAGES } from "@/lib/crm/validation";

const initialState: ActionResult = { ok: true };

const LIFECYCLE_OPTIONS = CRM_LIFECYCLE_STAGES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }));

/** Domain is never required, and two companies may legitimately share a parent domain — no uniqueness is enforced here. */
export function CreateCompanyForm({ action }: { action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-md border border-border p-4">
      <h3 className="text-xs uppercase tracking-[0.1em] text-subtle">New company</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" name="name" required error={!state.ok ? state.fieldErrors?.name : undefined} />
        <FormField label="Domain" name="domain" error={!state.ok ? state.fieldErrors?.domain : undefined} hint="e.g. acme.com" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Website" name="website" error={!state.ok ? state.fieldErrors?.website : undefined} />
        <FormField label="Industry" name="industry" error={!state.ok ? state.fieldErrors?.industry : undefined} />
      </div>
      <SelectField label="Lifecycle stage" name="lifecycleStage" defaultValue="lead" options={LIFECYCLE_OPTIONS} />
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Create company</SubmitButton>
      </div>
    </form>
  );
}
