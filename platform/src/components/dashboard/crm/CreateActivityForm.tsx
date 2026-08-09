"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { CRM_ACTIVITY_TYPES } from "@/lib/crm/validation";

const initialState: ActionResult = { ok: true };
const TYPE_OPTIONS = CRM_ACTIVITY_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }));

export interface CrmTargetRef {
  contactId?: string;
  companyId?: string;
  leadId?: string;
  opportunityId?: string;
}

/** Records one interaction — append-only history, never editable after creation. */
export function CreateActivityForm({ target, redirectPath, action }: { target: CrmTargetRef; redirectPath: string; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-border p-4">
      {target.contactId ? <input type="hidden" name="contactId" value={target.contactId} /> : null}
      {target.companyId ? <input type="hidden" name="companyId" value={target.companyId} /> : null}
      {target.leadId ? <input type="hidden" name="leadId" value={target.leadId} /> : null}
      {target.opportunityId ? <input type="hidden" name="opportunityId" value={target.opportunityId} /> : null}
      <input type="hidden" name="redirectPath" value={redirectPath} />
      <h3 className="text-xs uppercase tracking-[0.1em] text-subtle">Log activity</h3>
      <div className="flex flex-wrap items-end gap-3">
        <SelectField label="Type" name="activityType" options={TYPE_OPTIONS} />
        <FormField label="Subject" name="subject" error={!state.ok ? state.fieldErrors?.subject : undefined} />
      </div>
      <FormField label="Summary" name="summary" error={!state.ok ? state.fieldErrors?.summary : undefined} />
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Log activity</SubmitButton>
      </div>
    </form>
  );
}
