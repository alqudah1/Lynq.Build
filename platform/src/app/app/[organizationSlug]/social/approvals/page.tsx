import Link from "next/link";
import { listBrands } from "@/lib/social-os/brands";
import { listPendingApprovals } from "@/lib/social-os/content";
import { getGenerationSummaries, getSocialTimezone, listRecentlyDecidedVariants } from "@/lib/social-os/ui-queries";
import { hasMarketingCapability, resolveMarketingAuthContext } from "@/lib/marketing-os/authz";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SocialBrandSwitcher } from "@/components/social/SocialBrandSwitcher";
import { PlatformPreview } from "@/components/social/PlatformPreview";
import { ApprovalActions } from "@/components/social/ApprovalActions";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { resolveBrandSelection } from "@/components/social/brand-selection";
import { CONNECTION_STATUS_LABEL, CONNECTION_STATUS_TONE, PLATFORM_SHORT_LABEL, VARIANT_STATUS_LABEL, VARIANT_STATUS_TONE, formatDateTime, socialHref } from "@/components/social/format";

export const dynamic = "force-dynamic";

const DECISION: Record<string, { label: string; tone: "success" | "danger" | "warning" }> = {
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  revision_requested: { label: "Changes requested", tone: "warning" },
};

export default async function SocialApprovalsPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ brand?: string }> }) {
  const { organizationSlug } = await params;
  const sp = await searchParams;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/approvals`);

  let data;
  try {
    const brands = await listBrands(db, { organizationId: organization.id, actorUserId: user.userId });
    const selection = resolveBrandSelection(brands, sp.brand, true);
    const [pending, decided, timeZone, ctx] = await Promise.all([
      listPendingApprovals(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId: selection.brandProfileId }),
      listRecentlyDecidedVariants(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId: selection.brandProfileId, limit: 10 }),
      getSocialTimezone(db, organization.id),
      resolveMarketingAuthContext(db, { organizationId: organization.id, actorUserId: user.userId }),
    ]);
    const generations = await getGenerationSummaries(db, { organizationId: organization.id, actorUserId: user.userId, generationIds: pending.map((p) => p.variant.lastGenerationId).filter((id): id is string => Boolean(id)) });
    data = { brands, selection, pending, decided, timeZone, ctx, generations };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "Approvals" });
  }
  const { brands, selection, pending, decided, timeZone, ctx, generations } = data;
  const canApprove = hasMarketingCapability(ctx, "marketing_approve_content");
  const canPublish = hasMarketingCapability(ctx, "marketing_publish");
  const href = (path: string, extra: Record<string, string | undefined> = {}) => socialHref(organizationSlug, path, { brand: selection.brandParam, ...extra });

  return (
    <div className="flex flex-col gap-8 px-4 py-8 sm:px-6 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "Approvals" }])} />
      <PageHeader
        title="Approval Center"
        description={pending.length ? `${pending.length} post${pending.length === 1 ? "" : "s"} waiting for a decision. Nothing publishes without one.` : "Every post is reviewed here before it can be scheduled or published."}
        actions={<SocialBrandSwitcher brands={brands.map((b) => ({ id: b.id, name: b.name }))} selectedBrandId={selection.selectedBrandId} />}
      />

      <section aria-labelledby="approvals-pending" className="flex flex-col gap-3">
        <h2 id="approvals-pending" className="text-xs uppercase tracking-[0.1em] text-subtle">Waiting for you</h2>
        {pending.length === 0 ? (
          <EmptyState title="You're all caught up." description="New posts appear here when someone submits them for review." action={<Link href={href("/social/create")} className="text-sm text-foreground underline underline-offset-4">Create a post</Link>} />
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {pending.map((p) => {
              const v = p.variant;
              const gen = v.lastGenerationId ? generations.get(v.lastGenerationId) : undefined;
              const blocking = v.warnings.filter((w) => w.severity === "blocking");
              return (
                <li key={v.id}>
                  <Card padding="sm" className="flex flex-col gap-4" aria-labelledby={`approval-${v.id}`}>
                    <div className="flex flex-col gap-2">
                      <h3 id={`approval-${v.id}`} className="text-base font-medium text-foreground">{p.title}</h3>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.brandName ? <Badge>{p.brandName}</Badge> : null}
                        <Badge tone="accent">{PLATFORM_SHORT_LABEL[v.platform]}</Badge>
                        {v.accountDisplayName ? <Badge tone={CONNECTION_STATUS_TONE[v.accountStatus ?? ""] ?? "neutral"}>{v.accountDisplayName} · {CONNECTION_STATUS_LABEL[v.accountStatus ?? ""] ?? "unknown"}</Badge> : <Badge tone="warning">No account</Badge>}
                      </div>
                      <p className="text-xs text-subtle">
                        {v.scheduledFor ? `Planned for ${formatDateTime(v.scheduledFor, timeZone)}` : "No time planned"} · submitted {formatDateTime(p.submittedAt, timeZone)}
                        {gen ? ` · AI: ${gen.provider} / ${gen.model}` : v.lastGenerationId ? "" : " · written by hand"}
                      </p>
                    </div>

                    <PlatformPreview
                      platform={v.platform}
                      brandName={p.brandName}
                      accountName={v.accountDisplayName}
                      hook={v.hook}
                      body={v.body}
                      hashtags={v.hashtags}
                      callToAction={v.callToAction}
                      linkUrl={v.linkUrl}
                      format={v.format}
                      media={p.assets.map((a) => ({ id: a.id, contentType: a.contentType, previewUrl: a.previewUrl, title: a.title }))}
                      compact
                    />

                    {v.warnings.length ? (
                      <ul className="flex flex-col gap-1.5" aria-label="Checks">
                        {[...blocking, ...v.warnings.filter((w) => w.severity !== "blocking")].map((w) => (
                          <li key={`${w.code}-${w.message}`} className={`rounded-sm border px-3 py-2 text-xs ${w.severity === "blocking" ? "border-danger/30 bg-danger-wash text-danger" : w.severity === "warning" ? "border-warning/30 bg-warning-wash text-warning" : "border-border text-muted"}`}>
                            {w.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {canApprove ? (
                      <ApprovalActions organizationSlug={organizationSlug} variantId={v.id} revision={v.revision} scheduledFor={v.scheduledFor} timeZone={timeZone} canPublish={canPublish} editHref={href(`/social/library/${p.contentItemId}`, { variant: v.id })} blocked={blocking.length > 0} />
                    ) : (
                      <p className="text-sm text-muted">You can view this post but not approve it. <Link href={href(`/social/library/${p.contentItemId}`, { variant: v.id })} className="underline underline-offset-4">Open</Link></p>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="approvals-decided" className="flex flex-col gap-3">
        <h2 id="approvals-decided" className="text-xs uppercase tracking-[0.1em] text-subtle">Recently decided</h2>
        {decided.length === 0 ? (
          <p className="text-sm text-subtle">No decisions yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {decided.map((d) => (
              <li key={d.variantId}>
                <Link href={href(`/social/library/${d.contentItemId}`, { variant: d.variantId })} className="lynq-transition flex min-h-11 flex-col gap-1 px-4 py-3 hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-foreground">{d.title}</span>
                    <span className="text-xs text-subtle">{d.platformLabel}{d.brandName ? ` · ${d.brandName}` : ""} · {formatDateTime(d.decidedAt, timeZone)}{d.decisionNote ? ` · “${d.decisionNote.slice(0, 120)}”` : ""}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={DECISION[d.decision]?.tone ?? "neutral"}>{DECISION[d.decision]?.label ?? d.decision}</Badge>
                    <Badge tone={VARIANT_STATUS_TONE[d.variantStatus] ?? "neutral"}>Now {VARIANT_STATUS_LABEL[d.variantStatus] ?? d.variantStatus}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
