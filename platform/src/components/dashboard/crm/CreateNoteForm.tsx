"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import type { CrmTargetRef } from "./CreateActivityForm";

const initialState: ActionResult = { ok: true };

/** Internal notes only — never rendered on any public-facing surface. */
export function CreateNoteForm({ target, redirectPath, action }: { target: CrmTargetRef; redirectPath: string; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-border p-4">
      {target.contactId ? <input type="hidden" name="contactId" value={target.contactId} /> : null}
      {target.companyId ? <input type="hidden" name="companyId" value={target.companyId} /> : null}
      {target.leadId ? <input type="hidden" name="leadId" value={target.leadId} /> : null}
      {target.opportunityId ? <input type="hidden" name="opportunityId" value={target.opportunityId} /> : null}
      <input type="hidden" name="redirectPath" value={redirectPath} />
      <label htmlFor="content" className="text-xs uppercase tracking-[0.1em] text-subtle">
        Add internal note
      </label>
      <textarea id="content" name="content" rows={3} required className="lynq-transition rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60" />
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
      <div>
        <SubmitButton>Add note</SubmitButton>
      </div>
    </form>
  );
}
