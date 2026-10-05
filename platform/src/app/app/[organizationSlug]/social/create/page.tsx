import Link from "next/link";
import { listBrands } from "@/lib/social-os/brands";
import { listAccountsForBrand } from "@/lib/social-os/connections";
import { listCampaignsForUser } from "@/lib/marketing-os/campaigns";
import { describeAiProviders, loadSocialAiEnv } from "@/lib/social-os/providers/ai/registry";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import { SOCIAL_CONTENT_KINDS, SOCIAL_CONTENT_OBJECTIVES, SOCIAL_ORGANIC_PLATFORMS, isOrganicPlatform, type SocialOrganicPlatform } from "@/lib/social-os/validation";
import { createSocialContentAction } from "@/lib/dashboard/actions/social";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SocialBrandSwitcher } from "@/components/social/SocialBrandSwitcher";
import { IdeasPanel } from "@/components/social/IdeasPanel";
import { LabeledSelect, TextAreaField, TextField } from "@/components/social/fields";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { firstParam, resolveBrandSelection } from "@/components/social/brand-selection";
import { CONNECTION_STATUS_LABEL, CONNECTION_STATUS_TONE, PLATFORM_SHORT_LABEL, humanize, socialHref } from "@/components/social/format";

export const dynamic = "force-dynamic";

type CreateSearchParams = { brand?: string; title?: string; kind?: string; objective?: string; topic?: string; hook?: string; platforms?: string; platform?: string; date?: string };

