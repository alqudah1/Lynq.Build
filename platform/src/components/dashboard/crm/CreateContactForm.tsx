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

/** Email/phone are never required — a first/last name (or a display name) alone is a valid stable identity. */
export function CreateContactForm({ action }: { action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-md border border-border p-4">
      <h3 className="text-xs uppercase tracking-[0.1em] text-subtle">New contact</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="First name" name="firstName" error={!state.ok ? state.fieldErrors?.firstName : undefined} />
        <FormField label="Last name" name="lastName" error={!state.ok ? state.fieldErrors?.lastName : undefined} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Email" name="primaryEmail" type="email" error={!state.ok ? state.fieldErrors?.primaryEmail : undefined} hint="Optional if a name is given" />
        <FormField label="Phone" name="primaryPhone" type="tel" error={!state.ok ? state.fieldErrors?.primaryPhone : undefined} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Job title" name="jobTitle" error={!state.ok ? state.fieldErrors?.jobTitle : undefined} />
        <SelectField label="Lifecycle stage" name="lifecycleStage" defaultValue="lead" options={LIFECYCLE_OPTIONS} />
      </div>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Create contact</SubmitButton>
      </div>
    </form>
  );
}
