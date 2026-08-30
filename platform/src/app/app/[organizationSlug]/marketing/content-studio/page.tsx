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

export default async function ContentStudioPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
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
      <PageHeader title="Content Studio" description="Create brand-grounded posts, carousels, and short videos, then review and save them to the existing content calendar." />

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
        <Card className="flex flex-col gap-5 border-l-2 border-l-accent">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-accent-foreground">Creative Reference Library</p>
            <p className="mt-1 text-sm text-subtle">Save a Reel, tutorial, testimonial, cinematic treatment, post, or carousel as reusable creative direction. References teach structure and quality; brand truth still controls every claim.</p>
          </div>
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
          {references.length > 0 ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{references.map((reference) => <div key={reference.id} className="rounded-sm border border-border bg-background p-3"><div className="flex items-start justify-between gap-3"><p className="text-sm text-foreground">{reference.title}</p><Badge tone="neutral">{brandNames.get(reference.brandProfileId)}</Badge></div><p className="mt-2 line-clamp-3 text-xs text-subtle">{reference.creativeNotes}</p><a href={reference.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-accent-foreground hover:text-foreground">Open reference →</a></div>)}</div> : <p className="text-xs text-subtle">No creative references saved yet. Add the first North Star example above.</p>}
        </Card>

        <ActionForm action={generateContentStudioConceptsAction.bind(null, organizationSlug)} className="grid gap-5 rounded-md border border-border bg-elevated p-5 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <p className="text-xs uppercase tracking-[0.16em] text-accent-foreground">New content package</p>
            <p className="mt-1 text-sm text-subtle">Describe the outcome. LYNQ Office will return exactly three distinct, brand-grounded concepts.</p>
          </div>
          <SelectField label="Brand" name="brandProfileId" options={brands.map((brand) => ({ value: brand.id, label: brand.name }))} />
          <SelectField label="Format & channel" name="intendedChannel" options={["Instagram Reel", "Instagram Single-image Post", "Instagram Carousel", "TikTok Video", "YouTube Short", "LinkedIn Post", "LinkedIn Carousel", "Facebook Post", "Multi-channel Static Post", "Multi-channel Short Video"].map((value) => ({ value, label: value }))} />
          <label className="flex flex-col gap-1.5 lg:col-span-2">
            <span className="text-xs uppercase tracking-[0.1em] text-subtle">Goal or topic *</span>
            <textarea name="goal" required rows={4} maxLength={2000} placeholder="Example: Create a carousel showing parents how a child turns one idea into a playable CodeIt project." className="lynq-transition rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-subtle focus-visible:border-accent/60" />
          </label>
          {references.length > 0 ? <fieldset className="flex flex-col gap-3 lg:col-span-2"><legend className="text-xs uppercase tracking-[0.1em] text-subtle">Creative references — choose up to 5</legend><div className="grid gap-2 md:grid-cols-2">{references.map((reference) => <label key={reference.id} className="flex cursor-pointer items-start gap-3 rounded-sm border border-border bg-background p-3"><input type="checkbox" name="creativeReferenceIds" value={reference.id} className="mt-0.5 accent-current" /><span><span className="block text-sm text-foreground">{reference.title}</span><span className="block text-xs text-subtle">{brandNames.get(reference.brandProfileId)} · {reference.referenceType.replaceAll("_", " ")}</span></span></label>)}</div><p className="text-xs text-subtle">Choose references for the same brand selected above. LYNQ Office will reject cross-brand or cross-organization reference IDs.</p></fieldset> : null}
          <FormField label="Planned publish date" name="plannedPublishAt" type="datetime-local" hint="Optional — adding a date lets an approved package appear as scheduled on the calendar." />
          <div className="flex items-end"><SubmitButton pendingLabel="Creating concepts…">Generate 3 concepts</SubmitButton></div>
        </ActionForm>
        </>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Recent Content Studio work</h2>
        {drafts.length === 0 ? <p className="text-sm text-subtle">No studio packages yet.</p> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {drafts.map((draft) => (
              <Card key={draft.id} as={Link} href={`/app/${organizationSlug}/marketing/content-studio/${draft.id}`} interactive padding="sm" className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2"><span className="text-sm text-foreground">{draft.productionPackage?.title ?? draft.goal}</span><Badge tone={draft.status === "saved" ? "success" : "neutral"}>{draft.status}</Badge></div>
                <p className="line-clamp-2 text-xs text-subtle">{draft.goal}</p>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
