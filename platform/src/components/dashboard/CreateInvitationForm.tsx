"use client";

import { useActionState, useState } from "react";
import { createOrRefreshInvitationAction, type CreateInvitationActionResult } from "@/lib/dashboard/actions/invitations";
import { FormField } from "./FormField";
import { SelectField } from "./SelectField";
import { SubmitButton } from "./SubmitButton";
import { StatusMessage } from "./StatusMessage";
import { InvitationLink } from "./InvitationLink";

const NO_WORKSPACE = "";

const initialState: CreateInvitationActionResult = { ok: true, refreshed: false };

/**
 * Creates (or, for an email already pending, atomically refreshes) an
 * invitation. `availableRoles` is computed server-side by the page from
 * the actor's own organization role — an admin's `availableRoles` simply
 * never includes "owner", so the UI reflects the actor's authority without
 * this component re-deriving or re-checking it; `createOrRefreshInvitation`
 * itself still independently enforces "an admin cannot invite an owner"
 * regardless of what options this form happens to offer.
 *
 * The workspace role selector only appears once a workspace is chosen —
 * submitting a workspace requires a workspace role, and vice versa, the
 * same pairing `createOrRefreshInvitation`'s own schema requires.
 */
export function CreateInvitationForm({
  organizationSlug,
  availableRoles,
  workspaces,
}: {
  organizationSlug: string;
  availableRoles: { value: string; label: string }[];
  workspaces: { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState(
    async (_prev: CreateInvitationActionResult, formData: FormData) => createOrRefreshInvitationAction(organizationSlug, formData),
    initialState
  );
  const [workspaceId, setWorkspaceId] = useState(NO_WORKSPACE);

  const workspaceOptions = [{ value: NO_WORKSPACE, label: "No workspace" }, ...workspaces.map((ws) => ({ value: ws.id, label: ws.name }))];
  const workspaceRoleOptions = [
    { value: "manager", label: "Manager" },
    { value: "member", label: "Member" },
    { value: "viewer", label: "Viewer" },
  ];

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormField
        label="Email"
        name="email"
        type="email"
        required
        autoComplete="email"
        error={!state.ok ? state.fieldErrors?.email : undefined}
      />
      <SelectField label="Organization role" name="role" defaultValue={availableRoles[availableRoles.length - 1]?.value} options={availableRoles} />

      {workspaces.length > 0 ? (
        <>
          <SelectField label="Workspace (optional)" name="workspaceId" value={workspaceId} onChange={setWorkspaceId} options={workspaceOptions} />
          {workspaceId ? (
            <SelectField label="Workspace role" name="workspaceRole" defaultValue="member" options={workspaceRoleOptions} />
          ) : null}
        </>
      ) : null}

      {!state.ok ? <StatusMessage tone="error" message={state.message} /> : null}
      {state.ok && state !== initialState ? (
        <StatusMessage tone="success" message={state.refreshed ? "Invitation refreshed. Copy the new secure link below." : "Invitation created. Copy the secure link below."} />
      ) : null}
      {state.ok && state !== initialState && state.invitationPath ? <InvitationLink invitationPath={state.invitationPath} /> : null}

      <div>
        <SubmitButton>Send invitation</SubmitButton>
      </div>
    </form>
  );
}
