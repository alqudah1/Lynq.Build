import Link from "next/link";
import { listBrands } from "@/lib/social-os/brands";
import { listPublishJobs, type SocialPublishJobView } from "@/lib/social-os/publishing";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import { SOCIAL_PUBLISH_JOB_STATUSES, socialPublishJobStatusSchema } from "@/lib/social-os/validation";
import { cancelPublishJobAction, retryPublishJobAction } from "@/lib/dashboard/actions/social";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { SocialBrandSwitcher } from "@/components/social/SocialBrandSwitcher";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { firstParam, resolveBrandSelection } from "@/components/social/brand-selection";
import { JOB_STATUS_TONE, PLATFORM_SHORT_LABEL, formatDateTime, humanize, socialHref } from "@/components/social/format";

export const dynamic = "force-dynamic";

/** Plain-language explanation of the last publish error — the raw provider message is sanitized server-side and shown after it. */
function explainError(job: SocialPublishJobView): string | null {
  if (!job.lastErrorCode && !job.lastErrorMessage) return null;
  const lead =
    job.lastErrorClass === "authorization_lost"
      ? "The account's authorization was lost — reconnect it in Connections."
      : job.lastErrorClass === "transient"
        ? job.status === "failed"
          ? "The platform kept having a temporary problem and every retry was used."
          : "Temporary platform problem — LYNQ will retry automatically."
        : job.status === "failed"
          ? "The platform refused this post."
          : "Last attempt failed.";
  return job.lastErrorMessage ? `${lead} ${job.lastErrorMessage}` : lead;
}

export default async function SocialPublishingPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ brand?: string; status?: string }> }) {
  const { organizationSlug } = await params;
  const sp = await searchParams;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/publishing`);
  const status = socialPublishJobStatusSchema.safeParse(firstParam(sp.status));

  let data;
  try {
    const [brands, timeZone] = await Promise.all([listBrands(db, { organizationId: organization.id, actorUserId: user.userId }), getSocialTimezone(db, organization.id)]);
    const selection = resolveBrandSelection(brands, sp.brand, true);
    const jobs = await listPublishJobs(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId: selection.brandProfileId, status: status.success ? status.data : undefined, limit: 100 });
    data = { brands, selection, timeZone, jobs };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "Publishing" });
  }
  const { brands, selection, timeZone, jobs } = data;
  const href = (path: string, extra: Record<string, string | undefined> = {}) => socialHref(organizationSlug, path, { brand: selection.brandParam, ...extra });
  const cancel = (id: string) => cancelPublishJobAction.bind(null, organizationSlug, id);
  const retry = (id: string) => retryPublishJobAction.bind(null, organizationSlug, id);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "Publishing" }])} />
      <PageHeader
        title="Publishing queue"
        description="Every attempt to publish an approved post, with the platform's answer. Published means the platform returned a post id."
        actions={<SocialBrandSwitcher brands={brands.map((b) => ({ id: b.id, name: b.name }))} selectedBrandId={selection.selectedBrandId} />}
      />

      <nav aria-label="Filter by status" className="-mx-1 overflow-x-auto">
        <ul className="flex gap-2 px-1">
          {[undefined, ...SOCIAL_PUBLISH_JOB_STATUSES].map((s) => {
            const active = (status.success ? status.data : undefined) === s;
            return (
              <li key={s ?? "all"} className="shrink-0">
                <Link href={href("/social/publishing", { status: s })} aria-current={active ? "page" : undefined} className={`lynq-transition inline-flex min-h-11 items-center rounded-sm border px-3 text-xs font-medium uppercase tracking-[0.08em] ${active ? "border-border-strong bg-glass-strong text-foreground" : "border-border text-subtle hover:text-foreground"}`}>
                  {s ? humanize(s) : "All"}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-labelledby="publish-jobs" className="flex flex-col gap-3">
        <h2 id="publish-jobs" className="text-xs uppercase tracking-[0.1em] text-subtle">{jobs.length} job{jobs.length === 1 ? "" : "s"}</h2>
        {jobs.length === 0 ? (
          <EmptyState title={status.success ? `No ${humanize(status.data).toLowerCase()} jobs.` : "Nothing has been queued to publish yet."} description="A job appears when an approved post is scheduled or published now." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Post</Th>
                <Th>Status</Th>
                <Th className="hidden md:table-cell">Scheduled</Th>
                <Th className="hidden lg:table-cell">Attempts</Th>
                <Th className="hidden md:table-cell">Result</Th>
                <Th><span className="sr-only">Actions</span></Th>
              </tr>
            </THead>
            <TBody>
              {jobs.map((job) => {
                const error = explainError(job);
                return (
                  <Tr key={job.id}>
                    <Td>
                      <Link href={href(`/social/library/${job.contentItemId}`, { variant: job.contentVariantId })} className="flex min-h-11 flex-col justify-center hover:underline">
                        <span className="text-sm text-foreground">{job.title ?? "Untitled post"}</span>
                        <span className="text-xs text-subtle">{PLATFORM_SHORT_LABEL[job.platform] ?? job.platform}{job.accountDisplayName ? ` · ${job.accountDisplayName}` : ""}<span className="md:hidden"> · {formatDateTime(job.scheduledFor, timeZone)}</span></span>
                      </Link>
                      {error ? <p className="mt-1 max-w-md text-xs text-danger md:hidden">{error}</p> : null}
                    </Td>
                    <Td><Badge tone={JOB_STATUS_TONE[job.status] ?? "neutral"} dot>{humanize(job.status)}</Badge></Td>
                    <Td className="hidden text-muted md:table-cell">{formatDateTime(job.scheduledFor, timeZone)}</Td>
                    <Td className="hidden text-muted lg:table-cell">{job.attemptCount} / {job.maxAttempts}</Td>
                    <Td className="hidden md:table-cell">
                      {job.externalPostUrl ? (
                        <a href={job.externalPostUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted underline-offset-4 hover:text-foreground hover:underline">View post ↗</a>
                      ) : error ? (
                        <p className="max-w-sm text-xs text-danger">{error}</p>
                      ) : job.publishedAt ? (
                        <span className="text-xs text-subtle">Published {formatDateTime(job.publishedAt, timeZone)}</span>
                      ) : (
                        <span className="text-xs text-subtle">—</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        {job.status === "queued" || job.status === "retrying" ? (
                          <ConfirmDialog triggerLabel="Cancel" triggerVariant="subtle" variant="danger" title="Cancel this publish?" description="The post goes back to approved and will not publish until it is scheduled again." confirmLabel="Cancel publish" formAction={cancel(job.id)} />
                        ) : null}
                        {job.status === "failed" ? (
                          <ActionForm action={retry(job.id)}>
                            <SubmitButton variant="glass" pendingLabel="Retrying…">Retry</SubmitButton>
                          </ActionForm>
                        ) : null}
                      </div>
                    </Td>
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
