"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import type { CrmFollowUp } from "@/lib/crm/follow-ups";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const initialState: ActionResult = { ok: true };

const STATUS_TONE: Record<string, BadgeTone> = {
  open: "warning",
  completed: "success",
  cancelled: "neutral",
};

export function FollowUpRow({
  followUp,
  assigneeName,
  redirectPath,
  completeAction,
  cancelAction,
}: {
  followUp: CrmFollowUp;
  assigneeName: string;
  redirectPath: string;
  completeAction: (formData: FormData) => Promise<ActionResult>;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [completeState, completeFormAction] = useActionState(async (_prev: ActionResult, formData: FormData) => completeAction(formData), initialState);
  const [cancelState, cancelFormAction] = useActionState(async (_prev: ActionResult, formData: FormData) => cancelAction(formData), initialState);

  return (
    <Card as="li" padding="sm" className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-foreground">{followUp.title}</span>
        <Badge tone={STATUS_TONE[followUp.status] ?? "neutral"}>{followUp.status}</Badge>
      </div>
      <p className="text-xs text-muted">
        {assigneeName} · {followUp.priority} priority{followUp.dueAt ? ` · due ${followUp.dueAt.toLocaleDateString()}` : ""}
      </p>
      {followUp.status === "open" ? (
        <div className="flex gap-3">
          <form action={completeFormAction}>
            <input type="hidden" name="expectedRevision" value={followUp.revision} />
            <input type="hidden" name="redirectPath" value={redirectPath} />
            <SubmitButton>Complete</SubmitButton>
          </form>
          <form action={cancelFormAction}>
            <input type="hidden" name="expectedRevision" value={followUp.revision} />
            <input type="hidden" name="redirectPath" value={redirectPath} />
            <SubmitButton variant="danger">Cancel</SubmitButton>
          </form>
        </div>
      ) : null}
      {!completeState.ok ? <StatusMessage tone="error" message={completeState.message} /> : null}
      {!cancelState.ok ? <StatusMessage tone="error" message={cancelState.message} /> : null}
    </Card>
  );
}
