import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getMarketingWorkQueueForUser } from "@/lib/marketing-os/work-queue";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

function priorityTone(priority: number): BadgeTone {
  if (priority >= 80) return "danger";
  if (priority >= 55) return "warning";
  return "neutral";
}

export default async function MarketingMyWorkPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/my-work`);

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

  const queue = await getMarketingWorkQueueForUser(db, { organizationId, forUserId: user.userId, actorUserId: user.userId });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Marketing", href: `/app/${organizationSlug}/marketing` }, { label: "My Work" }]} />
      <PageHeader title="My Marketing Work" description="Derived from your owned campaigns/content, pending approvals, and workflow human tasks — nothing here is a separate task record." />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Next-best-actions</h2>
        {queue.nextBestActions.length === 0 ? (
          <EmptyState title="You're caught up." />
        ) : (
          <ul className="flex flex-col gap-2">
            {queue.nextBestActions.map((action, i) => (
              <Card as="li" key={`${action.recordType}-${action.recordId}-${i}`} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-foreground">{action.actionType.replace(/_/g, " ")}</span>
                  <span className="text-xs text-subtle">{action.explanation}</span>
                </div>
                <Badge tone={priorityTone(action.priority)}>{action.reasonCode.replace(/_/g, " ")}</Badge>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Your campaigns</h2>
        {queue.ownedCampaigns.length === 0 ? (
          <EmptyState title="No owned campaigns." />
        ) : (
          <ul className="flex flex-col gap-2">
            {queue.ownedCampaigns.map((c) => (
              <Card as="li" key={c.id} padding="sm">
                <Link href={`/app/${organizationSlug}/marketing/campaigns/${c.id}`} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-foreground">{c.name}</span>
                  <Badge tone="neutral">{c.status}</Badge>
                </Link>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Content awaiting you</h2>
        {queue.contentAwaitingReview.length === 0 ? (
          <EmptyState title="Nothing awaiting review." />
        ) : (
          <ul className="flex flex-col gap-2">
            {queue.contentAwaitingReview.map((c) => (
              <Card as="li" key={c.id} padding="sm">
                <Link href={`/app/${organizationSlug}/marketing/content/${c.id}`} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-foreground">{c.title}</span>
                  <Badge tone="neutral">{c.status}</Badge>
                </Link>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Pending approvals</h2>
        {queue.pendingMarketingApprovals.length === 0 ? (
          <EmptyState title="No pending approvals." />
        ) : (
          <ul className="flex flex-col gap-2">
            {queue.pendingMarketingApprovals.map((a) => (
              <Card as="li" key={a.id} padding="sm" className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{a.requestedAction}</span>
                <Badge tone="warning">pending</Badge>
              </Card>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
