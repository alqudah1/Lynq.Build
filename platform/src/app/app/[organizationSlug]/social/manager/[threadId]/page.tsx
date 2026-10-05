import Link from "next/link";
import { listBrands } from "@/lib/social-os/brands";
import { getManagerThread, listManagerThreads, type SocialManagerMessage } from "@/lib/social-os/manager";
import { describeAiProviders, loadSocialAiEnv } from "@/lib/social-os/providers/ai/registry";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ManagerComposer } from "@/components/social/ManagerComposer";
import { AiSetupCard, ManagerThreadList, NewThreadForm, managerSuggestions } from "@/components/social/ManagerParts";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { firstParam } from "@/components/social/brand-selection";
import { formatTime, humanize, socialHref } from "@/components/social/format";

export const dynamic = "force-dynamic";

function toolCall(message: SocialManagerMessage): { tool: string; ok: boolean; error: string | null; input: unknown } {
  const first = (message.toolCalls[0] ?? {}) as { tool?: unknown; ok?: unknown; error?: unknown; input?: unknown };
  return { tool: typeof first.tool === "string" ? first.tool : "a tool", ok: first.ok !== false, error: typeof first.error === "string" ? first.error : null, input: first.input };
}

function pretty(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2).slice(0, 6000);
    } catch {
      return value.slice(0, 6000);
    }
  }
  return JSON.stringify(value ?? null, null, 2).slice(0, 6000);
}

export default async function SocialManagerThreadPage({ params, searchParams }: { params: Promise<{ organizationSlug: string; threadId: string }>; searchParams: Promise<{ brand?: string; prompt?: string }> }) {
  const { organizationSlug, threadId } = await params;
  const sp = await searchParams;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/manager/${threadId}`);

  let data;
  try {
    const thread = await getManagerThread(db, { organizationId: organization.id, threadId, actorUserId: user.userId });
    const [brands, threads, providers, timeZone] = await Promise.all([
      listBrands(db, { organizationId: organization.id, actorUserId: user.userId }),
      listManagerThreads(db, { organizationId: organization.id, actorUserId: user.userId }),
      loadSocialAiEnv().then(describeAiProviders),
      getSocialTimezone(db, organization.id),
    ]);
    data = { thread, brands, threads, providers, timeZone };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "AI Social Manager" });
  }
  const { thread, brands, threads, providers, timeZone } = data;
  const brandParam = firstParam(sp.brand);
  const brandName = brands.find((b) => b.id === thread.brandProfileId)?.name ?? null;
  const textConfigured = providers.some((p) => p.kind === "text" && p.configured);
  const messages = (thread.messages ?? []).filter((m) => m.role !== "system");
  const href = (path: string, extra: Record<string, string | undefined> = {}) => socialHref(organizationSlug, path, { brand: brandParam, ...extra });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "AI Manager", href: href("/social/manager") }, { label: thread.title }])} />
      <PageHeader title={thread.title} description={brandName ? `Working in ${brandName}'s voice and context.` : "No brand attached — answers use organization-wide context."} />

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside aria-labelledby="thread-list" className="order-2 lg:order-1">
          <details className="group rounded-md border border-border p-4 lg:border-0 lg:p-0" open>
            <summary className="flex min-h-11 cursor-pointer items-center text-xs uppercase tracking-[0.1em] text-subtle lg:pointer-events-none lg:min-h-0 lg:pb-3" id="thread-list">Conversations</summary>
            <div className="flex flex-col gap-4 pt-2">
              <ManagerThreadList organizationSlug={organizationSlug} threads={threads} activeThreadId={thread.id} brandParam={brandParam} timeZone={timeZone} />
              <NewThreadForm organizationSlug={organizationSlug} brandProfileId={thread.brandProfileId ?? undefined} />
            </div>
          </details>
        </aside>

        <section aria-label="Conversation" className="order-1 flex min-w-0 flex-col gap-4 lg:order-2">
          {messages.length === 0 ? (
            <EmptyState title="No messages yet." description="Ask the manager for a plan, drafts or a read on what needs attention." />
          ) : (
            <ol className="flex flex-col gap-3">
              {messages.map((m) => {
                if (m.role === "tool") {
                  const call = toolCall(m);
                  return (
                    <li key={m.id}>
                      <details className="rounded-sm border border-border bg-elevated px-3 py-2 text-xs">
                        <summary className="flex min-h-9 cursor-pointer flex-wrap items-center gap-2 text-muted">
                          <span>Used <code className="text-foreground">{call.tool}</code></span>
                          {call.ok ? null : <Badge tone="danger">Failed</Badge>}
                          <span className="text-subtle">· {formatTime(m.createdAt, timeZone)}</span>
                        </summary>
                        <div className="flex flex-col gap-2 pt-2">
                          {call.error ? <p className="text-danger">{call.error}</p> : null}
                          {call.input !== undefined ? (
                            <div>
                              <p className="text-subtle">Input</p>
                              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-background p-2 text-[0.7rem] text-muted">{pretty(call.input)}</pre>
                            </div>
                          ) : null}
                          <div>
                            <p className="text-subtle">Result</p>
                            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-background p-2 text-[0.7rem] text-muted">{pretty(m.content)}</pre>
                          </div>
                        </div>
                      </details>
                    </li>
                  );
                }
                const mine = m.role === "user";
                return (
                  <li key={m.id} className={`flex flex-col gap-2 ${mine ? "items-end" : "items-start"}`}>
                    <div className={`max-w-[42rem] rounded-md px-4 py-3 text-sm leading-6 ${mine ? "bg-glass-strong text-foreground" : "lynq-surface text-foreground"}`}>
                      <p className="sr-only">{mine ? "You said" : "Manager replied"}</p>
                      <p className="whitespace-pre-line">{m.content}</p>
                      <p className="mt-1 text-[0.7rem] text-subtle">{formatTime(m.createdAt, timeZone)}</p>
                    </div>
                    {m.proposedActions.length ? (
                      <ul className="grid w-full max-w-[42rem] gap-2 sm:grid-cols-2">
                        {m.proposedActions.map((a) => {
                          const linkable = a.type === "content_item" || a.type === "schedule_proposal";
                          const body = (
                            <>
                              <span className="text-[0.65rem] uppercase tracking-[0.1em] text-subtle">{a.type === "schedule_proposal" ? "Proposed time" : humanize(a.type.replace("content_item", "draft created"))}</span>
                              <span className="text-sm text-foreground">{a.label}</span>
                              {linkable ? <span className="text-xs text-muted">Open to review →</span> : null}
                            </>
                          );
                          return (
                            <li key={`${a.type}:${a.id}`}>
                              {linkable ? (
                                <Card as={Link} href={href(`/social/library/${a.id}`)} interactive padding="sm" className="flex flex-col gap-1">{body}</Card>
                              ) : (
                                <Card padding="sm" variant="surface" className="flex flex-col gap-1">{body}</Card>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}

          {textConfigured ? (
            <Card padding="sm" className="sticky bottom-0 md:static">
              <ManagerComposer organizationId={organization.id} threadId={thread.id} initialPrompt={firstParam(sp.prompt)?.slice(0, 500)} suggestions={managerSuggestions(brandName)} />
            </Card>
          ) : (
            <AiSetupCard providers={providers} />
          )}
        </section>
      </div>
    </div>
  );
}