export default async function SocialCreatePage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<CreateSearchParams> }) {
  const { organizationSlug } = await params;
  const sp = await searchParams;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/create`);

  let data;
  try {
    const brands = await listBrands(db, { organizationId: organization.id, actorUserId: user.userId });
    const selection = resolveBrandSelection(brands, sp.brand, false);
    const [accounts, campaigns, providers, timeZone] = await Promise.all([
      selection.brandProfileId ? listAccountsForBrand(db, { organizationId: organization.id, brandProfileId: selection.brandProfileId, actorUserId: user.userId }) : Promise.resolve([]),
      listCampaignsForUser(db, { organizationId: organization.id, actorUserId: user.userId, limit: 100 }),
      loadSocialAiEnv().then(describeAiProviders),
      getSocialTimezone(db, organization.id),
    ]);
    data = { brands, selection, accounts, campaigns, providers, timeZone };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "Create content" });
  }
  const { brands, selection, accounts, campaigns, providers, timeZone } = data;
  const brand = brands.find((b) => b.id === selection.brandProfileId) ?? null;
  const textConfigured = providers.some((p) => p.kind === "text" && p.configured);

  const requested = (firstParam(sp.platforms) ?? firstParam(sp.platform) ?? "").split(",").filter((p): p is SocialOrganicPlatform => (SOCIAL_ORGANIC_PLATFORMS as readonly string[]).includes(p));
  const preferred = brand ? brand.preferredPlatforms.filter(isOrganicPlatform) : [];
  const defaultPlatforms = new Set<SocialOrganicPlatform>(requested.length ? requested : preferred.length ? preferred : ["instagram", "linkedin"]);
  const kind = (SOCIAL_CONTENT_KINDS as readonly string[]).includes(sp.kind ?? "") ? sp.kind : "text_post";
  const objective = (SOCIAL_CONTENT_OBJECTIVES as readonly string[]).includes(sp.objective ?? "") ? sp.objective : "engagement";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? `${sp.date}T10:00` : "";
  const campaignOptions = [{ value: "", label: "Always-on (default)" }, ...campaigns.filter((c) => c.status !== "archived" && c.status !== "completed").map((c) => ({ value: c.id, label: c.name }))];

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "Create" }])} />
      <PageHeader
        title="Content Studio"
        description="Describe the post once. LYNQ drafts a version per platform in the brand's voice — nothing is published without approval."
        actions={<SocialBrandSwitcher brands={brands.map((b) => ({ id: b.id, name: b.name }))} selectedBrandId={selection.selectedBrandId} allowAll={false} />}
      />

      {!brand ? (
        <EmptyState title="Add a brand first." description="Content is always created for a brand so the AI has the right voice, audience and guardrails." action={<Link href={socialHref(organizationSlug, "/social/brands")} className="text-sm text-foreground underline underline-offset-4">Go to Brands</Link>} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
          <section aria-labelledby="create-brief" className="flex flex-col gap-3">
            <h2 id="create-brief" className="text-xs uppercase tracking-[0.1em] text-subtle">Brief for {brand.name}</h2>
            <Card>
              <ActionForm action={createSocialContentAction.bind(null, organizationSlug)} hiddenFields={{ brandProfileId: brand.id }} className="flex flex-col gap-5">
                <TextField label="Working title" name="title" defaultValue={firstParam(sp.title)} maxLength={200} placeholder="e.g. Fall coding camp is open" hint="Internal name. Leave blank to use the topic." />

                <fieldset className="flex flex-col gap-2">
                  <legend className="text-xs uppercase tracking-[0.1em] text-subtle">Platforms *</legend>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {SOCIAL_ORGANIC_PLATFORMS.map((platform) => {
                      const onPlatform = accounts.filter((a) => a.platform === platform);
                      return (
                        <li key={platform}>
                          <label className="lynq-transition flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border border-border bg-elevated px-3 py-2 hover:border-border-strong has-[:checked]:border-border-strong has-[:checked]:bg-glass-strong">
                            <input type="checkbox" name="platforms" value={platform} defaultChecked={defaultPlatforms.has(platform)} className="mt-1 h-4 w-4 accent-white" />
                            <span className="flex min-w-0 flex-col gap-1">
                              <span className="text-sm text-foreground">{PLATFORM_SHORT_LABEL[platform]}</span>
                              {onPlatform.length ? (
                                onPlatform.map((a) => (
                                  <span key={a.id} className="flex flex-wrap items-center gap-1.5 text-xs text-subtle">
                                    {a.displayName}
                                    <Badge tone={CONNECTION_STATUS_TONE[a.connectionStatus] ?? "neutral"}>{CONNECTION_STATUS_LABEL[a.connectionStatus] ?? a.connectionStatus}</Badge>
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-subtle">No account yet — drafts only</span>
                              )}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>

                <div className="grid gap-4 sm:grid-cols-2">
                  <LabeledSelect label="Kind" name="kind" defaultValue={kind} options={SOCIAL_CONTENT_KINDS.map((k) => ({ value: k, label: humanize(k) }))} />
                  <LabeledSelect label="Objective" name="objective" defaultValue={objective} options={SOCIAL_CONTENT_OBJECTIVES.map((o) => ({ value: o, label: humanize(o) }))} />
                </div>
                <TextAreaField label="Topic" name="topic" defaultValue={firstParam(sp.topic)} maxLength={2000} placeholder="What is this post about? Facts, offer, dates." />
                <TextField label="Hook (optional)" name="hook" defaultValue={firstParam(sp.hook)} maxLength={400} placeholder="An opening line you want to keep" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Audience" name="audience" maxLength={1000} placeholder={brand.audience ? "Defaults to the brand audience" : "Who should stop scrolling?"} />
                  <TextField label="Tone" name="tone" maxLength={200} placeholder="e.g. warm, confident" />
                </div>
                <TextField label="Call to action" name="callToAction" maxLength={300} placeholder={brand.callsToAction[0] ?? "e.g. Book a free trial class"} />
                <TextAreaField label="Creative direction" name="creativeDirection" maxLength={3000} placeholder="Visual ideas, format notes, references" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label={`Planned for (${timeZone})`} name="scheduledFor" type="datetime-local" defaultValue={date} hint="Optional. Scheduling still needs approval." />
                  <LabeledSelect label="Campaign" name="campaignId" options={campaignOptions} />
                </div>

                <label className="flex min-h-11 items-start gap-3 rounded-sm border border-border px-3 py-2">
                  <input type="checkbox" name="generate" defaultChecked={textConfigured} disabled={!textConfigured} className="mt-1 h-4 w-4 accent-white" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm text-foreground">Generate with AI</span>
                    <span className="text-xs text-subtle">{textConfigured ? "Writes a hook, caption, hashtags and CTA per platform. You can edit or regenerate any part." : "No AI text provider is configured on this server, so empty drafts will be created for you to write."}</span>
                  </span>
                </label>

                <div className="[&_button]:w-full sm:[&_button]:w-auto">
                  <SubmitButton pendingLabel={textConfigured ? "Creating drafts…" : "Creating…"}>Create drafts</SubmitButton>
                </div>
              </ActionForm>
            </Card>
          </section>

          <aside aria-labelledby="create-ideas" className="flex flex-col gap-3">
            <h2 id="create-ideas" className="text-xs uppercase tracking-[0.1em] text-subtle">Need ideas?</h2>
            <Card variant="surface">
              {textConfigured ? (
                <IdeasPanel organizationId={organization.id} brandProfileId={brand.id} createPath={`/app/${organizationSlug}/social/create`} />
              ) : (
                <p className="text-sm text-muted">Idea generation needs an AI text provider (Anthropic, OpenAI or the AI Gateway) configured on the server.</p>
              )}
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
