import Link from "next/link";
import { getContentItemForUser, type SocialVariant } from "@/lib/social-os/content";
import { listAccountsForBrand } from "@/lib/social-os/connections";
import { getAssetForUser, listAssets, type SocialAssetView } from "@/lib/social-os/assets";
import { listGenerations } from "@/lib/social-os/generation";
import { describeAiProviders, loadSocialAiEnv } from "@/lib/social-os/providers/ai/registry";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import { hasMarketingCapability, resolveMarketingAuthContext } from "@/lib/marketing-os/authz";
import { SOCIAL_CONTENT_KINDS, SOCIAL_CONTENT_OBJECTIVES, SOCIAL_PLATFORM_RULES } from "@/lib/social-os/validation";
import {
  archiveContentItemAction,
  archiveVariantAction,
  attachAssetToVariantAction,
  detachAssetFromVariantAction,
  generateVariantsAction,
  publishVariantNowAction,
  regenerateVariantPartAction,
  returnVariantToDraftAction,
  scheduleVariantAction,
  submitVariantForReviewAction,
  unscheduleVariantAction,
  updateSocialBriefAction,
  updateSocialVariantAction,
} from "@/lib/dashboard/actions/social";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { PlatformPreview, type PreviewMedia } from "@/components/social/PlatformPreview";
import { RegeneratePanel, type RegeneratePart } from "@/components/social/RegeneratePanel";
import { AssetUploader } from "@/components/social/AssetUploader";
import { ApprovalActions } from "@/components/social/ApprovalActions";
import { LabeledSelect, TextAreaField, TextField } from "@/components/social/fields";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { firstParam } from "@/components/social/brand-selection";
import {
  CONNECTION_STATUS_LABEL,
  CONNECTION_STATUS_TONE,
  PLATFORM_SHORT_LABEL,
  VARIANT_STATUS_LABEL,
  VARIANT_STATUS_TONE,
  formatDateTime,
  formatUsd,
  humanize,
  socialHref,
  toDateTimeLocalValue,
} from "@/components/social/format";

export const dynamic = "force-dynamic";

const NOTICES: Record<string, { tone: "success" | "error"; message: string }> = {
  drafts_created: { tone: "success", message: "Drafts created. Write each version below, or generate them with AI." },
  ai_not_configured: { tone: "success", message: "Drafts created without AI — no text provider is configured on this server. Write each version below." },
  generated: { tone: "success", message: "A draft was generated for each platform. Review, edit, then submit for review." },
  generated_partial: { tone: "success", message: "Drafts generated. Some platforms were skipped — check each version." },
  generation_failed: { tone: "error", message: "Drafts were created, but AI generation failed. Try “Generate drafts” again." },
};

const EDITABLE = ["draft", "changes_requested", "ready_for_review", "approved"];
const TEXT_PART_STATUSES = ["draft", "changes_requested", "ready_for_review", "approved"];

