"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { CRM_AGENT_PERMISSIONS } from "@/lib/crm/validation";

const initialState: ActionResult = { ok: true };
const PERMISSION_OPTIONS = CRM_AGENT_PERMISSIONS.map((p) => ({ value: p, label: p }));

/** Default deny: an agent has zero CRM access until an org owner/admin explicitly grants one of these narrow permissions here — never inherited from Brain grants. */
export function GrantAgentPermissionForm({ agents, action }: { agents: { id: string; name: string }[]; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  if (agents.length === 0) return <p className="text-sm text-muted">No agents registered in this organization yet.</p>;

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <SelectField label="Agent" name="agentId" options={agents.map((a) => ({ value: a.id, label: a.name }))} />
      <SelectField label="Permission" name="permission" options={PERMISSION_OPTIONS} />
      <SubmitButton>Grant</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
