import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { computeCompanyPulse } from "@/lib/founder-os/company-pulse";
import { computeAttentionItems } from "@/lib/founder-os/attention-engine";
import { listFounderApprovals } from "@/lib/founder-os/approval-center";
import { computeExecutiveActivityFeed } from "@/lib/founder-os/activity-feed";
import { launchFounderDailyBriefAction } from "@/lib/dashboard/actions/founder";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/analytics/MetricCard";
import { AttentionList } from "@/components/founder/AttentionList";
import { ApprovalList } from "@/components/founder/ApprovalList";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export const dynamic = "force-dynamic";

const GROUP_LABELS: Record<string, string> = { growth: "Growth", sales: "Sales", marketing: "Marketing", delivery: "Delivery", operations: "Operations", communications: "Communications", ai: "AI" };

export default async function FounderHomePage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/founder`);

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

  const [companyPulse, attentionItems, approvals, activity] = await Promise.all([
    computeCompanyPulse(db, { organizationId, workspaceId: null, actorUserId: user.userId }),
    computeAttentionItems(db, { organizationId, workspaceId: null, actorUserId: user.userId }),
    listFounderApprovals(db, { organizationId, actorUserId: user.userId }),
    computeExecutiveActivityFeed(db, { organizationId, actorUserId: user.userId, limit: 10 }),
  ]);

  const launchBrief = launchFounderDailyBriefAction.bind(null, organizationSlug);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Founder" }]} />
      <PageHeader
        eyebrow="Founder Workspace"
        title="Command center"
        description="What's happening, what needs attention, and where the company is growing — every value traced to a real canonical record, never fabricated."
        actions={
          <>
            <Link href={`/app/${organizationSlug}/founder/attention`} className="text-xs text-accent">All attention items →</Link>
            <Link href={`/app/${organizationSlug}/founder/settings`} className="text-xs text-accent">Settings →</Link>
            <ActionForm action={launchBrief}>
              <SubmitButton variant="glass" pendingLabel="Generating…">Generate daily brief</SubmitButton>
            </ActionForm>
          </>
        }
      />

      {companyPulse.length === 0 ? (
        <Card className="text-sm text-subtle">No Founder Workspace metrics are visible to you yet — ask an organization admin to grant a Founder role.</Card>
      ) : (
        companyPulse.map((group) => (
          <section key={group.group} className="flex flex-col gap-3">
            <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">{GROUP_LABELS[group.group] ?? group.group}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.metrics.map((metric) => (
                <MetricCard key={metric.metricKey} metric={metric} />
              ))}
            </div>
          </section>
        ))
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">What needs your attention</h2>
          <p className="text-[0.7rem] text-subtle">Deterministic prioritization — not AI judgment.</p>
        </div>
        <AttentionList items={attentionItems.slice(0, 8)} />
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Approvals pending</h2>
            <Link href={`/app/${organizationSlug}/founder/approvals`} className="text-xs text-accent">View all →</Link>
          </div>
          <ApprovalList approvals={approvals.slice(0, 5)} organizationSlug={organizationSlug} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Recent important activity</h2>
          {activity.length === 0 ? (
            <Card className="text-sm text-subtle">No recent activity in the categories you can see.</Card>
          ) : (
            <ul className="flex flex-col gap-2">
              {activity.map((item) => (
                <li key={item.id}>
                  <Card padding="sm" className="flex items-center justify-between gap-3">
                    <span className="text-sm text-foreground">{item.eventType.replace(/_/g, " ")}</span>
                    <span className="text-xs text-subtle">{item.createdAt.slice(0, 16).replace("T", " ")}</span>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="flex flex-wrap gap-2" aria-label="Executive domain pages">
        {[
          { href: "sales", label: "Sales" },
          { href: "marketing", label: "Marketing" },
          { href: "projects", label: "Projects" },
          { href: "operations", label: "Operations" },
          { href: "agents", label: "AI Workforce" },
          { href: "decisions", label: "Decisions" },
          { href: "goals", label: "Goals" },
        ].map((d) => (
          <Link key={d.href} href={`/app/${organizationSlug}/founder/${d.href}`} className="lynq-transition rounded-sm border border-border px-3 py-1.5 text-xs text-subtle hover:border-border-strong hover:text-foreground">
            {d.label}
          </Link>
        ))}
      </section>
    </div>
  );
}
