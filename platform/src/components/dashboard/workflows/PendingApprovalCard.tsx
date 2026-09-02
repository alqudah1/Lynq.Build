"use client";

import Link from "next/link";
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

export function PendingApprovalCard({ approval, reviewHref, approveAction, rejectAction, revisionAction }: { approval: PendingApprovalView; reviewHref?: string; approveAction: () => Promise<ActionResult>; rejectAction: (formData: FormData) => Promise<ActionResult>; revisionAction: (formData: FormData) => Promise<ActionResult> }) {
  const [approveState, approveFormAction] = useActionState(async () => approveAction(), initialState);
  const [rejectState, rejectFormAction] = useActionState(async (_prev: ActionResult, formData: FormData) => rejectAction(formData), initialState);
  const [revisionState, revisionFormAction] = useActionState(async (_prev: ActionResult, formData: FormData) => revisionAction(formData), initialState);

  return (
    <Card as="li" padding="sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{approval.requestedAction}</p>
        <Badge tone={RISK_TONE[approval.riskLevel] ?? "neutral"}>{approval.riskLevel} risk</Badge>
      </div>
      <p className="mt-1 text-sm text-muted">{approval.summary}</p>
      <p className="mt-1 text-xs uppercase tracking-[0.08em] text-subtle">Expires {approval.expiresAt.toLocaleString()}</p>
      {reviewHref ? <Link href={reviewHref} className="mt-3 inline-flex text-sm font-medium text-foreground underline underline-offset-4 hover:text-accent-foreground">Review the evidence →</Link> : null}
      <div className="mt-3 flex flex-wrap gap-3">
        <form action={approveFormAction}>
          <SubmitButton pendingLabel="Approving…">Approve</SubmitButton>
        </form>
        <form action={revisionFormAction} className="flex flex-wrap items-end gap-2">
          <label htmlFor={`revision-note-${approval.id}`} className="sr-only">
            Change request
          </label>
          <input
            id={`revision-note-${approval.id}`}
            name="decisionNote"
            placeholder="What should Jarvis change?"
            className="lynq-transition min-h-11 rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60"
          />
          <SubmitButton variant="glass" pendingLabel="Sending back…">Request changes</SubmitButton>
        </form>
        <form action={rejectFormAction}>
          <input type="hidden" name="decisionNote" value="Founder stopped this work." />
          <SubmitButton variant="danger" pendingLabel="Stopping…">Stop</SubmitButton>
        </form>
      </div>
      {!approveState.ok ? <StatusMessage tone="error" message={approveState.message} /> : null}
      {!revisionState.ok ? <StatusMessage tone="error" message={revisionState.message} /> : null}
      {!rejectState.ok ? <StatusMessage tone="error" message={rejectState.message} /> : null}
    </Card>
  );
}
