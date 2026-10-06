import Link from "next/link";
import { getBrandForUser, listBrands } from "@/lib/social-os/brands";
import { listAccountsForBrand } from "@/lib/social-os/connections";
import { listAssets } from "@/lib/social-os/assets";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import { hasMarketingCapability, resolveMarketingAuthContext } from "@/lib/marketing-os/authz";
import { SOCIAL_PLATFORMS, SOCIAL_PLATFORM_LABELS } from "@/lib/social-os/validation";
import { archiveBrandAction, updateBrandAction } from "@/lib/dashboard/actions/social";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SocialActionForm } from "@/components/social/SocialActionForm";
import { AssetUploader } from "@/components/social/AssetUploader";
import { TextAreaField, TextField } from "@/components/social/fields";
import { CONTROL, FIELD_LABEL, SectionHeading } from "@/components/social/parts";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { ACCOUNT_STATUS_TONE, CONNECTION_STATUS_LABEL, formatDateTime, socialHref } from "@/components/social/format";

export const dynamic = "force-dynamic";

const OBJECTIVE_ROWS = 5;
const COLOR_ROWS = 6;

export default async function SocialBrandPage({ params }: { params: Promise<{ organizationSlug: string; brandProfileId: string }> }) {
  const { organizationSlug, brandProfileId } = await params;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/brands/${brandProfileId}`);

  let data;
  try {
    const brand = await getBrandForUser(db, { organizationId: organization.id, brandProfileId, actorUserId: user.userId });
    const [accounts, logos, ctx, timeZone, brands] = await Promise.all([
      listAccountsForBrand(db, { organizationId: organization.id, brandProfileId, actorUserId: user.userId }),
      listAssets(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId, assetType: "logo", limit: 24 }),
      resolveMarketingAuthContext(db, { organizationId: organization.id, actorUserId: user.userId }),
      getSocialTimezone(db, organization.id),
      listBrands(db, { organizationId: organization.id, actorUserId: user.userId }),
    ]);
    data = { brand, accounts, logos, ctx, timeZone, brands };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "Brand" });
  }
  const { brand, accounts, logos, ctx, timeZone, brands } = data;
  const canManage = hasMarketingCapability(ctx, "marketing_manage_brands") && !brand.archivedAt;
  const action = updateBrandAction.bind(null, organizationSlug, brand.id);
  const hidden = (section: string) => ({ expectedRevision: String(brand.revision), section });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "Brands", href: socialHref(organizationSlug, "/social/brands", { brand: brand.id }) }, { label: brand.name }])} />
      <PageHeader
        eyebrow={brand.brandKey}
        title={brand.name}
        description={`Last saved ${formatDateTime(brand.updatedAt, timeZone)} · revision ${brand.revision}${brands.length > 1 ? ` · one of ${brands.length} brands` : ""}`}
        actions={
          brand.archivedAt ? (
            <Badge>Archived</Badge>
          ) : canManage ? (
            <ConfirmDialog triggerLabel="Archive brand" triggerVariant="subtle" variant="danger" title={`Archive ${brand.name}?`} description="It disappears from brand switchers and nothing new can be created for it. Existing posts, accounts and history stay." confirmLabel="Archive" formAction={archiveBrandAction.bind(null, organizationSlug, brand.id)} hiddenFields={{ expectedRevision: String(brand.revision) }} />
          ) : null
        }
      />

      {brand.archivedAt ? <p className="rounded-sm border border-border px-4 py-3 text-sm text-muted">This brand is archived and read-only.</p> : !canManage ? <p className="rounded-sm border border-border px-4 py-3 text-sm text-muted">Read-only — editing brands needs the marketing manager role.</p> : null}

      <BrandSection id="brand-identity" title="Identity" description="Who the brand is. Used in every AI prompt.">
        <SocialActionForm action={action} hiddenFields={hidden("identity")} className="flex flex-col gap-4">
          <TextField label="Name" name="name" id="b-name" defaultValue={brand.name} required maxLength={120} />
          <TextAreaField label="Company info" name="companyInfo" id="b-company" defaultValue={brand.companyInfo} maxLength={6000} rows={3} />
          <TextAreaField label="Positioning" name="positioning" id="b-positioning" defaultValue={brand.positioning} maxLength={4000} rows={3} />
          <TextAreaField label="Brand story" name="brandStory" id="b-story" defaultValue={brand.brandStory} maxLength={6000} rows={4} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Market" name="geographicMarket" id="b-market" defaultValue={brand.geographicMarket} maxLength={300} placeholder="e.g. Greater Toronto Area" />
            <TextAreaField label="Websites" name="websites" id="b-websites" defaultValue={brand.websites.join("\n")} rows={2} hint="One full URL per line (https://…)." />
          </div>
          <Save disabled={!canManage} />
        </SocialActionForm>
      </BrandSection>

      <BrandSection id="brand-voice" title="Voice" description="How it sounds — and what it never says.">
        <SocialActionForm action={action} hiddenFields={hidden("voice")} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextAreaField label="Voice" name="voice" id="b-voice" defaultValue={brand.voice} maxLength={4000} rows={3} />
            <TextAreaField label="Writing style" name="writingStyle" id="b-style" defaultValue={brand.writingStyle} maxLength={4000} rows={3} />
          </div>
          <TextAreaField label="Prohibited language" name="prohibitedLanguage" id="b-prohibited" defaultValue={brand.prohibitedLanguage.join("\n")} rows={3} hint="One word or phrase per line." />
          <TextAreaField label="Approved examples" name="approvedExamples" id="b-examples" defaultValue={brand.approvedExamples.join("\n")} rows={4} hint="One example post or line per line — the AI imitates these." />
          <Save disabled={!canManage} />
        </SocialActionForm>
      </BrandSection>

      <BrandSection id="brand-offer" title="Offer and audience">
        <SocialActionForm action={action} hiddenFields={hidden("offer")} className="flex flex-col gap-4">
          <TextAreaField label="Products and services" name="productContext" id="b-product" defaultValue={brand.productContext} maxLength={6000} rows={4} />
          <TextAreaField label="Audience" name="audience" id="b-audience" defaultValue={brand.audience} maxLength={4000} rows={3} />
          <fieldset className="flex flex-col gap-3">
            <legend className={FIELD_LABEL}>Objectives</legend>
            {Array.from({ length: Math.max(OBJECTIVE_ROWS, brand.objectives.length) }, (_, i) => {
              const o = brand.objectives[i];
              return (
                <div key={i} className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_10rem]">
                  <input aria-label={`Objective ${i + 1} key`} name={`objectiveKey${i}`} defaultValue={o?.key ?? ""} maxLength={60} placeholder="key, e.g. leads" className={CONTROL} />
                  <input aria-label={`Objective ${i + 1} description`} name={`objectiveDescription${i}`} defaultValue={o?.description ?? ""} maxLength={300} placeholder="What success looks like" className={CONTROL} />
                  <input aria-label={`Objective ${i + 1} target`} name={`objectiveTarget${i}`} defaultValue={o?.target ?? ""} maxLength={120} placeholder="Target (optional)" className={CONTROL} />
                </div>
              );
            })}
            <p className="text-xs text-subtle">Leave a row empty to remove it. Key and description are both required for a row.</p>
          </fieldset>
          <Save disabled={!canManage} />
        </SocialActionForm>
      </BrandSection>

      <BrandSection id="brand-guardrails" title="Guardrails" description="Hard limits every draft is checked against.">
        <SocialActionForm action={action} hiddenFields={hidden("guardrails")} className="flex flex-col gap-4">
          <TextAreaField label="Claims guardrails" name="claimsGuardrails" id="b-claims" defaultValue={brand.claimsGuardrails} maxLength={4000} rows={3} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextAreaField label="Never claim" name="neverClaim" id="b-never" defaultValue={brand.neverClaim.join("\n")} rows={4} hint="One claim per line." />
            <TextAreaField label="Competitors" name="competitors" id="b-competitors" defaultValue={brand.competitors.join("\n")} rows={4} hint="One per line — never disparaged, never copied." />
          </div>
          <Save disabled={!canManage} />
        </SocialActionForm>
      </BrandSection>

      <BrandSection id="brand-visual" title="Visual">
        <SocialActionForm action={action} hiddenFields={hidden("visual")} className="flex flex-col gap-4">
          <TextAreaField label="Visual rules" name="visualRules" id="b-visual" defaultValue={brand.visualRules} maxLength={4000} rows={3} />
          <fieldset className="flex flex-col gap-3">
            <legend className={FIELD_LABEL}>Colors</legend>
            {Array.from({ length: Math.max(COLOR_ROWS, brand.visualIdentity.colors.length) }, (_, i) => {
              const c = brand.visualIdentity.colors[i];
              return (
                <div key={i} className="grid grid-cols-[2rem_minmax(0,1fr)_7rem] items-center gap-2 sm:grid-cols-[2rem_minmax(0,1fr)_8rem_minmax(0,1fr)]">
                  <span aria-hidden="true" className="h-8 w-8 rounded-sm border border-border" style={c ? { backgroundColor: c.hex } : undefined} />
                  <input aria-label={`Color ${i + 1} name`} name={`colorName${i}`} defaultValue={c?.name ?? ""} maxLength={40} placeholder="Name" className={CONTROL} />
                  <input aria-label={`Color ${i + 1} hex`} name={`colorHex${i}`} defaultValue={c?.hex ?? ""} maxLength={7} placeholder="#000000" className={`${CONTROL} font-mono`} />
                  <input aria-label={`Color ${i + 1} role`} name={`colorRole${i}`} defaultValue={c?.role ?? ""} maxLength={40} placeholder="Role (e.g. primary)" className={`${CONTROL} col-span-3 sm:col-span-1`} />
                </div>
              );
            })}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Heading typeface" name="typographyHeading" id="b-type-heading" defaultValue={brand.visualIdentity.typography.heading} maxLength={80} />
            <TextField label="Body typeface" name="typographyBody" id="b-type-body" defaultValue={brand.visualIdentity.typography.body} maxLength={80} />
          </div>
          <TextAreaField label="Visual notes" name="visualNotes" id="b-visual-notes" defaultValue={brand.visualIdentity.notes} maxLength={2000} rows={2} />
          <Save disabled={!canManage} />
        </SocialActionForm>
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <h3 className={FIELD_LABEL}>Logos &amp; mascot</h3>
          <p className="text-xs text-subtle">AI images for this brand are drawn from the newest three of these, so a mascot stays the same character in every post. Use a clean, well-lit picture of it.</p>
          {logos.length === 0 ? (
            <p className="text-sm text-subtle">No logo or mascot uploaded yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-3">
              {logos.map((logo) => (
                <li key={logo.id} className="flex w-32 flex-col gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, signed asset preview URL */}
                  <img src={logo.previewUrl} alt={logo.altText || logo.title} className="h-24 w-32 rounded-sm border border-border bg-elevated object-contain p-2" />
                  <span className="truncate text-xs text-subtle" title={logo.title}>{logo.title}</span>
                </li>
              ))}
            </ul>
          )}
          {canManage ? <AssetUploader organizationId={organization.id} brandProfileId={brand.id} assetType="logo" label="Upload a logo or mascot image" accept="image/png,image/jpeg,image/webp,image/gif" /> : null}
        </div>
      </BrandSection>

      <BrandSection id="brand-content" title="Content">
        <SocialActionForm action={action} hiddenFields={hidden("content")} className="flex flex-col gap-4">
          <TextAreaField label="Content pillars" name="contentPillars" id="b-pillars" defaultValue={brand.contentPillars.join("\n")} rows={4} hint="One pillar per line (up to 12)." />
          <fieldset className="flex flex-col gap-2">
            <legend className={FIELD_LABEL}>Preferred platforms</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SOCIAL_PLATFORMS.map((p) => (
                <label key={p} className="flex min-h-11 items-center gap-2 rounded-sm border border-border px-3 text-sm text-foreground">
                  <input type="checkbox" name="preferredPlatforms" value={p} defaultChecked={brand.preferredPlatforms.includes(p)} className="h-4 w-4 accent-white" />
                  {SOCIAL_PLATFORM_LABELS[p]}
                </label>
              ))}
            </div>
          </fieldset>
          <TextAreaField label="Calls to action" name="callsToAction" id="b-ctas" defaultValue={brand.callsToAction.join("\n")} rows={3} hint="One per line." />
          <Save disabled={!canManage} />
        </SocialActionForm>
      </BrandSection>

      <section aria-labelledby="brand-accounts" className="flex flex-col gap-3">
        <SectionHeading id="brand-accounts" action={<Link href={socialHref(organizationSlug, "/social/connections", { brand: brand.id })} className="text-xs text-muted hover:text-foreground">Connection Center →</Link>}>
          Accounts
        </SectionHeading>
        {accounts.length === 0 ? (
          <EmptyState title="No accounts for this brand." description="Connect or add one in the Connection Center." />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <li key={a.id} className="flex min-h-11 items-center gap-2 rounded-sm border border-border bg-elevated px-3 py-1.5">
                <span className="text-xs text-foreground">{a.displayName}</span>
                <span className="text-xs text-subtle">{a.platformLabel}</span>
                <Badge tone={ACCOUNT_STATUS_TONE[a.connectionStatus] ?? "neutral"}>{CONNECTION_STATUS_LABEL[a.connectionStatus] ?? a.connectionStatus}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BrandSection({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className="text-xs uppercase tracking-[0.1em] text-subtle">{title}</h2>
        {description ? <p className="text-xs text-subtle">{description}</p> : null}
      </div>
      <Card className="flex flex-col gap-4">{children}</Card>
    </section>
  );
}

function Save({ disabled }: { disabled: boolean }) {
  if (disabled) return null;
  return (
    <div className="[&_button]:w-full sm:[&_button]:w-auto">
      <SubmitButton variant="glass" pendingLabel="Saving…">Save</SubmitButton>
    </div>
  );
}

