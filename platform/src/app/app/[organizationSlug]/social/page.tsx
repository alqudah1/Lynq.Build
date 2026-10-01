import Link from "next/link";
import { getSocialOverview } from "@/lib/social-os/overview";
import { describeConnectionCenter } from "@/lib/social-os/connections";
import { listBrands } from "@/lib/social-os/brands";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import { planWeekAction } from "@/lib/dashboard/actions/social";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SocialBrandSwitcher } from "@/components/social/SocialBrandSwitcher";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { resolveBrandSelection } from "@/components/social/brand-selection";
import {
  CONNECTION_STATUS_LABEL,
  CONNECTION_STATUS_TONE,
  PLATFORM_SHORT_LABEL,
  SEVERITY_TONE,
  VARIANT_STATUS_LABEL,
  VARIANT_STATUS_TONE,
  formatDateTime,
  formatUsd,
  resolveAttentionPath,
  socialHref,
} from "@/components/social/format";

export const dynamic = "force-dynamic";

const ISSUE_STATUSES = ["authorization_required", "token_expired", "error", "missing_configuration"] as const;
const linkButton = "lynq-transition inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-5 text-xs font-medium uppercase tracking-[0.08em]";

export default async function SocialOverviewPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ brand?: string }> }) {
  const { organizationSlug } = await params;
  const sp = await searchParams;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social`);

  let data;
  try {
    const brands = await listBrands(db, { organizationId: organization.id, actorUserId: user.userId });
    const selection = resolveBrandSelection(brands, sp.brand, true);
    const [overview, center, timeZone] = await Promise.all([
      getSocialOverview(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId: selection.brandProfileId }),
      describeConnectionCenter(db, { organizationId: organization.id, actorUserId: user.userId }),
      getSocialTimezone(db, organization.id),
    ]);
    data = { overview, center, timeZone, selection };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "Social Command Center" });
  }

  const { overview, center, timeZone, selection } = data;
  const brandParam = selection.brandParam;
  const href = (path: string, extra: Record<string, string | undefined> = {}) => socialHref(organizationSlug, path, { brand: brandParam, ...extra });
  const firstName = user.name?.trim().split(/\s+/)[0];
  const accounts = center.accounts.filter((a) => !selection.brandProfileId || a.brandProfileId === selection.brandProfileId);
  const connected = overview.connectionSummary.byStatus.connected ?? 0;
  const withIssues = ISSUE_STATUSES.reduce((sum, s) => sum + (overview.connectionSummary.byStatus[s] ?? 0), 0);
  const scheduledSoon = overview.upcoming.filter((e) => e.status === "scheduled" || e.status === "publishing").length;
  const usage = overview.aiAvailability.usage;
  const pending = overview.pipeline.ready_for_review ?? 0;

  const kpis: { label: string; value: string; detail?: string; href: string; tone?: "warning" | "danger" }[] = [
    { label: "Pending approvals", value: String(pending), href: href("/social/approvals"), tone: pending > 0 ? "warning" : undefined },
    { label: "Scheduled · next 7 days", value: String(scheduledSoon), href: href("/social/calendar", { view: "week" }) },
    { label: "Needs reply", value: String(overview.inbox.needsReplyCount), detail: overview.inbox.leadsCount ? `${overview.inbox.leadsCount} flagged as leads` : undefined, href: href("/social/inbox") },
    { label: "Connected accounts", value: `${connected} / ${overview.connectionSummary.total}`, detail: withIssues ? `${withIssues} need attention` : undefined, href: href("/social/connections"), tone: withIssues ? "danger" : undefined },
    { label: "AI media spend today", value: formatUsd(usage.todaySpendUsd), detail: `of ${formatUsd(usage.dailyBudgetUsd)} daily budget`, href: href("/social/create"), tone: usage.dailyBudgetUsd > 0 && usage.todaySpendUsd >= usage.dailyBudgetUsd ? "danger" : undefined },
  ];

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [])} />
      <PageHeader
        eyebrow="Social Command Center"
        title={`${overview.attention.greeting}${firstName ? `, ${firstName}` : ""}`}
        description={selection.brandName ? `Here is what ${selection.brandName} needs from you today.` : "Here is what your brands need from you today."}
        actions={<SocialBrandSwitcher brands={overview.brands} selectedBrandId={selection.selectedBrandId} />}
      />

      {overview.brands.length === 0 ? (
        <EmptyState title="No brands yet." description="Social works per brand — voice, audience, platforms and guardrails. Add a brand to start planning content." action={<Link href={href("/social/brands")} className={`${linkButton} bg-foreground text-background hover:opacity-90`}>Set up a brand</Link>} />
      ) : null}

      <section aria-labelledby="social-attention" className="flex flex-col gap-3">
        <h2 id="social-attention" className="text-xs uppercase tracking-[0.1em] text-subtle">Needs your attention</h2>
        {overview.attention.items.length === 0 ? (
          <Card variant="surface" padding="sm"><p className="text-sm text-muted">Nothing needs you right now. Approvals, failed posts, inbox and connections are all clear.</p></Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {overview.attention.items.map((item) => (
              <li key={item.id}>
                <Card as={Link} href={href(resolveAttentionPath(item.path))} interactive padding="sm" className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={SEVERITY_TONE[item.severity] ?? "neutral"} dot>{item.severity}</Badge>
                      <span className="text-sm text-foreground">{item.title}</span>
                    </div>
                    <p className="text-xs text-subtle">{item.detail}</p>
                  </div>
                  {item.actionLabel ? <span className="shrink-0 text-xs text-muted">{item.actionLabel} →</span> : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Today at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpis.map((kpi) => (
          <Card key={kpi.label} as={Link} href={kpi.href} interactive padding="sm" className="flex flex-col gap-1">
            <span className="text-[0.65rem] uppercase tracking-[0.12em] text-subtle">{kpi.label}</span>
            <span className={`text-2xl ${kpi.tone === "danger" ? "text-danger" : kpi.tone === "warning" ? "text-warning" : "text-foreground"}`}>{kpi.value}</span>
            {kpi.detail ? <span className="text-xs text-subtle">{kpi.detail}</span> : null}
          </Card>
        ))}
      </section>

      <section aria-labelledby="social-connections" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="social-connections" className="text-xs uppercase tracking-[0.1em] text-subtle">Accounts</h2>
          <Link href={href("/social/connections")} className="text-xs text-muted hover:text-foreground">Connection Center →</Link>
        </div>
        {accounts.length === 0 ? (
          <EmptyState title="No social accounts for this brand." description="Connect Facebook, Instagram or LinkedIn, or track an account manually, before scheduling posts." />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <li key={a.id} className="flex min-h-11 items-center gap-2 rounded-sm border border-border bg-elevated px-3 py-1.5">
                <span className="text-xs text-foreground">{a.displayName}</span>
                <span className="text-xs text-subtle">{a.platformLabel}</span>
                <Badge tone={CONNECTION_STATUS_TONE[a.connectionStatus] ?? "neutral"}>{CONNECTION_STATUS_LABEL[a.connectionStatus] ?? a.connectionStatus}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="social-quick-actions" className="flex flex-col gap-3">
        <h2 id="social-quick-actions" className="text-xs uppercase tracking-[0.1em] text-subtle">Quick actions</h2>
        <Card variant="surface" padding="sm" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Link href={href("/social/create")} className={`${linkButton} bg-foreground text-background hover:opacity-90`}>Create a post</Link>
          {selection.brandProfileId && overview.aiAvailability.textConfigured ? (
            <ActionForm action={planWeekAction.bind(null, organizationSlug)} hiddenFields={{ brandProfileId: selection.brandProfileId }} className="flex flex-col gap-2 [&_button]:w-full sm:[&_button]:w-auto">
              <SubmitButton variant="glass" pendingLabel="Planning next week…">Plan next week</SubmitButton>
            </ActionForm>
          ) : (
            <span className="text-xs text-subtle">{!selection.brandProfileId ? "Choose a brand to plan next week." : "Planning next week needs an AI text provider (Anthropic, OpenAI or the AI Gateway)."}</span>
          )}
          <Link href={href("/social/approvals")} className={`${linkButton} lynq-glass text-foreground hover:border-border-strong`}>Open approvals{pending ? ` (${pending})` : ""}</Link>
        </Card>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="social-upcoming" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="social-upcoming" className="text-xs uppercase tracking-[0.1em] text-subtle">Next 7 days</h2>
            <Link href={href("/social/calendar", { view: "week" })} className="text-xs text-muted hover:text-foreground">Calendar →</Link>
          </div>
          {overview.upcoming.length === 0 ? (
            <EmptyState title="Nothing planned for the next 7 days." description="Create a post or plan next week to fill the calendar." />
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {overview.upcoming.map((e) => (
                <li key={e.variantId}>
                  <Link href={href(`/social/library/${e.contentItemId}`, { variant: e.variantId })} className="lynq-transition flex min-h-11 flex-col gap-1 px-4 py-3 hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm text-foreground">{e.title}</span>
                      <span className="text-xs text-subtle">{PLATFORM_SHORT_LABEL[e.platform]}{e.accountDisplayName ? ` · ${e.accountDisplayName}` : ""} · {formatDateTime(e.scheduledFor ?? e.date, timeZone)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {e.blocking ? <Badge tone="danger">Blocked</Badge> : e.warningsCount ? <Badge tone="warning">{e.warningsCount} warning{e.warningsCount === 1 ? "" : "s"}</Badge> : null}
                      <Badge tone={VARIANT_STATUS_TONE[e.status] ?? "neutral"}>{VARIANT_STATUS_LABEL[e.status] ?? e.status}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="social-recent" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="social-recent" className="text-xs uppercase tracking-[0.1em] text-subtle">Recently published</h2>
            <Link href={href("/social/publishing")} className="text-xs text-muted hover:text-foreground">Publishing →</Link>
          </div>
          {overview.recentPublished.length === 0 ? (
            <EmptyState title="Nothing published yet." description="Posts appear here only after the platform confirms them." />
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {overview.recentPublished.map((p) => (
                <li key={p.variantId} className="flex min-h-11 flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <Link href={href(`/social/library/${p.contentItemId}`, { variant: p.variantId })} className="flex min-w-0 flex-col hover:underline">
                    <span className="truncate text-sm text-foreground">{p.title}</span>
                    <span className="text-xs text-subtle">{p.platformLabel}{p.accountDisplayName ? ` · ${p.accountDisplayName}` : ""} · {formatDateTime(p.publishedAt, timeZone)}</span>
                  </Link>
                  {p.externalPostUrl ? (
                    <a href={p.externalPostUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-muted hover:text-foreground">View on {PLATFORM_SHORT_LABEL[p.platform] ?? p.platformLabel} ↗</a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