export default async function SocialContentItemPage({ params, searchParams }: { params: Promise<{ organizationSlug: string; contentItemId: string }>; searchParams: Promise<{ brand?: string; variant?: string; notice?: string }> }) {
  const { organizationSlug, contentItemId } = await params;
  const sp = await searchParams;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/library/${contentItemId}`);

  let data;
  try {
    const item = await getContentItemForUser(db, { organizationId: organization.id, contentItemId, actorUserId: user.userId });
    const variants = item.variants.filter((v) => !v.archivedAt || item.archivedAt);
    const selected: SocialVariant | undefined = variants.find((v) => v.id === firstParam(sp.variant)) ?? variants[0];
    const [accounts, brandAssets, generations, providers, timeZone, ctx, media] = await Promise.all([
      item.brandProfileId ? listAccountsForBrand(db, { organizationId: organization.id, brandProfileId: item.brandProfileId, actorUserId: user.userId }) : Promise.resolve([]),
      item.brandProfileId ? listAssets(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId: item.brandProfileId, limit: 60 }) : Promise.resolve([] as SocialAssetView[]),
      listGenerations(db, { organizationId: organization.id, actorUserId: user.userId, contentItemId: item.id, limit: 30 }),
      loadSocialAiEnv().then(describeAiProviders),
      getSocialTimezone(db, organization.id),
      resolveMarketingAuthContext(db, { organizationId: organization.id, actorUserId: user.userId }),
      Promise.all((selected?.media ?? []).map((m) => getAssetForUser(db, { organizationId: organization.id, assetId: m.assetId, actorUserId: user.userId }).catch(() => null))),
    ]);
    data = { item, variants, selected, accounts, brandAssets, generations, providers, timeZone, ctx, media: media.filter((a): a is SocialAssetView => Boolean(a)) };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "Content" });
  }
  const { item, variants, selected, accounts, brandAssets, generations, providers, timeZone, ctx, media } = data;
  const brandParam = firstParam(sp.brand);
  const href = (path: string, extra: Record<string, string | undefined> = {}) => socialHref(organizationSlug, path, { brand: brandParam, ...extra });
  const notice = NOTICES[firstParam(sp.notice) ?? ""];
  const textConfigured = providers.some((p) => p.kind === "text" && p.configured);
  const imageConfigured = providers.some((p) => p.kind === "image" && p.configured);
  const videoConfigured = providers.some((p) => p.kind === "video" && p.configured);
  const canPublish = hasMarketingCapability(ctx, "marketing_publish");
  const canApprove = hasMarketingCapability(ctx, "marketing_approve_content");
  const canGenerate = hasMarketingCapability(ctx, "marketing_generate_content");
  const draftable = variants.some((v) => v.status === "draft" || v.status === "changes_requested");

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "Library", href: href("/social/library") }, { label: item.title }])} />
      <PageHeader
        title={item.title}
        description={[item.brandName, item.campaignName, humanize(item.brief.kind), humanize(item.brief.objective)].filter(Boolean).join(" · ")}
        actions={
          item.archivedAt ? (
            <Badge>Archived</Badge>
          ) : (
            <>
              {textConfigured && canGenerate && draftable ? (
                <ActionForm action={generateVariantsAction.bind(null, organizationSlug, item.id)} className="flex flex-col gap-2">
                  <SubmitButton variant="glass" pendingLabel="Generating…">Generate drafts</SubmitButton>
                </ActionForm>
              ) : null}
              <ConfirmDialog triggerLabel="Archive" triggerVariant="subtle" variant="danger" title="Archive this content?" description="All of its versions are archived and any queued publishing is cancelled. Published posts stay published." confirmLabel="Archive" formAction={archiveContentItemAction.bind(null, organizationSlug, item.id)} hiddenFields={{ expectedRevision: String(item.revision) }} />
            </>
          )
        }
      />

      {notice ? <StatusMessage tone={notice.tone} message={notice.message} /> : null}

      {variants.length === 0 || !selected ? (
        <EmptyState title="No platform versions." description="This item has no active posts. Create a new one from the Content Studio." />
      ) : (
        <>
          <nav aria-label="Platform versions" className="-mx-1 overflow-x-auto">
            <ul className="flex gap-2 px-1">
              {variants.map((v) => {
                const active = v.id === selected.id;
                return (
                  <li key={v.id} className="shrink-0">
                    <Link
                      href={href(`/social/library/${item.id}`, { variant: v.id })}
                      aria-current={active ? "page" : undefined}
                      scroll={false}
                      className={`lynq-transition flex min-h-11 items-center gap-2 rounded-sm border px-3 py-2 ${active ? "border-border-strong bg-glass-strong" : "border-border hover:border-border-strong"}`}
                    >
                      <span className="text-sm text-foreground">{PLATFORM_SHORT_LABEL[v.platform]}</span>
                      <Badge tone={VARIANT_STATUS_TONE[v.status] ?? "neutral"}>{VARIANT_STATUS_LABEL[v.status] ?? v.status}</Badge>
                      {v.warnings.some((w) => w.severity === "blocking") ? <span className="sr-only">has blocking warnings</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <VariantWorkspace
            organizationSlug={organizationSlug}
            organizationId={organization.id}
            itemId={item.id}
            brandProfileId={item.brandProfileId}
            brandName={item.brandName}
            variant={selected}
            media={media}
            accounts={accounts.filter((a) => a.platform === selected.platform)}
            brandAssets={brandAssets.filter((a) => (a.assetType === "image" || a.assetType === "video" || a.assetType === "thumbnail") && !selected.media.some((m) => m.assetId === a.id))}
            timeZone={timeZone}
            canPublish={canPublish}
            canApprove={canApprove}
            approvalsHref={href("/social/approvals")}
            editHref={href(`/social/library/${item.id}`, { variant: selected.id })}
            regenerateParts={buildParts(selected, { textConfigured, imageConfigured, videoConfigured, canGenerate })}
          />
        </>
      )}

      <section aria-labelledby="item-brief" className="flex flex-col gap-3">
        <h2 id="item-brief" className="text-xs uppercase tracking-[0.1em] text-subtle">Shared brief</h2>
        <Card variant="surface">
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm text-foreground">
              <span>{item.brief.topic ? item.brief.topic.slice(0, 140) : "No topic written yet"}</span>
              <span className="text-xs text-muted">Edit brief</span>
            </summary>
            {item.archivedAt ? (
              <p className="pt-3 text-sm text-subtle">Archived content can no longer be edited.</p>
            ) : (
              <ActionForm action={updateSocialBriefAction.bind(null, organizationSlug, item.id)} hiddenFields={{ expectedRevision: item.revision }} className="flex flex-col gap-4 pt-4">
                <TextField label="Title" name="title" defaultValue={item.title} maxLength={200} required id="brief-title" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <LabeledSelect label="Kind" name="kind" id="brief-kind" defaultValue={item.brief.kind} options={SOCIAL_CONTENT_KINDS.map((k) => ({ value: k, label: humanize(k) }))} />
                  <LabeledSelect label="Objective" name="objective" id="brief-objective" defaultValue={item.brief.objective} options={SOCIAL_CONTENT_OBJECTIVES.map((o) => ({ value: o, label: humanize(o) }))} />
                </div>
                <TextAreaField label="Topic" name="topic" id="brief-topic" defaultValue={item.brief.topic} maxLength={2000} />
                <TextField label="Hook" name="hook" id="brief-hook" defaultValue={item.brief.hook} maxLength={400} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Audience" name="audience" id="brief-audience" defaultValue={item.brief.audience} maxLength={1000} />
                  <TextField label="Tone" name="tone" id="brief-tone" defaultValue={item.brief.tone} maxLength={200} />
                </div>
                <TextField label="Call to action" name="callToAction" id="brief-cta" defaultValue={item.brief.callToAction} maxLength={300} />
                <TextAreaField label="Creative direction" name="creativeDirection" id="brief-direction" defaultValue={item.brief.creativeDirection} maxLength={3000} />
                <div className="[&_button]:w-full sm:[&_button]:w-auto">
                  <SubmitButton variant="glass" pendingLabel="Saving…">Save brief</SubmitButton>
                </div>
              </ActionForm>
            )}
          </details>
        </Card>
      </section>

      <section aria-labelledby="item-generations" className="flex flex-col gap-3">
        <h2 id="item-generations" className="text-xs uppercase tracking-[0.1em] text-subtle">AI generation history</h2>
        {generations.length === 0 ? (
          <EmptyState title="No AI generations for this content." description="Everything here was written by hand so far." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>When</Th>
                <Th>Type</Th>
                <Th className="hidden sm:table-cell">Provider</Th>
                <Th className="hidden md:table-cell">Cost</Th>
                <Th>Status</Th>
              </tr>
            </THead>
            <TBody>
              {generations.map((g) => (
                <Tr key={g.id}>
                  <Td className="text-muted">{formatDateTime(g.createdAt, timeZone)}</Td>
                  <Td>{humanize(g.generationType)}</Td>
                  <Td className="hidden text-muted sm:table-cell">{g.provider} · {g.model}</Td>
                  <Td className="hidden text-muted md:table-cell">{g.costUsd === null ? "Not reported" : formatUsd(g.costUsd)}</Td>
                  <Td>
                    <Badge tone={g.status === "succeeded" ? "success" : g.status === "failed" ? "danger" : g.status === "cancelled" ? "neutral" : "info"}>{humanize(g.status)}</Badge>
                    {g.status === "failed" && g.errorMessage ? <p className="mt-1 text-xs text-subtle">{g.errorMessage.slice(0, 200)}</p> : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function buildParts(v: SocialVariant, f: { textConfigured: boolean; imageConfigured: boolean; videoConfigured: boolean; canGenerate: boolean }): RegeneratePart[] {
  const textOk = f.canGenerate && f.textConfigured && TEXT_PART_STATUSES.includes(v.status);
  const textReason = !f.canGenerate ? "You don't have permission to generate." : !f.textConfigured ? "No AI text provider configured." : "Not editable in this state.";
  const videoOk = f.canGenerate && f.videoConfigured && (v.status === "draft" || v.status === "changes_requested");
  return [
    { part: "hook", label: "Hook", available: textOk, unavailableReason: textOk ? undefined : textReason },
    { part: "caption", label: "Caption", available: textOk, unavailableReason: textOk ? undefined : textReason },
    { part: "cta", label: "CTA", available: textOk, unavailableReason: textOk ? undefined : textReason },
    { part: "hashtags", label: "Hashtags", available: textOk, unavailableReason: textOk ? undefined : textReason },
    { part: "image", label: "Image", available: f.canGenerate && f.imageConfigured && TEXT_PART_STATUSES.includes(v.status), unavailableReason: !f.imageConfigured ? "No AI image provider configured." : undefined },
    { part: "video", label: "Video", available: videoOk, unavailableReason: !f.videoConfigured ? "No AI video provider configured." : videoOk ? undefined : "Only drafts can render a video." },
  ];
}

function VariantWorkspace({
  organizationSlug,
  organizationId,
  itemId,
  brandProfileId,
  brandName,
  variant: v,
  media,
  accounts,
  brandAssets,
  timeZone,
  canPublish,
  canApprove,
  approvalsHref,
  editHref,
  regenerateParts,
}: {
  organizationSlug: string;
  organizationId: string;
  itemId: string;
  brandProfileId: string | null;
  brandName: string | null;
  variant: SocialVariant;
  media: SocialAssetView[];
  accounts: { id: string; displayName: string; connectionStatus: string }[];
  brandAssets: SocialAssetView[];
  timeZone: string;
  canPublish: boolean;
  canApprove: boolean;
  approvalsHref: string;
  editHref: string;
  regenerateParts: RegeneratePart[];
}) {
  const rev = String(v.revision);
  const editable = EDITABLE.includes(v.status) && !v.archivedAt;
  const rules = SOCIAL_PLATFORM_RULES[v.platform];
  const previewMedia: PreviewMedia[] = media.map((a) => ({ id: a.id, contentType: a.contentType, previewUrl: a.previewUrl, title: a.altText || a.title }));
  const blocking = v.warnings.filter((w) => w.severity === "blocking");
  const others = v.warnings.filter((w) => w.severity !== "blocking");
  const bound = <A extends unknown[], R>(fn: (slug: string, id: string, ...rest: A) => R) => fn.bind(null, organizationSlug, v.id) as (...rest: A) => R;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <section aria-label="Preview" className="flex flex-col gap-2 lg:order-none">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Preview</h2>
            <div className="flex flex-wrap items-center gap-2">
              {v.accountDisplayName ? <span className="text-xs text-subtle">{v.accountDisplayName}</span> : <span className="text-xs text-warning">No account chosen</span>}
              {v.accountStatus ? <Badge tone={CONNECTION_STATUS_TONE[v.accountStatus] ?? "neutral"}>{CONNECTION_STATUS_LABEL[v.accountStatus] ?? v.accountStatus}</Badge> : null}
            </div>
          </div>
          <PlatformPreview platform={v.platform} brandName={brandName} accountName={v.accountDisplayName} hook={v.hook} body={v.body} hashtags={v.hashtags} callToAction={v.callToAction} linkUrl={v.linkUrl} media={previewMedia} format={v.format} />
          <p className="text-xs text-subtle">
            {v.body.length} / {rules.maxBodyLength} characters · {v.hashtags.length} / {rules.maxHashtags} hashtags
            {v.scheduledFor ? ` · planned ${formatDateTime(v.scheduledFor, timeZone)}` : ""}
            {v.publishedAt ? ` · published ${formatDateTime(v.publishedAt, timeZone)}` : ""}
          </p>
          {v.externalPostUrl ? <a href={v.externalPostUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted underline-offset-4 hover:text-foreground hover:underline">View the live post ↗</a> : null}
          {v.reviewNote ? <p className="rounded-sm border border-warning/30 bg-warning-wash px-3 py-2 text-xs text-warning">Reviewer note: {v.reviewNote}</p> : null}
        </section>

        {v.warnings.length ? (
          <section aria-label="Warnings" className="flex flex-col gap-2">
            <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Checks</h2>
            <ul className="flex flex-col gap-1.5">
              {[...blocking, ...others].map((w) => (
                <li key={`${w.code}-${w.message}`} className={`rounded-sm border px-3 py-2 text-xs ${w.severity === "blocking" ? "border-danger/30 bg-danger-wash text-danger" : w.severity === "warning" ? "border-warning/30 bg-warning-wash text-warning" : "border-border text-muted"}`}>
                  <span className="font-medium">{w.severity === "blocking" ? "Blocking" : w.severity === "warning" ? "Warning" : "Note"}:</span> {w.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* On a phone the actions sit at the top so approving or posting never means scrolling past the whole preview. */}
        <section aria-label="Post actions" className="order-first flex flex-col gap-2 lg:order-none">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Next step</h2>
          <Card variant="surface" padding="sm" className="flex flex-col gap-3">
            {v.archivedAt ? <p className="text-sm text-subtle">Archived.</p> : null}
            {!v.archivedAt && (v.status === "draft" || v.status === "changes_requested") ? (
              <ActionForm action={bound(submitVariantForReviewAction)} hiddenFields={{ expectedRevision: rev }} className="flex flex-col gap-2 [&_button]:w-full sm:[&_button]:w-auto">
                <SubmitButton pendingLabel="Submitting…">Submit for review</SubmitButton>
                {blocking.length ? <p className="text-xs text-danger">Fix the blocking checks first — submission will be refused.</p> : null}
              </ActionForm>
            ) : null}
            {!v.archivedAt && (v.status === "changes_requested" || v.status === "rejected") ? (
              <ActionForm action={bound(returnVariantToDraftAction)} hiddenFields={{ expectedRevision: rev }} className="[&_button]:w-full sm:[&_button]:w-auto">
                <SubmitButton variant="glass" pendingLabel="Returning…">Return to draft</SubmitButton>
              </ActionForm>
            ) : null}
            {v.status === "ready_for_review" && !v.archivedAt ? (
              canApprove ? (
                <ApprovalActions organizationSlug={organizationSlug} variantId={v.id} revision={v.revision} scheduledFor={v.scheduledFor} timeZone={timeZone} canPublish={canPublish} editHref={editHref} blocked={blocking.length > 0} />
              ) : (
                <p className="text-sm text-muted">Waiting for a reviewer. <Link href={approvalsHref} className="underline underline-offset-4">Approvals</Link></p>
              )
            ) : null}
            {v.status === "approved" && !v.archivedAt ? (
              canPublish ? (
                <ActionForm action={bound(scheduleVariantAction)} hiddenFields={{ expectedRevision: rev }} className="flex flex-col gap-2 sm:flex-row sm:items-end [&_button]:w-full sm:[&_button]:w-auto">
                  <TextField label={`Publish at (${timeZone})`} name="scheduledFor" type="datetime-local" required defaultValue={toDateTimeLocalValue(v.scheduledFor, timeZone)} id={`schedule-${v.id}`} />
                  <SubmitButton pendingLabel="Scheduling…">Schedule</SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-sm text-muted">Approved. Someone with publishing rights can schedule it.</p>
              )
            ) : null}
            {v.status === "scheduled" && !v.archivedAt && canPublish ? (
              <ActionForm action={bound(unscheduleVariantAction)} hiddenFields={{ expectedRevision: rev }} className="[&_button]:w-full sm:[&_button]:w-auto">
                <SubmitButton variant="glass" pendingLabel="Unscheduling…">Unschedule</SubmitButton>
              </ActionForm>
            ) : null}
            {(v.status === "approved" || v.status === "scheduled" || v.status === "failed") && !v.archivedAt && canPublish ? (
              <div className="[&>button]:w-full sm:[&>button]:w-auto">
                <ConfirmDialog triggerLabel={v.status === "failed" ? "Retry publish now" : "Publish now"} title="Publish this post now?" description="It is sent to the platform immediately and posts publicly." confirmLabel="Publish now" formAction={bound(publishVariantNowAction)} hiddenFields={{ expectedRevision: rev }} />
              </div>
            ) : null}
            {v.status === "publishing" ? <p role="status" className="text-sm text-info">Publishing — waiting for the platform to confirm.</p> : null}
            {v.status === "generating" ? <p role="status" className="text-sm text-info">Generating media…</p> : null}
            {v.status === "published" ? <p className="text-sm text-success">Published{v.publishedAt ? ` ${formatDateTime(v.publishedAt, timeZone)}` : ""}.</p> : null}
            {!v.archivedAt && v.status !== "publishing" && v.status !== "published" ? (
              <div className="[&>button]:w-full sm:[&>button]:w-auto">
                <ConfirmDialog triggerLabel="Archive this version" triggerVariant="subtle" variant="danger" title="Archive this version?" description="It leaves the calendar and any queued publish is cancelled." confirmLabel="Archive" formAction={bound(archiveVariantAction)} hiddenFields={{ expectedRevision: rev }} />
              </div>
            ) : null}
          </Card>
        </section>
      </div>

      <div className="flex flex-col gap-6">
        <section aria-labelledby={`edit-${v.id}`} className="flex flex-col gap-2">
          <h2 id={`edit-${v.id}`} className="text-xs uppercase tracking-[0.1em] text-subtle">Edit {PLATFORM_SHORT_LABEL[v.platform]} version</h2>
          <Card>
            {editable ? (
              <ActionForm action={bound(updateSocialVariantAction)} hiddenFields={{ expectedRevision: rev }} className="flex flex-col gap-4">
                {v.status === "ready_for_review" || v.status === "approved" ? <p className="rounded-sm border border-warning/30 bg-warning-wash px-3 py-2 text-xs text-warning">Saving changes returns this post to draft — an approval only covers the exact version a reviewer saw.</p> : null}
                <TextField label="Hook" name="hook" id={`hook-${v.id}`} defaultValue={v.hook} maxLength={400} />
                <TextAreaField label="Caption" name="body" id={`body-${v.id}`} defaultValue={v.body} rows={8} maxLength={rules.maxBodyLength} hint={`Up to ${rules.maxBodyLength.toLocaleString("en-CA")} characters on ${PLATFORM_SHORT_LABEL[v.platform]}.`} />
                <TextField label="Hashtags" name="hashtags" id={`hashtags-${v.id}`} defaultValue={v.hashtags.join(" ")} hint={`Separate with spaces. Up to ${rules.maxHashtags}.`} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Call to action" name="callToAction" id={`cta-${v.id}`} defaultValue={v.callToAction} maxLength={300} />
                  <TextField label="Link" name="linkUrl" id={`link-${v.id}`} type="url" defaultValue={v.linkUrl ?? ""} placeholder="https://" />
                </div>
                <TextAreaField label="First comment" name="firstComment" id={`comment-${v.id}`} defaultValue={v.platformOptions.firstComment ?? ""} rows={2} maxLength={2200} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label={`Planned for (${timeZone})`} name="scheduledFor" type="datetime-local" id={`planned-${v.id}`} defaultValue={toDateTimeLocalValue(v.scheduledFor, timeZone)} />
                  <LabeledSelect
                    label="Account"
                    name="channelAccountId"
                    id={`account-${v.id}`}
                    defaultValue={v.channelAccountId ?? ""}
                    options={[{ value: "", label: accounts.length ? "No account" : `No ${PLATFORM_SHORT_LABEL[v.platform]} account for this brand` }, ...accounts.map((a) => ({ value: a.id, label: `${a.displayName} — ${CONNECTION_STATUS_LABEL[a.connectionStatus] ?? a.connectionStatus}` }))]}
                  />
                </div>
                <div className="[&_button]:w-full sm:[&_button]:w-auto">
                  <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
                </div>
              </ActionForm>
            ) : (
              <p className="text-sm text-muted">{v.status === "scheduled" ? "Scheduled posts can't be edited. Unschedule it first." : `This post is ${VARIANT_STATUS_LABEL[v.status]?.toLowerCase() ?? v.status} and can't be edited.`}</p>
            )}
          </Card>
        </section>

        <section aria-labelledby={`regen-${v.id}`} className="flex flex-col gap-2">
          <h2 id={`regen-${v.id}`} className="text-xs uppercase tracking-[0.1em] text-subtle">Regenerate with AI</h2>
          <Card variant="surface">
            <RegeneratePanel action={bound(regenerateVariantPartAction)} parts={regenerateParts} rendering={v.status === "generating"} />
          </Card>
        </section>

        <section aria-labelledby={`media-${v.id}`} className="flex flex-col gap-2">
          <h2 id={`media-${v.id}`} className="text-xs uppercase tracking-[0.1em] text-subtle">Media</h2>
          <Card variant="surface" className="flex flex-col gap-4">
            {media.length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {media.map((a) => (
                  <li key={a.id} className="flex flex-col gap-1.5">
                    <div className="aspect-square overflow-hidden rounded-sm bg-black">
                      {a.contentType.startsWith("video/") ? (
                        <video src={a.previewUrl} preload="metadata" muted className="h-full w-full object-cover" aria-label={a.title} />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- private asset streamed from the authenticated assets API.
                        <img src={a.previewUrl} alt={a.altText || a.title} loading="lazy" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <span className="truncate text-xs text-subtle">{a.source === "generated" || a.source === "rendered" ? `AI · ${a.provider ?? ""}` : a.title}</span>
                    {editable ? (
                      <ActionForm action={bound(detachAssetFromVariantAction)} hiddenFields={{ expectedRevision: rev, assetId: a.id }} className="[&_button]:min-h-9 [&_button]:w-full [&_button]:px-2">
                        <SubmitButton variant="ghost" pendingLabel="Removing…">Remove</SubmitButton>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-subtle">No media attached.</p>
            )}
            {editable ? (
              <>
                {brandAssets.length ? (
                  <ActionForm action={bound(attachAssetToVariantAction)} hiddenFields={{ expectedRevision: rev }} className="flex flex-col gap-2 sm:flex-row sm:items-end [&_button]:w-full sm:[&_button]:w-auto">
                    <div className="min-w-0 flex-1">
                      <LabeledSelect label="Attach from library" name="assetId" id={`asset-${v.id}`} options={brandAssets.map((a) => ({ value: a.id, label: `${a.title} (${a.assetType}${a.width && a.height ? `, ${a.width}×${a.height}` : ""})` }))} />
                    </div>
                    <SubmitButton variant="glass" pendingLabel="Attaching…">Attach</SubmitButton>
                  </ActionForm>
                ) : null}
                <AssetUploader organizationId={organizationId} brandProfileId={brandProfileId} contentItemId={itemId} contentVariantId={v.id} platform={v.platform} revision={v.revision} attach={bound(attachAssetToVariantAction)} />
              </>
            ) : null}
          </Card>
        </section>
      </div>
    </div>
  );
}
