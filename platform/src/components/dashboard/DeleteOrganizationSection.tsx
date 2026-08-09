"use client";

import { ConfirmDialog } from "./ConfirmDialog";
import { deleteOrganizationAction } from "@/lib/dashboard/actions/organizations";

/** Owner-only — the settings page only renders this section for an owner, but `softDeleteOrganization` itself still enforces owner-only regardless (an admin can never delete the organization, UI or no UI). */
export function DeleteOrganizationSection({ organizationSlug, organizationName }: { organizationSlug: string; organizationName: string }) {
  return (
    <ConfirmDialog
      triggerLabel="Delete organization"
      triggerVariant="danger"
      variant="danger"
      title="Delete this organization?"
      description={`"${organizationName}" and every workspace inside it will become inaccessible immediately, for every member. This cannot be undone from here.`}
      confirmLabel="Delete organization"
      formAction={deleteOrganizationAction.bind(null, organizationSlug)}
    />
  );
}
