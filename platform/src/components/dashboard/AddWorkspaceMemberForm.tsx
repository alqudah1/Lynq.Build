"use client";

import { useActionState } from "react";
import { addWorkspaceMemberAction } from "@/lib/dashboard/actions/workspaces";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SelectField } from "./SelectField";
import { SubmitButton } from "./SubmitButton";
import { StatusMessage } from "./StatusMessage";

const initialState: ActionResult = { ok: true };

const ROLE_OPTIONS = [
  { value: "manager", label: "Manager" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

/**
 * Adds an EXISTING organization member to the workspace — never a raw user
 * ID typed in OR sent to the client, only a selection from `candidates`
 * (organization members not already in this workspace, computed
 * server-side), identified by email so no internal user ID is ever
 * serialized into this page. `addWorkspaceMemberAction` resolves the email
 * back to a user ID itself and `addWorkspaceMember` still independently
 * verifies parent-organization membership (`ParentMembershipRequiredViolationError`
 * otherwise) — this dropdown only narrows the UI's suggestions, it is
 * never the actual authorization boundary.
 */
export function AddWorkspaceMemberForm({
  organizationSlug,
  workspaceSlug,
  candidates,
}: {
  organizationSlug: string;
  workspaceSlug: string;
  candidates: { name: string | null; email: string }[];
}) {
  const [state, formAction] = useActionState(
    async (_prev: ActionResult, formData: FormData) => addWorkspaceMemberAction(organizationSlug, workspaceSlug, formData),
    initialState
  );

  if (candidates.length === 0) {
    return <p className="text-sm text-muted">Every organization member already has access to this workspace.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-3">
      <div className="flex flex-1 flex-col gap-1.5">
        <label htmlFor="add-member-user" className="text-xs uppercase tracking-[0.1em] text-subtle">
          Organization member
        </label>
        <select id="add-member-user" name="email" className="min-h-11 border border-border bg-background px-3 py-2 text-sm text-foreground">
          {candidates.map((candidate) => (
            <option key={candidate.email} value={candidate.email}>
              {candidate.name ?? candidate.email}
            </option>
          ))}
        </select>
      </div>
      <SelectField label="Workspace role" name="role" defaultValue="member" options={ROLE_OPTIONS} />
      <SubmitButton>Add to workspace</SubmitButton>
      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
    </form>
  );
}
