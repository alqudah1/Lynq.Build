"use client";

import { ConfirmDialog } from "./ConfirmDialog";
import { deleteWorkspaceAction } from "@/lib/dashboard/actions/workspaces";

/** Org owner/admin only, never a workspace manager — `softDeleteWorkspace` itself enforces this (`WorkspaceDeletionNotPermittedError`) regardless of what this section's visibility suggests. */
export function DeleteWorkspaceSection({
  organizationSlug,
  workspaceSlug,
  workspaceName,
}: {
  organizationSlug: string;
  workspaceSlug: string;
  workspaceName: string;
}) {
  return (
    <ConfirmDialog
      triggerLabel="Delete workspace"
      triggerVariant="danger"
      variant="danger"
      title="Delete this workspace?"
      description={`"${workspaceName}" will become inaccessible immediately, for every member. This cannot be undone from here.`}
      confirmLabel="Delete workspace"
      formAction={deleteWorkspaceAction.bind(null, organizationSlug, workspaceSlug)}
    />
  );
}
