"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { SelectField } from "@/components/dashboard/SelectField";
import { Tr, Td } from "@/components/ui/Table";
import type { ActionResult } from "@/lib/dashboard/actions/types";

const ROLE_OPTIONS = [
  { value: "project_owner", label: "Project owner" },
  { value: "project_manager", label: "Project manager" },
  { value: "contributor", label: "Contributor" },
  { value: "viewer", label: "Viewer" },
];

/** Every rule (last-owner protection, authorization) is enforced by `changeProjectMemberRole`/`removeProjectMember` themselves — this component only decides what to show. */
export function ProjectMemberRow({
  name,
  email,
  role,
  canManage,
  changeRoleAction,
  removeAction,
}: {
  name: string | null;
  email: string;
  role: string;
  canManage: boolean;
  changeRoleAction: (formData: FormData) => Promise<ActionResult>;
  removeAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [selectedRole, setSelectedRole] = useState(role);
  const displayName = name ?? email;
  const roleChanged = selectedRole !== role;

  return (
    <Tr className="align-top">
      <Td>{displayName}</Td>
      <Td className="text-muted">{email}</Td>
      <Td>{canManage ? <SelectField label={`Role for ${displayName}`} name="role" value={selectedRole} onChange={setSelectedRole} options={ROLE_OPTIONS} /> : <span className="text-sm capitalize text-foreground">{role.replace("_", " ")}</span>}</Td>
      <Td>
        {canManage ? (
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
            <ConfirmDialog triggerLabel="Remove" triggerVariant="danger" variant="danger" title="Remove member" description={`Remove ${displayName} from this project?`} confirmLabel="Remove" formAction={removeAction} />
          </div>
        ) : null}
      </Td>
    </Tr>
  );
}
