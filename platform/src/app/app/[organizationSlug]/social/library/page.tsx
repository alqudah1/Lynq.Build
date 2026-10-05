import Link from "next/link";
import { listBrands } from "@/lib/social-os/brands";
import { listContentItemsForUser } from "@/lib/social-os/content";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import { SOCIAL_ORGANIC_PLATFORMS, SOCIAL_VARIANT_STATUSES, socialOrganicPlatformSchema, socialVariantStatusSchema } from "@/lib/social-os/validation";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { SocialBrandSwitcher } from "@/components/social/SocialBrandSwitcher";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { firstParam, resolveBrandSelection } from "@/components/social/brand-selection";
import { PLATFORM_GLYPH, PLATFORM_SHORT_LABEL, VARIANT_STATUS_LABEL, VARIANT_STATUS_TONE, formatDateTime, socialHref } from "@/components/social/format";

export const dynamic = "force-dynamic";

const selectClass = "lynq-transition min-h-11 rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60";

export default async function SocialLibraryPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ brand?: string; status?: string; platform?: string }> }) {
  const { organizationSlug } = await params;
  const sp = await searchParams;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/library`);
  const status = socialVariantStatusSchema.safeParse(firstParam(sp.status));
  const platform = socialOrganicPlatformSchema.safeParse(firstParam(sp.platform));

  let data;
  try {
    const brands = await listBrands(db, { organizationId: organization.id, actorUserId: user.userId });
    const selection = resolveBrandSelection(brands, sp.brand, true);
    const [items, timeZone] = await Promise.all([
      listContentItemsForUser(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId: selection.brandProfileId, status: status.success ? status.data : undefined, platform: platform.success ? platform.data : undefined, limit: 100 }),
      getSocialTimezone(db, organization.id),
    ]);
    data = { brands, selection, items, timeZone };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "Content Library" });
  }
  const { brands, selection, items, timeZone } = data;
  const filtered = Boolean(status.success || platform.success);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "Library" }])} />
      <PageHeader
        title="Content Library"
        description="Every post and its per-platform versions, with where each one stands."
        actions={
          <>
            <SocialBrandSwitcher brands={brands.map((b) => ({ id: b.id, name: b.name }))} selectedBrandId={selection.selectedBrandId} />
            <Link href={socialHref(organizationSlug, "/social/create", { brand: selection.brandParam })} className="lynq-transition inline-flex min-h-11 items-center rounded-sm bg-foreground px-5 text-xs font-medium uppercase tracking-[0.08em] text-background hover:opacity-90">Create</Link>
          </>
        }
      />

      <form method="get" aria-label="Filter content" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {selection.brandParam ? <input type="hidden" name="brand" value={selection.brandParam} /> : null}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-[0.1em] text-subtle">Status</span>
          <select name="status" defaultValue={status.success ? status.data : ""} className={selectClass}>
            <option value="">Any status</option>
            {SOCIAL_VARIANT_STATUSES.filter((s) => s !== "archived").map((s) => <option key={s} value={s}>{VARIANT_STATUS_LABEL[s] ?? s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-[0.1em] text-subtle">Platform</span>
          <select name="platform" defaultValue={platform.success ? platform.data : ""} className={selectClass}>
            <option value="">Any platform</option>
            {SOCIAL_ORGANIC_PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_SHORT_LABEL[p]}</option>)}
          </select>
        </label>
        <button type="submit" className="lynq-glass lynq-transition min-h-11 rounded-sm px-5 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong">Apply</button>
        {filtered ? <Link href={socialHref(organizationSlug, "/social/library", { brand: selection.brandParam })} className="inline-flex min-h-11 items-center text-xs text-muted hover:text-foreground">Clear filters</Link> : null}
      </form>

      <section aria-labelledby="library-items" className="flex flex-col gap-3">
        <h2 id="library-items" className="text-xs uppercase tracking-[0.1em] text-subtle">{items.length} item{items.length === 1 ? "" : "s"}</h2>
        {items.length === 0 ? (
          <EmptyState title={filtered ? "Nothing matches these filters." : "No content yet."} description={filtered ? "Try another status or platform." : "Create a post in the Content Studio or ask the AI Manager to plan a week."} />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Content</Th>
                <Th>Versions</Th>
                <Th className="hidden md:table-cell">Planned</Th>
                <Th className="hidden lg:table-cell">Warnings</Th>
              </tr>
            </THead>
            <TBody>
              {items.map((item) => {
                const live = item.variants.filter((v) => !v.archivedAt);
                const dates = live.map((v) => v.publishedAt ?? v.scheduledFor).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime());
                const when = dates[0] ?? item.plannedPublishAt;
                const warnings = live.reduce((n, v) => n + v.warnings.length, 0);
                const blocking = live.some((v) => v.warnings.some((w) => w.severity === "blocking"));
                const itemHref = socialHref(organizationSlug, `/social/library/${item.id}`, { brand: selection.brandParam });
                return (
                  <Tr key={item.id}>
                    <Td>
                      <Link href={itemHref} className="flex min-h-11 flex-col justify-center hover:underline">
                        <span className="text-sm text-foreground">{item.title}</span>
                        <span className="text-xs text-subtle">{item.brandName ?? "No brand"}{item.campaignName ? ` · ${item.campaignName}` : ""}<span className="md:hidden"> · {when ? formatDateTime(when, timeZone) : "Not planned"}</span></span>
                      </Link>
                    </Td>
                    <Td>
                      <ul className="flex flex-wrap gap-1.5">
                        {live.map((v) => (
                          <li key={v.id}>
                            <Link href={socialHref(organizationSlug, `/social/library/${item.id}`, { brand: selection.brandParam, variant: v.id })} title={`${PLATFORM_SHORT_LABEL[v.platform]}: ${VARIANT_STATUS_LABEL[v.status] ?? v.status}`}>
                              <Badge tone={VARIANT_STATUS_TONE[v.status] ?? "neutral"}>
                                <span aria-hidden="true">{PLATFORM_GLYPH[v.platform]}</span>
                                <span className="sr-only">{PLATFORM_SHORT_LABEL[v.platform]}:</span>
                                {VARIANT_STATUS_LABEL[v.status] ?? v.status}
                              </Badge>
                            </Link>
                          </li>
                        ))}
                        {live.length === 0 ? <li className="text-xs text-subtle">No versions</li> : null}
                      </ul>
                    </Td>
                    <Td className="hidden text-muted md:table-cell">{when ? formatDateTime(when, timeZone) : "Not planned"}</Td>
                    <Td className="hidden lg:table-cell">{warnings ? <Badge tone={blocking ? "danger" : "warning"}>{warnings}</Badge> : <span className="text-xs text-subtle">None</span>}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}
