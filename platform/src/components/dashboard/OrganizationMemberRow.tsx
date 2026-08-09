"use client";

import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { SelectField } from "./SelectField";
import type { ActionResult } from "@/lib/dashboard/actions/types";

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

/**
 * One organization-member row (Step 5B). Role changes and removal both
 * require an explicit confirmation dialog; every rule (self-change,
 * admin-cannot-act-on-owner, last-owner) is enforced by
 * `changeOrganizationRole`/`removeOrganizationMember` themselves — this
 * component only decides what to SHOW (hiding controls for the current
 * user's own row is a UX nicety, not the security boundary), never what's
 * ALLOWED.
 *
 * `changeRoleAction`/`removeAction` arrive already bound to this row's
 * target user ID by the server (the page calls `.bind(null, ..., userId)`
 * before ever handing a prop to this client component) — this component
 * never receives a raw user ID prop it could pass to the wrong action or
 * that a future caller could substitute. Note this does NOT make the ID
 * invisible on the wire: `.bind()` arguments are the action's own
 * parameters, not a closure, so Next.js serializes them into the RSC
 * payload/action call like any other argument, whether bound here or on
 * the server — there is no plaintext-vs-encrypted difference between the
 * two. The actual guarantee is that this ID is never trusted as proof of
 * authorization: `changeOrganizationRole`/`removeOrganizationMember`
 * independently re-verify the caller's rights against it every time.
 */
export function OrganizationMemberRow({
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
                description={`Change ${displayName}'s role from ${role} to ${selectedRole}?`}
                confirmLabel="Change role"
                formAction={changeRoleAction}
                hiddenFields={{ role: selectedRole }}
              />
            ) : null}
            <ConfirmDialog
              triggerLabel="Remove"
              triggerVariant="danger"
              variant="danger"
              title="Remove member"
              description={`Remove ${displayName} from this organization? They will lose access immediately.`}
              confirmLabel="Remove"
              formAction={removeAction}
            />
          </div>
        ) : null}
      </td>
    </tr>
  );
}
