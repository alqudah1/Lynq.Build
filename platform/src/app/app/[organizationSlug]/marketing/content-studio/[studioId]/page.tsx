import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getStudioDraftForUser, listBrandProfiles } from "@/lib/marketing-os/content-studio";
import { listCampaignsForUser } from "@/lib/marketing-os/campaigns";
import { generateContentStudioPackageAction, saveContentStudioToPipelineAction } from "@/lib/dashboard/actions/marketing";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export const dynamic = "force-dynamic";
export const maxDuration = 800;
const fieldClass = "lynq-transition rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-accent/60";

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5"><span className="text-xs uppercase tracking-[0.1em] text-subtle">{text}</span>{children}</label>;
}

export default async function ContentStudioDetailPage({ params }: { params: Promise<{ organizationSlug: string; studioId: string }> }) {
  const { organizationSlug, studioId } = await params;
  const db = createDbClient(loadEnv());
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/content-studio/${studioId}`);
  let organization;
  try { ({ organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId)); }
  catch (err) { if (err instanceof TenantResourceNotFoundError) notFound(); throw err; }

  let studio;
  try { studio = await getStudioDraftForUser(db, { organizationId: organization.id, studioId, actorUserId: user.userId }); }
  catch (err) { if (err instanceof TenantResourceNotFoundError) notFound(); throw err; }
  const [brands, allCampaigns] = await Promise.all([
    listBrandProfiles(db, { organizationId: organization.id, actorUserId: user.userId }),
    listCampaignsForUser(db, { organizationId: organization.id, actorUserId: user.userId }),
  ]);
  const brand = brands.find((item) => item.id === studio.brandProfileId);
  const campaigns = allCampaigns.filter((campaign) => campaign.workspaceId === studio.workspaceId && campaign.status !== "archived" && campaign.status !== "cancelled");
  const pkg = studio.productionPackage;

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organization.name, href: `/app/${organizationSlug}` }, { label: "Marketing", href: `/app/${organizationSlug}/marketing` }, { label: "Content Studio", href: `/app/${organizationSlug}/marketing/content-studio` }, { label: pkg?.title ?? "Concepts" }]} />
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3"><h1 className="font-serif text-3xl italic font-light text-foreground">{pkg?.title ?? "Choose a concept"}</h1><Badge tone={studio.status === "saved" ? "success" : "neutral"}>{studio.status}</Badge></div>
        <p className="max-w-3xl text-sm text-muted">{brand?.name} · {studio.intendedChannel} · {studio.goal}</p>
      </header>

      {!pkg ? (
        <section className="grid gap-4 lg:grid-cols-3">
          {studio.concepts.map((concept, index) => (
            <Card key={concept.id} className="flex flex-col gap-4">
              <div className="flex items-center justify-between"><span className="text-xs uppercase tracking-[0.16em] text-accent-foreground">Concept {index + 1}</span><Badge tone="neutral">{concept.format}</Badge></div>
              <div><h2 className="text-lg text-foreground">{concept.title}</h2><p className="mt-2 text-sm text-subtle">{concept.angle}</p></div>
              <p className="text-xs text-muted"><span className="text-foreground">Hook direction:</span> {concept.hookDirection}</p>
              <ActionForm action={generateContentStudioPackageAction.bind(null, organizationSlug, studio.id)} hiddenFields={{ conceptId: concept.id, expectedRevision: studio.revision }}>
                <SubmitButton pendingLabel="Building package…">Choose this concept</SubmitButton>
              </ActionForm>
            </Card>
          ))}
        </section>
      ) : studio.status === "saved" && studio.contentItemId ? (
        <Card className="flex flex-col gap-4 border-l-2 border-l-accent">
          <div><p className="text-sm text-foreground">Saved to the Marketing OS pipeline</p><p className="mt-1 text-xs text-subtle">The immutable production package, approval state and planned date now live on the canonical content item.</p></div>
          <Link href={`/app/${organizationSlug}/marketing/content/${studio.contentItemId}`} className="text-sm text-accent-foreground hover:text-foreground">Open content item →</Link>
        </Card>
      ) : (
        <ActionForm action={saveContentStudioToPipelineAction.bind(null, organizationSlug, studio.id)} className="flex flex-col gap-8">
          <input type="hidden" name="expectedRevision" value={studio.revision} />
          <input type="hidden" name="contentKind" value={pkg.contentKind} />
          <Card className="grid gap-5 lg:grid-cols-2">
            <Label text="Package title"><input name="title" required maxLength={200} defaultValue={pkg.title} className={fieldClass} /></Label>
            <Label text="Cover text"><input name="coverText" required maxLength={120} defaultValue={pkg.coverText} className={fieldClass} /></Label>
            <Label text="Hook / opening options — one per line"><textarea name="hooks" required rows={6} defaultValue={pkg.hooks.join("\n")} className={fieldClass} /></Label>
            <Label text="Selected hook / opening"><textarea name="selectedHook" required rows={6} defaultValue={pkg.selectedHook} className={fieldClass} /></Label>
          </Card>

          {pkg.contentKind === "short_video" ? (
            <>
              <Card><Label text="Word-for-word script"><textarea name="script" required rows={10} defaultValue={pkg.script} className={fieldClass} /></Label></Card>
              <section className="flex flex-col gap-3"><h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Storyboard / shot list</h2>{pkg.shots.map((shot, index) => (
                <Card key={`${shot.timing}-${index}`} padding="sm" className="grid gap-3 lg:grid-cols-[140px_1fr_1fr_1fr]">
                  <Label text="Timing"><input name="shotTiming" required defaultValue={shot.timing} className={fieldClass} /></Label>
                  <Label text="Visual"><textarea name="shotVisual" required rows={3} defaultValue={shot.visual} className={fieldClass} /></Label>
                  <Label text="On-screen text"><textarea name="shotText" rows={3} defaultValue={shot.onScreenText} className={fieldClass} /></Label>
                  <Label text="Audio / voice"><textarea name="shotAudio" rows={3} defaultValue={shot.audio} className={fieldClass} /></Label>
                </Card>
              ))}</section>
            </>
          ) : (
            <>
              <Card><Label text="Final post copy"><textarea name="postCopy" required rows={10} defaultValue={pkg.postCopy} className={fieldClass} /></Label></Card>
              <section className="flex flex-col gap-3"><h2 className="text-xs uppercase tracking-[0.1em] text-subtle">{pkg.contentKind === "carousel_post" ? "Carousel panels" : "Post creative"}</h2>{pkg.panels.map((panel, index) => (
                <Card key={`${panel.position}-${index}`} padding="sm" className="grid gap-3 lg:grid-cols-[140px_1fr_1fr_1fr]">
                  <Label text="Position"><input name="panelPosition" required defaultValue={panel.position} className={fieldClass} /></Label>
                  <Label text="Purpose"><textarea name="panelPurpose" required rows={3} defaultValue={panel.purpose} className={fieldClass} /></Label>
                  <Label text="Visual direction"><textarea name="panelVisual" required rows={3} defaultValue={panel.visual} className={fieldClass} /></Label>
                  <Label text="Overlay text"><textarea name="panelOverlayText" rows={3} defaultValue={panel.overlayText} className={fieldClass} /></Label>
                </Card>
              ))}</section>
            </>
          )}

          <Card className="grid gap-5 lg:grid-cols-2">
            <Label text="Caption"><textarea name="caption" required rows={8} defaultValue={pkg.caption} className={fieldClass} /></Label>
            <Label text="Asset instructions — one per line"><textarea name="assetInstructions" required rows={8} defaultValue={pkg.assetInstructions.join("\n")} className={fieldClass} /></Label>
            <div className="lg:col-span-2"><Label text="Call to action"><input name="callToAction" required defaultValue={pkg.callToAction} className={fieldClass} /></Label></div>
          </Card>

          <Card className="flex flex-col gap-5 border-l-2 border-l-accent">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><div className="flex items-center gap-3"><p className="text-sm text-foreground">Rendered media</p><Badge tone={pkg.renderingStatus === "ready" ? "success" : pkg.renderingStatus === "failed" ? "warning" : "neutral"}>{pkg.renderingStatus === "ready" ? "Ready" : pkg.renderingStatus === "failed" ? "Needs retry" : "Not rendered"}</Badge>{pkg.contentKind === "short_video" ? <Badge tone="neutral">V4 director cut · 1080×1920</Badge> : null}</div><p className="mt-1 max-w-2xl text-xs text-subtle">{brand?.brandKey === "codeitlearn" ? (pkg.contentKind === "short_video" ? "Generate a full-HD 9:16 director cut with storyboard timing, cinematic movement, polished transitions, Pixel, the CodeIt logo, and verified CodeItLearn product proof." : "Generate finished 1080×1350 artwork using the approved Pixel mascot, CodeIt logo, and real CodeItLearn product screens.") : (pkg.contentKind === "short_video" ? "Generate a full-HD 9:16 director cut with storyboard timing, editorial movement, polished transitions, exact on-screen text, and verified LYNQ work." : "Generate finished, downloadable 1080×1350 branded artwork with exact overlay text for every post or carousel panel.")}</p></div>
              <SubmitButton name="decision" value="render" variant={pkg.renderingStatus === "ready" ? "glass" : "primary"} pendingLabel={pkg.contentKind === "short_video" ? "Rendering video… this can take several minutes" : "Rendering artwork…"}>{pkg.renderingStatus === "ready" ? "Render again" : pkg.renderingStatus === "failed" ? "Retry render" : "Generate final media"}</SubmitButton>
            </div>
            {pkg.renderingError ? <p className="rounded-sm border border-danger/40 bg-danger-wash px-3 py-2 text-xs text-danger">{pkg.renderingError}</p> : null}
            {pkg.renderedAssets.length > 0 ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{pkg.renderedAssets.map((asset, index) => {
              const mediaUrl = `/api/organizations/${organization.id}/marketing/content-studio/${studio.id}/media/${index}`;
              return <div key={asset.pathname} className="flex flex-col gap-3 rounded-sm border border-border bg-background p-3">
                {asset.contentType.startsWith("video/") ? <video controls preload="metadata" src={mediaUrl} className="aspect-[9/16] w-full rounded-sm bg-black object-cover" /> : <Image unoptimized src={mediaUrl} alt={asset.label} width={1080} height={1350} className="h-auto w-full rounded-sm" />}
                <div className="flex items-center justify-between gap-3"><span className="text-xs text-subtle">{asset.label}</span><a href={`${mediaUrl}?download=1`} className="text-xs text-accent-foreground hover:text-foreground">Download →</a></div>
              </div>;
            })}</div> : null}
          </Card>

          {campaigns.length === 0 ? (
            <Card><p className="text-sm text-foreground">Create a Marketing campaign before saving this package.</p><Link href={`/app/${organizationSlug}/marketing/campaigns`} className="mt-2 inline-block text-xs text-accent-foreground">Open campaigns →</Link></Card>
          ) : (
            <Card className="flex flex-col gap-4 border-l-2 border-l-accent">
              <div><p className="text-sm text-foreground">Human review and pipeline save</p><p className="mt-1 text-xs text-subtle">Choose the canonical campaign. “Approve” records a real human approval; neither action publishes to any channel.</p></div>
              <SelectField label="Campaign" name="campaignId" options={campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name }))} />
              <div className="flex flex-wrap gap-3"><SubmitButton name="decision" value="approve" pendingLabel="Approving and saving…">Approve & add to calendar</SubmitButton><SubmitButton name="decision" value="review" variant="glass" pendingLabel="Saving for review…">Save & request approval</SubmitButton></div>
            </Card>
          )}
        </ActionForm>
      )}
    </div>
  );
}
