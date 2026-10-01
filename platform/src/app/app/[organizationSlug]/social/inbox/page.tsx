import Link from "next/link";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listBrands } from "@/lib/social-os/brands";
import { describeConnectionCenter } from "@/lib/social-os/connections";
import { getEngagementItemForUser, getInboxSummary, listEngagementItems, type EngagementItemView } from "@/lib/social-os/engagement";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import { listOrganizationMembers, type OrganizationMemberListItem } from "@/lib/organizations/memberships";
import { hasMarketingCapability, resolveMarketingAuthContext } from "@/lib/marketing-os/authz";
import { SOCIAL_ENGAGEMENT_STATUSES, SOCIAL_ENGAGEMENT_TYPES, SOCIAL_ORGANIC_PLATFORMS, SOCIAL_PLATFORM_LABELS, socialEngagementStatusSchema, socialEngagementTypeSchema, socialOrganicPlatformSchema } from "@/lib/social-os/validation";
import {
  assignEngagementAction,
  draftReplyAction,
  engagementStatusAction,
  flagLeadAction,
  linkEngagementToCrmAction,
  requestEngagementSyncAction,
  sendReplyAction,
} from "@/lib/dashboard/actions/social";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SocialBrandSwitcher } from "@/components/social/SocialBrandSwitcher";
import { SocialActionForm } from "@/components/social/SocialActionForm";
import { LabeledSelect, TextField } from "@/components/social/fields";
import { CONTROL, FIELD_LABEL, LINK_BUTTON, SectionHeading, StatTile } from "@/components/social/parts";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { firstParam, resolveBrandSelection } from "@/components/social/brand-selection";
import { ENGAGEMENT_STATUS_LABEL, ENGAGEMENT_STATUS_TONE, PLATFORM_SHORT_LABEL, SENTIMENT_TONE, formatDateTime, humanize, socialHref } from "@/components/social/format";

export const dynamic = "force-dynamic";

type InboxSearch = { brand?: string; platform?: string; status?: string; type?: string; leads?: string; item?: string };

/** Which manual status moves the service allows from each status (mirrors `engagement.ts`). */
const MOVES: Record<string, ("needs_reply" | "ignore" | "escalate")[]> = {
  new: ["needs_reply", "ignore", "escalate"],
  needs_reply: ["ignore", "escalate"],
  reply_drafted: ["needs_reply", "ignore", "escalate"],
  escalated: ["needs_reply", "ignore"],
  ignored: ["needs_reply", "escalate"],
  replied: [],
  hidden: [],
};
const MOVE_LABEL = { needs_reply: "Needs reply", ignore: "Ignore", escalate: "Escalate" } as const;

