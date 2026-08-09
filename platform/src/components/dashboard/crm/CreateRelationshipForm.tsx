"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { CRM_RELATIONSHIP_TYPES } from "@/lib/crm/validation";

const initialState: ActionResult = { ok: true };
const TYPE_OPTIONS = CRM_RELATIONSHIP_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }));

export function CreateRelationshipForm({ contactId, companies, action }: { contactId: string; companies: { id: string; name: string }[]; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  if (companies.length === 0) return <p className="text-sm text-muted">No companies yet — create one to link this contact.</p>;

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="contactId" value={contactId} />
      <SelectField label="Company" name="companyId" options={companies.map((c) => ({ value: c.id, label: c.name }))} />
      <SelectField label="Relationship" name="relationshipType" options={TYPE_OPTIONS} />
      <label className="flex items-center gap-2 text-xs uppercase tracking-[0.1em] text-subtle">
        <input type="checkbox" name="isPrimary" className="h-4 w-4" /> Primary
      </label>
      <SubmitButton>Link company</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
