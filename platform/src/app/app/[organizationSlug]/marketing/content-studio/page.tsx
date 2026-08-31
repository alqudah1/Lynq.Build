import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listBrandProfiles, listStudioDrafts } from "@/lib/marketing-os/content-studio";
import { CREATIVE_REFERENCE_TYPES, listCreativeReferences } from "@/lib/marketing-os/creative-references";
import { resolveContentDraftAssistantAgent } from "@/lib/marketing-os/agents";
import { createCreativeReferenceAction, generateContentStudioConceptsAction, setupContentStudioAction } from "@/lib/dashboard/actions/marketing";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { SelectField } from "@/components/dashboard/SelectField";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STUDIO_MODES = [
  {
    key: "video",
    label: "Short video",
    kicker: "Reels · TikTok · Shorts",
    description: "Build a hook, script, shot plan, captions, cover, and a render-ready production package.",
    defaultChannel: "Instagram Reel",
    prompt: "Describe the result you want viewers to see, who it is for, and the action they should take.",
  },
  {
    key: "image",
    label: "Single image",
    kicker: "Instagram · LinkedIn · Facebook",
    description: "Create a brand-controlled visual direction, headline, post copy, caption, and asset instructions.",
    defaultChannel: "Instagram Single-image Post",
    prompt: "Describe the message, subject, visual treatment, audience, and call to action for this post.",
  },
  {
    key: "carousel",
    label: "Carousel",
    kicker: "Story-led multi-slide post",
    description: "Turn one idea into a sequenced, editable slide story with a strong cover and final CTA.",
    defaultChannel: "Instagram Carousel",
    prompt: "Describe what the audience should learn or feel across the carousel and what proof should be shown.",
  },
  {
    key: "product-demo",
    label: "Product demo",
    kicker: "Real website · Real product",
    description: "Plan a polished walkthrough using approved product screens, a visible result, and precise capture notes.",
    defaultChannel: "Multi-channel Short Video",
    prompt: "Describe the real product journey to capture, the finished result to reveal first, and the exact user action to demonstrate.",
  },
] as const;

type StudioMode = (typeof STUDIO_MODES)[number]["key"];

function isStudioMode(value: string | undefined): value is StudioMode {
  return STUDIO_MODES.some((mode) => mode.key === value);
}

