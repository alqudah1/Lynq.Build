import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { decideFounderApprovalAction } from "@/lib/dashboard/actions/founder";
import type { FounderApprovalItem } from "@/lib/founder-os/approval-center";

const RISK_TONE: Record<string, BadgeTone> = { critical: "danger", high: "warning", medium: "info", low: "neutral" };

/** Every decision goes through the real Agent Runtime approval functions — never a second approval system. */
export function ApprovalList({ approvals, organizationSlug }: { approvals: FounderApprovalItem[]; organizationSlug: string }) {
  if (approvals.length === 0) return <Card className="text-sm text-subtle">No approvals are pending.</Card>;
  const decide = decideFounderApprovalAction.bind(null, organizationSlug);

  return (
    <ul className="flex flex-col gap-3">
      {approvals.map((approval) => (
        <li key={approval.id}>
          <Card padding="sm" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-foreground">{approval.requestedAction}</span>
              <div className="flex items-center gap-2">
                <Badge tone="neutral">{approval.requestingSystem}</Badge>
                <Badge tone={RISK_TONE[approval.riskLevel] ?? "neutral"}>{approval.riskLevel} risk</Badge>
              </div>
            </div>
            <p className="text-xs text-subtle">{approval.summary}</p>
            <p className="text-[0.7rem] text-subtle">Expires {approval.expiresAt.toISOString().slice(0, 16).replace("T", " ")}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <ActionForm action={decide} hiddenFields={{ approvalId: approval.id, decision: "approve" }}>
                <SubmitButton variant="primary" pendingLabel="Approving…">Approve</SubmitButton>
              </ActionForm>
              <ActionForm action={decide} hiddenFields={{ approvalId: approval.id, decision: "reject" }}>
                <SubmitButton variant="danger" pendingLabel="Rejecting…">Reject</SubmitButton>
              </ActionForm>
              <ActionForm action={decide} hiddenFields={{ approvalId: approval.id, decision: "request_revision" }}>
                <SubmitButton variant="glass" pendingLabel="Requesting…">Request revision</SubmitButton>
              </ActionForm>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