function ageLabel(from: Date | null, now: Date): string {
  if (!from) return "—";
  const minutes = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default async function SocialInboxPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<InboxSearch> }) {
  const { organizationSlug } = await params;
  const sp = await searchParams;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/inbox`);
  const platform = socialOrganicPlatformSchema.safeParse(firstParam(sp.platform));
  const status = socialEngagementStatusSchema.safeParse(firstParam(sp.status));
  const itemType = socialEngagementTypeSchema.safeParse(firstParam(sp.type));
  const leadsOnly = firstParam(sp.leads) === "1";
  const selectedId = firstParam(sp.item);

  let data;
  try {
    const [brands, timeZone, ctx, center, members] = await Promise.all([
      listBrands(db, { organizationId: organization.id, actorUserId: user.userId }),
      getSocialTimezone(db, organization.id),
      resolveMarketingAuthContext(db, { organizationId: organization.id, actorUserId: user.userId }),
      describeConnectionCenter(db, { organizationId: organization.id, actorUserId: user.userId }),
      listOrganizationMembers(db, organization.id, user.userId),
    ]);
    const selection = resolveBrandSelection(brands, sp.brand, true);
    const [items, summary, selected] = await Promise.all([
      listEngagementItems(db, {
        organizationId: organization.id,
        actorUserId: user.userId,
        brandProfileId: selection.brandProfileId,
        platform: platform.success ? platform.data : undefined,
        status: status.success ? status.data : undefined,
        itemType: itemType.success ? itemType.data : undefined,
        isLead: leadsOnly ? true : undefined,
        limit: 100,
      }),
      getInboxSummary(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId: selection.brandProfileId }),
      selectedId && /^[0-9a-f-]{36}$/i.test(selectedId)
        ? getEngagementItemForUser(db, { organizationId: organization.id, engagementItemId: selectedId, actorUserId: user.userId }).catch((err) => {
            if (err instanceof TenantResourceNotFoundError) return null;
            throw err;
          })
        : Promise.resolve(null),
    ]);
    const accounts = center.accounts.filter((a) => a.accountKind === "organic" && (!selection.brandProfileId || a.brandProfileId === selection.brandProfileId));
    data = { brands, timeZone, ctx, members, selection, items, summary, selected, accounts };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "Inbox" });
  }
  const { brands, timeZone, ctx, members, selection, items, summary, selected, accounts } = data;
  const canEngage = hasMarketingCapability(ctx, "marketing_manage_engagement");
  const canSync = hasMarketingCapability(ctx, "marketing_manage_connections");
  const now = new Date();
  const filters = { platform: platform.success ? platform.data : undefined, status: status.success ? status.data : undefined, type: itemType.success ? itemType.data : undefined, leads: leadsOnly ? "1" : undefined };
  const href = (extra: Record<string, string | undefined> = {}) => socialHref(organizationSlug, "/social/inbox", { brand: selection.brandParam, ...filters, ...extra });
  const syncable = accounts.filter((a) => a.canReadEngagement);
  const memberName = new Map(members.map((m) => [m.userId, m.name || m.email]));
  const anyFilter = Boolean(filters.platform || filters.status || filters.type || filters.leads);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "Inbox" }])} />
      <PageHeader
        title="Engagement inbox"
        description="Comments and mentions pulled from connected accounts. AI only drafts — a reply is posted when a person presses send."
        actions={<SocialBrandSwitcher brands={brands.map((b) => ({ id: b.id, name: b.name }))} selectedBrandId={selection.selectedBrandId} />}
      />

      <section aria-label="Inbox summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Needs reply" value={summary.needsReplyCount} tone={summary.needsReplyCount ? "warning" : undefined} detail="New, flagged or drafted" />
        <StatTile label="New" value={summary.byStatus.new} />
        <StatTile label="Leads" value={summary.leadsCount} />
        <StatTile label="Oldest unanswered" value={ageLabel(summary.oldestUnansweredAt, now)} detail={summary.oldestUnansweredAt ? formatDateTime(summary.oldestUnansweredAt, timeZone) : "Nothing waiting"} tone={summary.oldestUnansweredAt && now.getTime() - summary.oldestUnansweredAt.getTime() > 24 * 3600_000 ? "danger" : undefined} />
      </section>

      <section aria-labelledby="inbox-sync" className="flex flex-col gap-3">
        <SectionHeading id="inbox-sync">Sources</SectionHeading>
        {accounts.length === 0 ? (
          <EmptyState title="No social accounts for this brand." description="Connect Facebook, Instagram or LinkedIn in the Connection Center to pull comments into this inbox." action={<Link href={socialHref(organizationSlug, "/social/connections", { brand: selection.brandParam })} className="text-xs text-muted underline-offset-4 hover:text-foreground hover:underline">Open Connection Center →</Link>} />
        ) : syncable.length === 0 ? (
          <p className="rounded-sm border border-border px-4 py-3 text-sm text-muted">
            None of this brand’s accounts can sync engagement yet — only connected Facebook Pages, Instagram and LinkedIn accounts support it. Manual and tracking-only accounts never fill this inbox.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {syncable.map((a) => (
              <li key={a.id}>
                <Card variant="surface" padding="sm" className="flex flex-col gap-2 sm:min-w-64">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-foreground">{a.displayName}</span>
                    <Badge>{a.platformLabel}</Badge>
                  </div>
                  <span className="text-xs text-subtle">{typeof a.metadata.engagementSyncedAt === "string" ? `Last synced ${formatDateTime(a.metadata.engagementSyncedAt, timeZone)}` : "Never synced"}</span>
                  {canSync ? (
                    <SocialActionForm action={requestEngagementSyncAction.bind(null, organizationSlug, a.id)} className="flex flex-col gap-2 [&_button]:w-full">
                      <SubmitButton variant="glass" pendingLabel="Queuing…">Sync now</SubmitButton>
                    </SocialActionForm>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form method="get" aria-label="Filter the inbox" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(4,minmax(0,12rem))_auto] lg:items-end">
        {selection.brandParam ? <input type="hidden" name="brand" value={selection.brandParam} /> : null}
        <LabeledSelect label="Platform" name="platform" id="filter-platform" defaultValue={filters.platform ?? ""} options={[{ value: "", label: "All platforms" }, ...SOCIAL_ORGANIC_PLATFORMS.map((p) => ({ value: p, label: SOCIAL_PLATFORM_LABELS[p] }))]} />
        <LabeledSelect label="Status" name="status" id="filter-status" defaultValue={filters.status ?? ""} options={[{ value: "", label: "Any status" }, ...SOCIAL_ENGAGEMENT_STATUSES.map((s) => ({ value: s, label: ENGAGEMENT_STATUS_LABEL[s] ?? humanize(s) }))]} />
        <LabeledSelect label="Type" name="type" id="filter-type" defaultValue={filters.type ?? ""} options={[{ value: "", label: "Any type" }, ...SOCIAL_ENGAGEMENT_TYPES.map((t) => ({ value: t, label: humanize(t) }))]} />
        <label className="flex min-h-11 items-center gap-2 self-end text-sm text-muted">
          <input type="checkbox" name="leads" value="1" defaultChecked={leadsOnly} className="h-4 w-4 accent-white" />
          Leads only
        </label>
        <div className="col-span-2 flex gap-2 sm:col-span-1">
          <button type="submit" className={`${LINK_BUTTON} lynq-glass text-foreground hover:border-border-strong`}>Apply</button>
          {anyFilter ? <Link href={socialHref(organizationSlug, "/social/inbox", { brand: selection.brandParam })} className={`${LINK_BUTTON} text-muted hover:text-foreground`}>Clear</Link> : null}
        </div>
      </form>

      <div className={`grid gap-6 ${selected ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]" : ""}`}>
        <section aria-labelledby="inbox-items" className={`flex flex-col gap-3 ${selected ? "order-last lg:order-first" : ""}`}>
          <SectionHeading id="inbox-items">{items.length} item{items.length === 1 ? "" : "s"}{items.length === 100 ? " (newest 100)" : ""}</SectionHeading>
          {items.length === 0 ? (
            <EmptyState
              title={anyFilter ? "Nothing matches these filters." : summary.total === 0 ? "The inbox is empty." : "Nothing here for this brand."}
              description={summary.total === 0 ? (syncable.length ? "Run a sync to pull recent comments and mentions." : "Connect an account that supports engagement to start receiving comments.") : undefined}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li key={item.id}>
                  <InboxCard item={item} active={item.id === selected?.id} href={href({ item: item.id })} timeZone={timeZone} assignee={item.assignedUserId ? (memberName.get(item.assignedUserId) ?? "a former member") : null} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {selected ? (
          <section aria-labelledby="inbox-detail" className="order-first flex flex-col gap-3 lg:order-last">
            <SectionHeading id="inbox-detail" action={<Link href={href()} className="text-xs text-muted hover:text-foreground">Close</Link>}>
              Selected item
            </SectionHeading>
            <ItemDetail organizationSlug={organizationSlug} item={selected} timeZone={timeZone} members={members} canEngage={canEngage} memberName={memberName} />
          </section>
        ) : selectedId ? (
          <p role="status" className="text-sm text-subtle">That item is no longer available.</p>
        ) : null}
      </div>
    </div>
  );
}

function InboxCard({ item, active, href, timeZone, assignee }: { item: EngagementItemView; active: boolean; href: string; timeZone: string; assignee: string | null }) {
  return (
    <Card as={Link} href={href} scroll={false} aria-current={active ? "true" : undefined} interactive variant={active ? "glass" : "surface"} padding="sm" className={`flex flex-col gap-2 ${active ? "border-border-strong" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{PLATFORM_SHORT_LABEL[item.platform] ?? item.platformLabel}</Badge>
        {item.accountDisplayName ? <span className="text-xs text-subtle">{item.accountDisplayName}</span> : null}
        <span className="text-xs text-subtle">· {humanize(item.itemType)}</span>
        <span className="ml-auto"><Badge tone={ENGAGEMENT_STATUS_TONE[item.status] ?? "neutral"} dot>{ENGAGEMENT_STATUS_LABEL[item.status] ?? item.status}</Badge></span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium text-foreground">{item.authorName ?? item.authorHandle ?? "Unknown author"}</span>
        {item.authorHandle && item.authorName ? <span className="text-xs text-subtle">@{item.authorHandle.replace(/^@/, "")}</span> : null}
        <span className="text-xs text-subtle">{formatDateTime(item.postedAt, timeZone)}</span>
      </div>
      <p className="line-clamp-3 text-sm text-muted">{item.text || <span className="italic text-subtle">No text</span>}</p>
      <div className="flex flex-wrap items-center gap-2">
        {item.postTitle ? <span className="text-xs text-subtle">On “{item.postTitle}”</span> : null}
        {item.isLead ? <Badge tone="accent">Lead</Badge> : null}
        {item.sentiment ? <Badge tone={SENTIMENT_TONE[item.sentiment] ?? "neutral"}>{item.sentiment}</Badge> : null}
        {item.category ? <Badge>{humanize(item.category)}</Badge> : null}
        {assignee ? <span className="text-xs text-subtle">Assigned to {assignee}</span> : null}
      </div>
    </Card>
  );
}

function ItemDetail({ organizationSlug, item, timeZone, members, canEngage, memberName }: { organizationSlug: string; item: EngagementItemView; timeZone: string; members: OrganizationMemberListItem[]; canEngage: boolean; memberName: Map<string, string> }) {
  const rev = String(item.revision);
  const bound = <A extends unknown[], R>(fn: (slug: string, id: string, ...rest: A) => R) => fn.bind(null, organizationSlug, item.id) as (...rest: A) => R;
  const moves = MOVES[item.status] ?? [];
  const closed = item.status === "replied" || item.status === "hidden";
  const crmBase = `/app/${organizationSlug}/crm`;

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{item.platformLabel}</Badge>
          {item.accountDisplayName ? <span className="text-xs text-subtle">{item.accountDisplayName}</span> : null}
          <Badge tone={ENGAGEMENT_STATUS_TONE[item.status] ?? "neutral"} dot>{ENGAGEMENT_STATUS_LABEL[item.status] ?? item.status}</Badge>
          {item.isLead ? <Badge tone="accent">Lead</Badge> : null}
        </div>
        <p className="text-sm text-foreground">
          <span className="font-medium">{item.authorName ?? item.authorHandle ?? "Unknown author"}</span>
          {item.authorHandle && item.authorName ? <span className="text-subtle"> @{item.authorHandle.replace(/^@/, "")}</span> : null}
          <span className="text-subtle"> · {humanize(item.itemType)} · {formatDateTime(item.postedAt, timeZone)}</span>
        </p>
        <p className="whitespace-pre-wrap rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground">{item.text || "No text was provided by the platform."}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
          {item.postTitle ? <span>On your post “{item.postTitle}”</span> : item.externalPostId ? <span>On a post not created in LYNQ</span> : null}
          {item.brandName ? <span>· {item.brandName}</span> : null}
          {item.externalUrl ? <a href={item.externalUrl} target="_blank" rel="noopener noreferrer" className="text-muted underline-offset-4 hover:text-foreground hover:underline">Open on {PLATFORM_SHORT_LABEL[item.platform] ?? "platform"} ↗</a> : null}
        </div>
        {item.sentiment || item.category ? (
          <div className="flex flex-wrap gap-2">
            {item.sentiment ? <Badge tone={SENTIMENT_TONE[item.sentiment] ?? "neutral"}>Sentiment: {item.sentiment}</Badge> : null}
            {item.category ? <Badge>Category: {humanize(item.category)}</Badge> : null}
          </div>
        ) : null}
      </div>

      {item.status === "replied" ? (
        <div className="flex flex-col gap-1 rounded-sm border border-success/30 bg-success-wash px-3 py-2">
          <p className="text-xs uppercase tracking-[0.1em] text-success">Replied{item.repliedAt ? ` ${formatDateTime(item.repliedAt, timeZone)}` : ""}{item.repliedByUserId ? ` by ${memberName.get(item.repliedByUserId) ?? "a former member"}` : ""}</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{item.replyText}</p>
        </div>
      ) : null}
      {item.status === "hidden" ? <p className="text-sm text-subtle">Hidden on the platform{item.hiddenAt ? ` ${formatDateTime(item.hiddenAt, timeZone)}` : ""}.</p> : null}

      {!canEngage ? (
        <p className="text-sm text-muted">You can read the inbox. Replying and triage need the marketing manager role.</p>
      ) : (
        <>
          {!closed ? (
            <div className="flex flex-col gap-3">
              <h3 className={FIELD_LABEL}>Reply</h3>
              {!item.canReply ? (
                <p className="rounded-sm border border-warning/30 bg-warning-wash px-3 py-2 text-xs text-warning">
                  {item.itemType !== "comment" ? `Replying to a ${humanize(item.itemType).toLowerCase()} is not supported through the official API in this build.` : `${item.platformLabel} replies are not supported through the official API in this build.`} Reply on the platform directly{item.externalUrl ? " using the link above" : ""}, then mark it handled.
                </p>
              ) : null}
              <SocialActionForm key={`reply-${item.revision}`} action={bound(sendReplyAction)} hiddenFields={{ expectedRevision: rev }} className="flex flex-col gap-2">
                <label htmlFor={`reply-${item.id}`} className="sr-only">Reply text</label>
                <textarea id={`reply-${item.id}`} name="text" rows={5} maxLength={item.platform === "x" ? 280 : 8000} defaultValue={item.replyDraft ?? ""} placeholder="Write a reply…" className={`${CONTROL} min-h-28`} />
                {item.replyDraft ? <p className="text-xs text-subtle">Prefilled with the AI draft — edit before sending. Nothing is posted until you press send.</p> : null}
                {item.canReply ? (
                  <div className="[&_button]:w-full sm:[&_button]:w-auto">
                    <SubmitButton pendingLabel="Posting…">Send reply</SubmitButton>
                  </div>
                ) : null}
              </SocialActionForm>
              {item.status !== "ignored" ? (
                <SocialActionForm action={bound(draftReplyAction)} className="flex flex-col gap-2 [&_button]:w-full sm:[&_button]:w-auto">
                  <SubmitButton variant="glass" pendingLabel="Drafting…">{item.replyDraft ? "Redraft with AI" : "Draft with AI"}</SubmitButton>
                </SocialActionForm>
              ) : null}
            </div>
          ) : null}

          {moves.length || !closed ? (
            <div className="flex flex-col gap-2">
              <h3 className={FIELD_LABEL}>Triage</h3>
              <div className="flex flex-wrap gap-2">
                {moves.map((m) => (
                  <SocialActionForm key={m} action={bound(engagementStatusAction)} hiddenFields={{ expectedRevision: rev, status: m }}>
                    <SubmitButton variant={m === "escalate" ? "danger" : "glass"} pendingLabel="Saving…">{MOVE_LABEL[m]}</SubmitButton>
                  </SocialActionForm>
                ))}
                {!closed && item.itemType === "comment" ? (
                  <ConfirmDialog triggerLabel="Hide" triggerVariant="danger" variant="danger" title="Hide this comment?" description={`It is hidden on ${item.platformLabel} for everyone except the author and their friends. LYNQ keeps a copy here.`} confirmLabel="Hide comment" formAction={bound(engagementStatusAction)} hiddenFields={{ expectedRevision: rev, status: "hide" }} />
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <SocialActionForm action={bound(assignEngagementAction)} hiddenFields={{ expectedRevision: rev }} className="flex flex-col gap-2">
              <LabeledSelect label="Assigned to" name="assignedUserId" id={`assign-${item.id}`} defaultValue={item.assignedUserId ?? ""} options={[{ value: "", label: "Nobody" }, ...members.map((m) => ({ value: m.userId, label: m.name ? `${m.name} (${m.email})` : m.email }))]} />
              <div className="[&_button]:w-full">
                <SubmitButton variant="glass" pendingLabel="Saving…">Assign</SubmitButton>
              </div>
            </SocialActionForm>
            <SocialActionForm action={bound(flagLeadAction)} hiddenFields={{ expectedRevision: rev, isLead: item.isLead ? "0" : "1" }} className="flex flex-col justify-end gap-2">
              <p className="text-xs text-subtle">{item.isLead ? "Marked as a sales lead." : "Not marked as a lead."}</p>
              <div className="[&_button]:w-full">
                <SubmitButton variant="glass" pendingLabel="Saving…">{item.isLead ? "Remove lead flag" : "Flag as lead"}</SubmitButton>
              </div>
            </SocialActionForm>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className={FIELD_LABEL}>CRM</h3>
            {item.crmLeadId || item.crmContactId ? (
              <div className="flex flex-wrap gap-3 text-sm">
                {item.crmLeadId ? <Link href={`${crmBase}/leads/${item.crmLeadId}`} className="text-foreground underline underline-offset-4">Open CRM lead →</Link> : null}
                {item.crmContactId ? <Link href={`${crmBase}/contacts/${item.crmContactId}`} className="text-foreground underline underline-offset-4">Open CRM contact →</Link> : null}
              </div>
            ) : (
              <p className="text-xs text-subtle">Not linked to the CRM.</p>
            )}
            {!item.crmLeadId ? (
              <SocialActionForm action={bound(linkEngagementToCrmAction)} hiddenFields={{ expectedRevision: rev, mode: "create_lead" }} className="flex flex-col gap-2 [&_button]:w-full sm:[&_button]:w-auto">
                <SubmitButton variant="glass" pendingLabel="Creating…">Create CRM lead</SubmitButton>
              </SocialActionForm>
            ) : null}
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center text-xs text-muted hover:text-foreground">Link an existing lead or contact</summary>
              <div className="flex flex-col gap-3 pt-2">
                <SocialActionForm action={bound(linkEngagementToCrmAction)} hiddenFields={{ expectedRevision: rev, mode: "existing_lead" }} className="flex flex-col gap-2 sm:flex-row sm:items-end [&_button]:w-full sm:[&_button]:w-auto">
                  <TextField label="Lead id" name="leadId" id={`lead-${item.id}`} placeholder="00000000-0000-…" hint="From the lead's CRM page URL." />
                  <SubmitButton variant="glass" pendingLabel="Linking…">Link lead</SubmitButton>
                </SocialActionForm>
                <SocialActionForm action={bound(linkEngagementToCrmAction)} hiddenFields={{ expectedRevision: rev, mode: "existing_contact" }} className="flex flex-col gap-2 sm:flex-row sm:items-end [&_button]:w-full sm:[&_button]:w-auto">
                  <TextField label="Contact id" name="contactId" id={`contact-${item.id}`} placeholder="00000000-0000-…" hint="From the contact's CRM page URL." />
                  <SubmitButton variant="glass" pendingLabel="Linking…">Link contact</SubmitButton>
                </SocialActionForm>
              </div>
            </details>
          </div>
        </>
      )}
    </Card>
  );
}
