"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { CRM_PRIORITIES } from "@/lib/crm/validation";
import type { CrmTargetRef } from "./CreateActivityForm";

const initialState: ActionResult = { ok: true };
const PRIORITY_OPTIONS = CRM_PRIORITIES.map((p) => ({ value: p, label: p }));

/** A CRM follow-up — customer-facing sales/service follow-up, never a Projects Core task. */
export function CreateFollowUpForm({ target, members, redirectPath, action }: { target: CrmTargetRef; members: { id: string; name: string }[]; redirectPath: string; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-border p-4">
      {target.contactId ? <input type="hidden" name="contactId" value={target.contactId} /> : null}
      {target.companyId ? <input type="hidden" name="companyId" value={target.companyId} /> : null}
      {target.leadId ? <input type="hidden" name="leadId" value={target.leadId} /> : null}
      {target.opportunityId ? <input type="hidden" name="opportunityId" value={target.opportunityId} /> : null}
      <input type="hidden" name="redirectPath" value={redirectPath} />
      <h3 className="text-xs uppercase tracking-[0.1em] text-subtle">New follow-up</h3>
      <FormField label="Title" name="title" required error={!state.ok ? state.fieldErrors?.title : undefined} />
      <div className="flex flex-wrap items-end gap-3">
        <SelectField label="Assignee" name="assignedUserId" options={members.map((m) => ({ value: m.id, label: m.name }))} />
        <FormField label="Due" name="dueAt" type="date" error={!state.ok ? state.fieldErrors?.dueAt : undefined} />
        <SelectField label="Priority" name="priority" defaultValue="normal" options={PRIORITY_OPTIONS} />
      </div>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Create follow-up</SubmitButton>
      </div>
    </form>
  );
}
