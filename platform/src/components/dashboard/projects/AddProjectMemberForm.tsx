"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";

const initialState: ActionResult = { ok: true };

const ROLE_OPTIONS = [
  { value: "contributor", label: "Contributor" },
  { value: "project_manager", label: "Project manager" },
  { value: "project_owner", label: "Project owner" },
  { value: "viewer", label: "Viewer" },
];

export function AddProjectMemberForm({ candidates, action }: { candidates: { userId: string; name: string | null; email: string }[]; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  if (candidates.length === 0) {
    return <p className="text-sm text-muted">Every organization member already belongs to this project.</p>;
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <SelectField label="Add member" name="userId" options={candidates.map((c) => ({ value: c.userId, label: c.name ?? c.email }))} />
      <SelectField label="Role" name="role" defaultValue="contributor" options={ROLE_OPTIONS} />
      <SubmitButton>Add</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
