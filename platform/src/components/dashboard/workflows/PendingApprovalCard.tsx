"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const initialState: ActionResult = { ok: true };

const RISK_TONE: Record<string, BadgeTone> = {
  low: "success",
  medium: "warning",
  high: "danger",
  critical: "danger",
};

export interface PendingApprovalView {
  id: string;
  requestedAction: string;
  summary: string;
  riskLevel: string;
  expiresAt: Date;
}

export function PendingApprovalCard({ approval, approveAction, rejectAction }: { approval: PendingApprovalView; approveAction: () => Promise<ActionResult>; rejectAction: (formData: FormData) => Promise<ActionResult> }) {
  const [approveState, approveFormAction] = useActionState(async () => approveAction(), initialState);
  const [rejectState, rejectFormAction] = useActionState(async (_prev: ActionResult, formData: FormData) => rejectAction(formData), initialState);

  return (
    <Card as="li" padding="sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{approval.requestedAction}</p>
        <Badge tone={RISK_TONE[approval.riskLevel] ?? "neutral"}>{approval.riskLevel} risk</Badge>
      </div>
      <p className="mt-1 text-sm text-muted">{approval.summary}</p>
      <p className="mt-1 text-xs uppercase tracking-[0.08em] text-subtle">Expires {approval.expiresAt.toLocaleString()}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <form action={approveFormAction}>
          <SubmitButton pendingLabel="Approving…">Approve</SubmitButton>
        </form>
        <form action={rejectFormAction} className="flex flex-wrap items-end gap-2">
          <label htmlFor={`reject-note-${approval.id}`} className="sr-only">
            Rejection note
          </label>
          <input
            id={`reject-note-${approval.id}`}
            name="decisionNote"
            placeholder="Reason (optional)"
            className="lynq-transition min-h-11 rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60"
          />
          <SubmitButton variant="danger" pendingLabel="Rejecting…">Reject</SubmitButton>
        </form>
      </div>
      {!approveState.ok ? <StatusMessage tone="error" message={approveState.message} /> : null}
      {!rejectState.ok ? <StatusMessage tone="error" message={rejectState.message} /> : null}
    </Card>
  );
}
