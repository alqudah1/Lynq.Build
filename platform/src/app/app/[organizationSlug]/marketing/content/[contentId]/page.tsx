import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getContentItemForUser, listContentItemVersions } from "@/lib/marketing-os/content";
import { resolveCampaignById } from "@/lib/marketing-os/campaigns";
import { listApprovalLinksForEntity } from "@/lib/marketing-os/approvals";
import { agentArtifacts } from "@/db/schema";
import {
  launchContentDraftAction,
  submitContentForReviewAction,
  decideContentApprovalAction,
  scheduleContentAction,
  confirmContentPublishedAction,
  archiveContentItemAction,
} from "@/lib/dashboard/actions/marketing";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";
import type { MarketingContentStatus } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<MarketingContentStatus, BadgeTone> = { draft: "neutral", review: "info", approved: "success", scheduled: "info", published: "success", rejected: "danger", archived: "neutral" };

export default async function MarketingContentDetailPage({ params }: { params: Promise<{ organizationSlug: string; contentId: string }> }) {
  const { organizationSlug, contentId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/content/${contentId}`);

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

  let item;
  try {
    item = await getContentItemForUser(db, { organizationId, contentItemId: contentId, actorUserId: user.userId });
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const [campaign, versions, approvalLinks] = await Promise.all([
    resolveCampaignById(db, organizationId, item.campaignId),
    listContentItemVersions(db, { organizationId, contentItemId: contentId, actorUserId: user.userId }),
    listApprovalLinksForEntity(db, { organizationId, linkedEntityType: "content_item", linkedEntityId: contentId, actorUserId: user.userId }),
  ]);

  const currentArtifact = item.currentArtifactId ? (await db.select().from(agentArtifacts).where(and(eq(agentArtifacts.id, item.currentArtifactId), eq(agentArtifacts.organizationId, organizationId))))[0] : null;
  const pendingApproval = approvalLinks.find((l) => l.approval.status === "pending") ?? null;

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs
        items={[
          { label: "LYNQ", href: "/app" },
          { label: organizationName, href: `/app/${organizationSlug}` },
          { label: "Marketing", href: `/app/${organizationSlug}/marketing` },
          { label: "Content", href: `/app/${organizationSlug}/marketing/content` },
          { label: item.title },
        ]}
      />

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl italic font-light text-foreground">{item.title}</h1>
          <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
        </div>
        <p className="text-sm text-muted">
          {item.contentType.replace(/_/g, " ")} · campaign: {campaign.name}
          {item.intendedChannel ? ` · channel: ${item.intendedChannel}` : ""}
          {item.plannedPublishAt ? ` · planned publish: ${item.plannedPublishAt.toLocaleDateString()}` : ""}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Draft / current artifact</h2>
        {currentArtifact ? (
          <Card padding="md" className="flex flex-col gap-2">
            <p className="text-sm text-foreground">{currentArtifact.title}</p>
            <pre className="whitespace-pre-wrap text-xs text-subtle">{currentArtifact.content}</pre>
          </Card>
        ) : (
          <EmptyState
            title="No draft yet."
            action={
              <ActionForm action={launchContentDraftAction.bind(null, organizationSlug, contentId)}>
                <SubmitButton pendingLabel="Drafting…">Launch Content Draft Assistant</SubmitButton>
              </ActionForm>
            }
          />
        )}
        {versions.length > 0 ? <p className="text-xs text-subtle">{versions.length} version(s) — this is version {versions[0].versionNumber}.</p> : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Approval</h2>
        {item.status === "draft" && currentArtifact ? (
          <ActionForm action={submitContentForReviewAction.bind(null, organizationSlug, contentId)} className="flex flex-col gap-3 border border-border p-4">
            <FormField label="Summary for reviewer" name="summary" required />
            <input type="hidden" name="expectedRevision" value={item.revision} />
            <SubmitButton>Submit for review</SubmitButton>
          </ActionForm>
        ) : null}
        {pendingApproval ? (
          <Card padding="sm" className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-foreground">&quot;{pendingApproval.approval.requestedAction}&quot; is pending your decision.</span>
            <div className="flex gap-2">
              <ActionForm action={decideContentApprovalAction.bind(null, organizationSlug, contentId)} hiddenFields={{ approvalRequestId: pendingApproval.approvalRequestId, decision: "approved", expectedRevision: item.revision }}>
                <SubmitButton>Approve</SubmitButton>
              </ActionForm>
              <ActionForm action={decideContentApprovalAction.bind(null, organizationSlug, contentId)} hiddenFields={{ approvalRequestId: pendingApproval.approvalRequestId, decision: "rejected", expectedRevision: item.revision }}>
                <SubmitButton variant="danger">Reject</SubmitButton>
              </ActionForm>
            </div>
          </Card>
        ) : approvalLinks.length === 0 ? (
          <EmptyState title="No approval requested yet." />
        ) : (
          <p className="text-xs text-subtle">Most recent approval status: {approvalLinks[approvalLinks.length - 1]?.approval.status}</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Publishing</h2>
        <div className="flex flex-wrap gap-2">
          {item.status === "approved" ? (
            <ActionForm action={scheduleContentAction.bind(null, organizationSlug, contentId)} hiddenFields={{ expectedRevision: item.revision }}>
              <SubmitButton>Schedule</SubmitButton>
            </ActionForm>
          ) : null}
          {item.status === "scheduled" ? (
            <ActionForm action={confirmContentPublishedAction.bind(null, organizationSlug, contentId)} hiddenFields={{ expectedRevision: item.revision }}>
              <SubmitButton>Confirm published</SubmitButton>
            </ActionForm>
          ) : null}
          {item.status !== "published" && item.status !== "archived" ? (
            <ActionForm action={archiveContentItemAction.bind(null, organizationSlug, contentId)} hiddenFields={{ expectedRevision: item.revision }}>
              <SubmitButton variant="glass">Archive</SubmitButton>
            </ActionForm>
          ) : null}
        </div>
        <p className="text-xs text-subtle">&quot;Published&quot; is only ever set by this explicit confirmation — never inferred from an agent generating a draft.</p>
      </section>
    </div>
  );
}
