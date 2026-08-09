"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import type { ProjectApprovalLink } from "@/lib/projects/links";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

const initialState: ActionResult = { ok: true };

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: "Pending approval", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  revision_requested: { label: "Revision requested", tone: "warning" },
};

/** Status shown here always comes live from the Runtime's own approval record — never a duplicated decision. */
export function ApprovalsSection({ links, projectId, action }: { links: ProjectApprovalLink[]; projectId: string; action: (formData: FormData) => Promise<ActionResult> }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <div className="flex flex-col gap-6">
      {links.length === 0 ? (
        <EmptyState title="No approval requests linked yet." />
      ) : (
        <ul className="flex flex-col gap-2">
          {links.map((link) => {
            const status = STATUS[link.status] ?? { label: link.status, tone: "neutral" as BadgeTone };
            return (
              <Card as="li" key={link.id} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                <Badge tone={status.tone}>{status.label}</Badge>
                <span className="text-sm text-muted">{link.approvalRequestId}</span>
              </Card>
            );
          })}
        </ul>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border border-border p-4">
        <div className="min-w-64 flex-1">
          <FormField label="Approval request id" name="approvalRequestId" required error={!state.ok ? state.fieldErrors?.approvalRequestId : undefined} />
        </div>
        <input type="hidden" name="linkedEntityType" value="project" />
        <input type="hidden" name="linkedEntityId" value={projectId} />
        <SubmitButton>Link approval</SubmitButton>
        {!state.ok && !state.fieldErrors ? <StatusMessage tone="error" message={state.message} /> : null}
      </form>
    </div>
  );
}