export default async function ContentStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const [{ organizationSlug }, { mode }] = await Promise.all([params, searchParams]);
  const selectedMode = STUDIO_MODES.find((item) => item.key === (isStudioMode(mode) ? mode : "video")) ?? STUDIO_MODES[0];
  const db = createDbClient(loadEnv());
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/content-studio`);
  let organization;
  try {
    ({ organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId));
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const [brands, drafts, references, agentReady] = await Promise.all([
    listBrandProfiles(db, { organizationId: organization.id, actorUserId: user.userId }),
    listStudioDrafts(db, { organizationId: organization.id, actorUserId: user.userId }),
    listCreativeReferences(db, { organizationId: organization.id, actorUserId: user.userId }),
    resolveContentDraftAssistantAgent(db, organization.id).then(() => true).catch(() => false),
  ]);
  const ready = brands.length === 2 && agentReady;
  const brandNames = new Map(brands.map((brand) => [brand.id, brand.name]));

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organization.name, href: `/app/${organizationSlug}` }, { label: "Marketing", href: `/app/${organizationSlug}/marketing` }, { label: "Content Studio" }]} />
      <PageHeader
        eyebrow="AI production workspace"
        title="Content Studio"
        description="Direct brand-grounded posts, carousels, product demos, and short videos from one focused workspace—then review every output before it reaches the calendar."
        actions={<><Link href="#references" className="text-xs uppercase tracking-[0.12em] text-subtle hover:text-foreground">References</Link><Link href="#generations" className="text-xs uppercase tracking-[0.12em] text-subtle hover:text-foreground">Your generations</Link></>}
      />

      {!ready ? (
        <Card className="flex flex-col gap-4 border-l-2 border-l-accent">
          <div>
            <p className="text-sm text-foreground">One-time setup required</p>
            <p className="mt-1 text-xs text-subtle">Creates the two persistent brand profiles and connects Content Studio to the existing Content Draft Assistant. An organization owner or admin should run this once.</p>
          </div>
          <ActionForm action={setupContentStudioAction.bind(null, organizationSlug)}>
            <SubmitButton pendingLabel="Setting up…">Set up Content Studio</SubmitButton>
          </ActionForm>
        </Card>
      ) : (
        <>
          <section aria-labelledby="creation-mode-heading" className="overflow-hidden rounded-lg border border-border bg-elevated">
            <div className="border-b border-border bg-[radial-gradient(circle_at_top_right,var(--color-accent-wash),transparent_48%)] px-5 py-6 md:px-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-accent-foreground">Create with AI</p>
                  <h2 id="creation-mode-heading" className="mt-2 text-2xl font-medium text-foreground">What do you want to make?</h2>
                </div>
                <Badge tone="success" dot>Brand system active</Badge>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {STUDIO_MODES.map((studioMode) => {
                  const active = studioMode.key === selectedMode.key;
                  return (
                    <Link
                      key={studioMode.key}
                      href={`?mode=${studioMode.key}#create`}
                      aria-current={active ? "page" : undefined}
                      className={`lynq-transition rounded-md border p-4 ${active ? "border-accent/50 bg-accent-wash" : "border-border bg-background hover:border-border-strong"}`}
                    >
                      <span className="text-xs uppercase tracking-[0.12em] text-subtle">{studioMode.kicker}</span>
                      <span className="mt-2 block text-base font-medium text-foreground">{studioMode.label}</span>
                      <span className="mt-2 block text-xs leading-5 text-muted">{studioMode.description}</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            <section id="create" className="scroll-mt-6 p-5 md:p-7" aria-labelledby="create-package-heading">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-subtle">Selected mode · {selectedMode.label}</p>
                  <h3 id="create-package-heading" className="mt-1 text-lg font-medium text-foreground">Direct the first generation</h3>
                  <p className="mt-1 max-w-2xl text-sm text-muted">Give the AI the outcome, proof, and audience. It will return three distinct concepts before any media is rendered.</p>
                </div>
                <div className="flex flex-wrap gap-2 text-[0.65rem] uppercase tracking-[0.08em] text-subtle" aria-label="Creation workflow">
                  <span className="rounded-full border border-border px-3 py-1.5">1 · Direct</span>
                  <span className="rounded-full border border-border px-3 py-1.5">2 · Compare</span>
                  <span className="rounded-full border border-border px-3 py-1.5">3 · Produce</span>
                  <span className="rounded-full border border-border px-3 py-1.5">4 · Approve</span>
                </div>
              </div>
              <ActionForm action={generateContentStudioConceptsAction.bind(null, organizationSlug)} className="grid gap-5 lg:grid-cols-2">
                <SelectField label="Brand" name="brandProfileId" options={brands.map((brand) => ({ value: brand.id, label: brand.name }))} />
                <SelectField label="Format & channel" name="intendedChannel" defaultValue={selectedMode.defaultChannel} options={["Instagram Reel", "Instagram Single-image Post", "Instagram Carousel", "TikTok Video", "YouTube Short", "LinkedIn Post", "LinkedIn Carousel", "Facebook Post", "Multi-channel Static Post", "Multi-channel Short Video"].map((value) => ({ value, label: value }))} />
                <label className="flex flex-col gap-1.5 lg:col-span-2">
                  <span className="text-xs uppercase tracking-[0.1em] text-subtle">Creative direction *</span>
                  <textarea name="goal" required rows={6} maxLength={2000} placeholder={selectedMode.prompt} className="lynq-transition rounded-md border border-border bg-background px-4 py-3 text-base leading-6 text-foreground placeholder:text-subtle focus-visible:border-accent/60" />
                  <span className="text-xs text-subtle">Include the finished result, audience, hook, must-show product details, visual mood, and CTA. The brand profile supplies approved claims and styling.</span>
                </label>
                {references.length > 0 ? <fieldset className="flex flex-col gap-3 lg:col-span-2"><legend className="text-xs uppercase tracking-[0.1em] text-subtle">Visual and narrative references · choose up to 5</legend><div className="grid gap-2 md:grid-cols-2">{references.map((reference) => <label key={reference.id} className="flex cursor-pointer items-start gap-3 rounded-sm border border-border bg-background p-3 hover:border-border-strong"><input type="checkbox" name="creativeReferenceIds" value={reference.id} className="mt-0.5 accent-current" /><span><span className="block text-sm text-foreground">{reference.title}</span><span className="block text-xs text-subtle">{brandNames.get(reference.brandProfileId)} · {reference.referenceType.replaceAll("_", " ")}</span></span></label>)}</div><p className="text-xs text-subtle">References guide pacing and composition. Brand truth still controls every claim, logo, color, CTA, and product detail.</p></fieldset> : <div className="rounded-sm border border-dashed border-border p-4 lg:col-span-2"><p className="text-sm text-foreground">No reference selected</p><p className="mt-1 text-xs text-subtle">You can generate now, or add a North Star example in the Reference Library below for tighter creative direction.</p></div>}
                <FormField label="Planned publish date" name="plannedPublishAt" type="datetime-local" hint="Optional — an approved package can be placed on the content calendar." />
                <div className="flex items-end"><SubmitButton pendingLabel="Directing 3 concepts…">Generate 3 concepts</SubmitButton></div>
              </ActionForm>
            </section>
          </section>

          <section id="references" className="scroll-mt-6" aria-labelledby="references-heading">
            <details className="group rounded-md border border-border bg-elevated" open={references.length === 0}>
              <summary className="cursor-pointer list-none p-5 md:p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-accent-foreground">Creative Reference Library</p>
                    <h2 id="references-heading" className="mt-1 text-lg font-medium text-foreground">Teach the Studio what premium looks like</h2>
                    <p className="mt-1 text-sm text-muted">Save examples for hook, pacing, camera language, composition, and story structure—without copying protected creative.</p>
                  </div>
                  <Badge tone="neutral">{references.length} saved</Badge>
                </div>
              </summary>
              <div className="border-t border-border p-5 md:p-6">
                <ActionForm action={createCreativeReferenceAction.bind(null, organizationSlug)} className="grid gap-4 lg:grid-cols-2">
                  <SelectField label="Brand" name="brandProfileId" options={brands.map((brand) => ({ value: brand.id, label: brand.name }))} />
                  <SelectField label="Reference type" name="referenceType" options={CREATIVE_REFERENCE_TYPES.map((value) => ({ value, label: value.replaceAll("_", " ") }))} />
                  <FormField label="Reference name" name="title" required placeholder="Example: Parent reaction → real game tutorial" />
                  <FormField label="Reference link" name="sourceUrl" type="url" required placeholder="https://www.instagram.com/reel/…" />
                  <label className="flex flex-col gap-1.5 lg:col-span-2"><span className="text-xs uppercase tracking-[0.1em] text-subtle">Transcript or spoken copy</span><textarea name="transcript" rows={5} maxLength={12000} placeholder="Paste the transcript so the machine can understand the narrative structure." className="lynq-transition rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-subtle focus-visible:border-accent/60" /></label>
                  <label className="flex flex-col gap-1.5"><span className="text-xs uppercase tracking-[0.1em] text-subtle">What should we borrow? *</span><textarea name="creativeNotes" required rows={5} maxLength={4000} placeholder="Hook, pacing, camera movement, transformation, tutorial structure, captions…" className="lynq-transition rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-subtle focus-visible:border-accent/60" /></label>
                  <label className="flex flex-col gap-1.5"><span className="text-xs uppercase tracking-[0.1em] text-subtle">Adaptation and do-not-copy rules</span><textarea name="adaptationRules" rows={5} maxLength={4000} placeholder="Use our mascot and real product. Do not copy wording, characters, music, credentials, footage, or unsupported claims." className="lynq-transition rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-subtle focus-visible:border-accent/60" /></label>
                  <div className="lg:col-span-2"><SubmitButton pendingLabel="Saving reference…">Save creative reference</SubmitButton></div>
                </ActionForm>
                {references.length > 0 ? <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{references.map((reference) => <div key={reference.id} className="rounded-sm border border-border bg-background p-3"><div className="flex items-start justify-between gap-3"><p className="text-sm text-foreground">{reference.title}</p><Badge tone="neutral">{brandNames.get(reference.brandProfileId)}</Badge></div><p className="mt-2 line-clamp-3 text-xs text-subtle">{reference.creativeNotes}</p><a href={reference.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-accent-foreground hover:text-foreground">Open reference →</a></div>)}</div> : null}
              </div>
            </details>
          </section>
        </>
      )}

      <section id="generations" className="flex scroll-mt-6 flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs uppercase tracking-[0.16em] text-accent-foreground">Output gallery</p><h2 className="mt-1 text-lg font-medium text-foreground">Your generations</h2></div>
          <Link href={`/app/${organizationSlug}/marketing/content`} className="text-xs uppercase tracking-[0.1em] text-subtle hover:text-foreground">Open content library →</Link>
        </div>
        {drafts.length === 0 ? <p className="text-sm text-subtle">No studio packages yet.</p> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {drafts.map((draft) => (
              <Card key={draft.id} as={Link} href={`/app/${organizationSlug}/marketing/content-studio/${draft.id}`} interactive padding="sm" className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2"><span className="text-sm font-medium text-foreground">{draft.productionPackage?.title ?? draft.goal}</span><Badge tone={draft.status === "saved" ? "success" : "neutral"}>{draft.status}</Badge></div>
                <p className="line-clamp-2 text-xs text-subtle">{draft.goal}</p>
                <div className="mt-auto flex items-center justify-between border-t border-border pt-3"><span className="text-[0.65rem] uppercase tracking-[0.08em] text-subtle">{draft.intendedChannel}</span><span className="text-xs text-accent-foreground">Continue →</span></div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
