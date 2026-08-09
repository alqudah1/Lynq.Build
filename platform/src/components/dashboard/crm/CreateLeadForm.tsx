"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

/** Leads are an explicit qualification object, never merely a contact status — created independently, optionally referencing a contact/company. */
export function CreateLeadForm({ contacts, companies, action }: { contacts: { id: string; name: string }[]; companies: { id: string; name: string }[]; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-md border border-border p-4">
      <h3 className="text-xs uppercase tracking-[0.1em] text-subtle">New lead</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Contact" name="contactId" options={[{ value: "", label: "No contact" }, ...contacts.map((c) => ({ value: c.id, label: c.name }))]} />
        <SelectField label="Company" name="companyId" options={[{ value: "", label: "No company" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Estimated value" name="estimatedValueAmount" type="number" error={!state.ok ? state.fieldErrors?.estimatedValueAmount : undefined} />
        <FormField label="Currency" name="estimatedValueCurrency" placeholder="USD" error={!state.ok ? state.fieldErrors?.estimatedValueCurrency : undefined} />
      </div>
      <FormField label="Qualification notes" name="qualificationNotes" error={!state.ok ? state.fieldErrors?.qualificationNotes : undefined} />
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Create lead</SubmitButton>
      </div>
    </form>
  );
}
