import Link from "next/link";
import { listBrands } from "@/lib/social-os/brands";
import { describeConnectionCenter } from "@/lib/social-os/connections";
import { hasMarketingCapability, resolveMarketingAuthContext } from "@/lib/marketing-os/authz";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-os/validation";
import { createBrandAction } from "@/lib/dashboard/actions/social";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SocialActionForm } from "@/components/social/SocialActionForm";
import { TextAreaField, TextField } from "@/components/social/fields";
import { Chip, SectionHeading } from "@/components/social/parts";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { firstParam } from "@/components/social/brand-selection";
import { socialHref } from "@/components/social/format";

export const dynamic = "force-dynamic";

export default async function SocialBrandsPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ brand?: string }> }) {
  const { organizationSlug } = await params;
  const sp = await searchParams;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/brands`);

  let data;
  try {
    const [brands, center, ctx] = await Promise.all([
      listBrands(db, { organizationId: organization.id, actorUserId: user.userId }),
      describeConnectionCenter(db, { organizationId: organization.id, actorUserId: user.userId }),
      resolveMarketingAuthContext(db, { organizationId: organization.id, actorUserId: user.userId }),
    ]);
    data = { brands, center, ctx };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "Brands" });
  }
  const { brands, center, ctx } = data;
  const canManage = hasMarketingCapability(ctx, "marketing_manage_brands");
  const brandParam = firstParam(sp.brand);
  const accountsByBrand = new Map<string, { total: number; connected: number }>();
  for (const a of center.accounts) {
    const entry = accountsByBrand.get(a.brandProfileId) ?? { total: 0, connected: 0 };
    entry.total += 1;
    if (a.connectionStatus === "connected") entry.connected += 1;
    accountsByBrand.set(a.brandProfileId, entry);
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "Brands" }])} />
      <PageHeader title="Brands" description="Each brand is the context the AI writes from — voice, offer, guardrails and visuals — and the home of its accounts." />

      <section aria-labelledby="brands-list" className="flex flex-col gap-3">
        <SectionHeading id="brands-list">{brands.length} brand{brands.length === 1 ? "" : "s"}</SectionHeading>
        {brands.length === 0 ? (
          <EmptyState title="No brands yet." description={canManage ? "Add your first brand below — everything in Social hangs off a brand." : "Ask a marketing manager to add a brand."} />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {brands.map((b) => {
              const counts = accountsByBrand.get(b.id) ?? { total: 0, connected: 0 };
              return (
                <li key={b.id}>
                  <Card as={Link} href={socialHref(organizationSlug, `/social/brands/${b.id}`, { brand: b.id })} interactive padding="sm" className={`flex h-full flex-col gap-3 ${brandParam === b.id ? "border-border-strong" : ""}`}>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-base text-foreground">{b.name}</span>
                      <span className="text-xs text-subtle">{b.brandKey}{b.geographicMarket ? ` · ${b.geographicMarket}` : ""}</span>
                    </div>
                    {b.positioning ? <p className="line-clamp-2 text-sm text-muted">{b.positioning}</p> : <p className="text-sm text-subtle">No positioning written yet.</p>}
                    <div className="flex flex-wrap gap-1.5">
                      {b.preferredPlatforms.length ? b.preferredPlatforms.map((p) => <Badge key={p}>{SOCIAL_PLATFORM_LABELS[p] ?? p}</Badge>) : <span className="text-xs text-subtle">No preferred platforms</span>}
                    </div>
                    {b.contentPillars.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {b.contentPillars.slice(0, 6).map((p) => <Chip key={p}>{p}</Chip>)}
                      </div>
                    ) : null}
                    <span className="mt-auto text-xs text-subtle">
                      {counts.total ? `${counts.total} account${counts.total === 1 ? "" : "s"}, ${counts.connected} connected` : "No accounts yet"}
                    </span>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canManage ? (
        <section aria-labelledby="brands-add" className="flex flex-col gap-3">
          <SectionHeading id="brands-add">Add a brand</SectionHeading>
          <Card>
            <details open={brands.length === 0}>
              <summary className="flex min-h-11 cursor-pointer items-center text-sm text-foreground">New brand — the rest can be filled in on its page</summary>
              <SocialActionForm action={createBrandAction.bind(null, organizationSlug)} className="flex flex-col gap-4 pt-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Name" name="name" id="new-brand-name" required maxLength={120} placeholder="e.g. LYNQ" />
                  <TextField label="Key" name="brandKey" id="new-brand-key" required maxLength={40} placeholder="e.g. lynq" hint="Lowercase letters, digits and hyphens. Cannot be changed later." />
                </div>
                <TextAreaField label="Positioning" name="positioning" id="new-brand-positioning" maxLength={4000} placeholder="What the brand is and why it is different" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextAreaField label="Audience" name="audience" id="new-brand-audience" maxLength={4000} />
                  <TextAreaField label="Voice" name="voice" id="new-brand-voice" maxLength={4000} placeholder="e.g. direct, warm, no jargon" />
                </div>
                <TextAreaField label="Products and services" name="productContext" id="new-brand-product" maxLength={6000} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextAreaField label="Claims guardrails" name="claimsGuardrails" id="new-brand-guardrails" maxLength={4000} placeholder="What the AI must never promise" />
                  <TextAreaField label="Visual rules" name="visualRules" id="new-brand-visual" maxLength={4000} />
                </div>
                <div className="[&_button]:w-full sm:[&_button]:w-auto">
                  <SubmitButton pendingLabel="Creating…">Create brand</SubmitButton>
                </div>
              </SocialActionForm>
            </details>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
