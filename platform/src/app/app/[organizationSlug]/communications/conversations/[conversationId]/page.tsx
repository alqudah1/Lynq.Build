import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getConversationForUser } from "@/lib/communications-os/conversations";
import { listMessagesForConversation } from "@/lib/communications-os/messages";
import {
  createDraftMessageAction,
  submitMessageForApprovalAction,
  approveDraftDirectlyAction,
  decideMessageApprovalAction,
  queueMessageForSendAction,
  launchDraftReplyAction,
  launchDraftFollowUpAction,
} from "@/lib/dashboard/actions/communications";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";

export const dynamic = "force-dynamic";

function statusTone(status: string): BadgeTone {
  if (status === "sent" || status === "delivered" || status === "received") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "pending_approval" || status === "queued" || status === "sending") return "warning";
  return "neutral";
}

export default async function ConversationDetailPage({ params }: { params: Promise<{ organizationSlug: string; conversationId: string }> }) {
  const { organizationSlug, conversationId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/communications/conversations/${conversationId}`);

  let organizationName: string;
  let organizationId: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    organizationId = organization.id;
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  let conversation;
  try {
    conversation = await getConversationForUser(db, { organizationId, conversationId, actorUserId: user.userId });
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const messages = await listMessagesForConversation(db, { organizationId, conversationId, actorUserId: user.userId });

  const createDraft = createDraftMessageAction.bind(null, organizationSlug);
  const submitForApproval = submitMessageForApprovalAction.bind(null, organizationSlug);
  const approveDirect = approveDraftDirectlyAction.bind(null, organizationSlug);
  const decideApproval = decideMessageApprovalAction.bind(null, organizationSlug);
  const queueSend = queueMessageForSendAction.bind(null, organizationSlug);
  const draftReply = launchDraftReplyAction.bind(null, organizationSlug);
  const draftFollowUp = launchDraftFollowUpAction.bind(null, organizationSlug);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs
        items={[
          { label: "LYNQ", href: "/app" },
          { label: organizationName, href: `/app/${organizationSlug}` },
          { label: "Communications", href: `/app/${organizationSlug}/communications` },
          { label: "Inbox", href: `/app/${organizationSlug}/communications/inbox` },
          { label: "Conversation" },
        ]}
      />
      <PageHeader title={`${conversation.channel} conversation`} description={conversation.contactId ? "Linked to a resolved CRM contact." : "No resolved CRM contact — identity resolution is conservative and never guesses."} actions={<Badge tone={conversation.status === "open" ? "accent" : "neutral"}>{conversation.status}</Badge>} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Timeline</h2>
        {messages.length === 0 ? (
          <EmptyState title="No messages yet." description="Draft the first message below." />
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((m) => (
              <li key={m.id}>
                <Card padding="sm" className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs uppercase tracking-[0.1em] text-subtle">{m.direction} · {m.recipientReference ?? m.senderReference ?? "—"}</span>
                    <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                  </div>
                  {m.subject ? <p className="text-sm font-medium text-foreground">{m.subject}</p> : null}
                  <p className="whitespace-pre-wrap text-sm text-subtle">{m.bodyText ?? "(no body)"}</p>
                  {m.direction === "outbound" ? (
                    <div className="flex flex-wrap gap-3 pt-1">
                      {m.status === "draft" ? (
                        <>
                          <ActionForm action={approveDirect} hiddenFields={{ messageId: m.id }}>
                            <SubmitButton pendingLabel="Approving…" variant="glass">Approve to send</SubmitButton>
                          </ActionForm>
                          <ActionForm action={submitForApproval} hiddenFields={{ messageId: m.id, summary: "Please review this message before it sends." }}>
                            <SubmitButton pendingLabel="Submitting…" variant="ghost">Submit for approval</SubmitButton>
                          </ActionForm>
                        </>
                      ) : null}
                      {m.status === "pending_approval" ? (
                        <>
                          <ActionForm action={decideApproval} hiddenFields={{ messageId: m.id, decision: "approved" }}>
                            <SubmitButton pendingLabel="Approving…" variant="glass">Approve</SubmitButton>
                          </ActionForm>
                          <ActionForm action={decideApproval} hiddenFields={{ messageId: m.id, decision: "rejected" }}>
                            <SubmitButton pendingLabel="Rejecting…" variant="danger">Reject</SubmitButton>
                          </ActionForm>
                        </>
                      ) : null}
                      {m.status === "approved" ? (
                        <ActionForm action={queueSend} hiddenFields={{ messageId: m.id }}>
                          <SubmitButton pendingLabel="Queuing…">Send</SubmitButton>
                        </ActionForm>
                      ) : null}
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Compose</h2>
          <ActionForm action={createDraft} hiddenFields={{ conversationId: conversation.id, channel: conversation.channel }} className="flex flex-col gap-4">
            <FormField label="Recipient" name="recipientReference" required placeholder="email@example.com" />
            {conversation.channel === "email" ? <FormField label="Subject" name="subject" /> : null}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bodyText" className="text-xs uppercase tracking-[0.1em] text-subtle">Body</label>
              <textarea id="bodyText" name="bodyText" required rows={5} className="lynq-transition rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:border-accent/60" />
            </div>
            <div>
              <SubmitButton pendingLabel="Drafting…">Create draft</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Agent-assisted draft</h2>
          <p className="text-sm text-subtle">The Communications Assistant reads bounded conversation context and drafts a reply or follow-up — it never sends, and the recipient is always the conversation&apos;s own resolved counterpart.</p>
          <div className="flex flex-wrap gap-3">
            <ActionForm action={draftReply} hiddenFields={{ conversationId: conversation.id }}>
              <SubmitButton pendingLabel="Drafting…" variant="glass">Draft reply</SubmitButton>
            </ActionForm>
          </div>
          <ActionForm action={draftFollowUp} hiddenFields={{ conversationId: conversation.id }} className="flex flex-col gap-3">
            <FormField label="Follow-up reason" name="reason" required placeholder="e.g. No response in 5 days" />
            <div>
              <SubmitButton pendingLabel="Drafting…" variant="glass">Draft follow-up</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </section>
    </div>
  );
}
