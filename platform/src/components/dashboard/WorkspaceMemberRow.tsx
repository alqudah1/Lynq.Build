"use client";

import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { SelectField } from "./SelectField";
import type { ActionResult } from "@/lib/dashboard/actions/types";

const ROLE_OPTIONS = [
  { value: "manager", label: "Manager" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

/**
 * One workspace-member row (Step 5B) — mirrors `OrganizationMemberRow`'s
 * pattern; every rule is enforced by `changeWorkspaceRole`/
 * `removeWorkspaceMember` themselves, not re-implemented here.
 *
 * `changeRoleAction`/`removeAction` arrive already bound to this row's
 * target user ID by the server — this component never receives the raw
 * user ID, for the same reason documented in `OrganizationMemberRow`.
 */
export function WorkspaceMemberRow({
  name,
  email,
  role,
  canManage,
  isSelf,
  changeRoleAction,
  removeAction,
}: {
  name: string | null;
  email: string;
  role: string;
  canManage: boolean;
  isSelf: boolean;
  changeRoleAction: (formData: FormData) => Promise<ActionResult>;
  removeAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [selectedRole, setSelectedRole] = useState(role);
  const displayName = name ?? email;
  const roleChanged = selectedRole !== role;

  return (
    <tr className="border-b border-border align-top">
      <td className="py-3 pr-4 text-sm text-foreground">{displayName}</td>
      <td className="py-3 pr-4 text-sm text-muted">{email}</td>
      <td className="py-3 pr-4">
        {canManage && !isSelf ? (
          <SelectField label={`Role for ${displayName}`} name="role" value={selectedRole} onChange={setSelectedRole} options={ROLE_OPTIONS} />
        ) : (
          <span className="text-sm capitalize text-foreground">{role}</span>
        )}
      </td>
      <td className="py-3">
        {isSelf ? (
          <span className="text-xs text-subtle">This is you</span>
        ) : canManage ? (
          <div className="flex flex-wrap gap-2">
            {roleChanged ? (
              <ConfirmDialog
                triggerLabel="Save role"
                title="Change role"
                description={`Change ${displayName}'s workspace role from ${role} to ${selectedRole}?`}
                confirmLabel="Change role"
                formAction={changeRoleAction}
                hiddenFields={{ role: selectedRole }}
              />
            ) : null}
            <ConfirmDialog
              triggerLabel="Remove"
              triggerVariant="danger"
              variant="danger"
              title="Remove workspace access"
              description={`Remove ${displayName}'s access to this workspace? They will lose access immediately.`}
              confirmLabel="Remove"
              formAction={removeAction}
            />
          </div>
        ) : null}
      </td>
    </tr>
  );
}
