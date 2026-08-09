import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listBulkBatchesForUser } from "@/lib/communications-os/bulk";
import { requestBulkApprovalAction, decideBulkApprovalAction, startBulkBatchAction, cancelBulkBatchAction } from "@/lib/dashboard/actions/communications";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";

export const dynamic = "force-dynamic";

function statusTone(status: string): BadgeTone {
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "in_progress" || status === "queued" || status === "pending_approval") return "warning";
  return "neutral";
}

export default async function BatchesPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/communications/batches`);

  let organizationName: string;
  let organizationId: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    organizationId = organization.id;
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const batches = await listBulkBatchesForUser(db, { organizationId, actorUserId: user.userId });
  const requestApproval = requestBulkApprovalAction.bind(null, organizationSlug);
  const decideApproval = decideBulkApprovalAction.bind(null, organizationSlug);
  const start = startBulkBatchAction.bind(null, organizationSlug);
  const cancel = cancelBulkBatchAction.bind(null, organizationSlug);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Communications", href: `/app/${organizationSlug}/communications` }, { label: "Batches" }]} />
      <PageHeader title="Bulk batches" description="Bounded, approval-gated batches — a stable recipient snapshot, one canonical message per recipient, per-recipient consent/suppression checked individually. Never a high-volume ESP." />

      {batches.length === 0 ? (
        <EmptyState title="No batches yet." description="Batches are created from an approved Marketing content item, or directly via the API." />
      ) : (
        <ul className="flex flex-col gap-2">
          {batches.map((b) => (
            <li key={b.id}>
              <Card padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-foreground">{b.name}</span>
                  <span className="text-xs text-subtle">{b.channel} · {b.recipientSnapshotCount} recipients (max {b.maxRecipients})</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(b.status)}>{b.status}</Badge>
                  {b.status === "draft" ? (
                    <ActionForm action={requestApproval} hiddenFields={{ batchId: b.id, summary: `Approve sending "${b.name}" to ${b.recipientSnapshotCount} recipients.` }}>
                      <SubmitButton pendingLabel="Requesting…" variant="glass">Request approval</SubmitButton>
                    </ActionForm>
                  ) : null}
                  {b.status === "pending_approval" ? (
                    <>
                      <ActionForm action={decideApproval} hiddenFields={{ batchId: b.id, decision: "approved" }}>
                        <SubmitButton pendingLabel="Approving…" variant="glass">Approve</SubmitButton>
                      </ActionForm>
                      <ActionForm action={decideApproval} hiddenFields={{ batchId: b.id, decision: "rejected" }}>
                        <SubmitButton pendingLabel="Rejecting…" variant="danger">Reject</SubmitButton>
                      </ActionForm>
                    </>
                  ) : null}
                  {b.status === "approved" ? (
                    <ActionForm action={start} hiddenFields={{ batchId: b.id }}>
                      <SubmitButton pendingLabel="Starting…">Start</SubmitButton>
                    </ActionForm>
                  ) : null}
                  {(b.status === "draft" || b.status === "pending_approval" || b.status === "approved") ? (
                    <ActionForm action={cancel} hiddenFields={{ batchId: b.id }}>
                      <SubmitButton pendingLabel="Cancelling…" variant="ghost">Cancel</SubmitButton>
                    </ActionForm>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
