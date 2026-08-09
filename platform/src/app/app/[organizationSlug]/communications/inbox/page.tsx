import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listConversationsForUser } from "@/lib/communications-os/conversations";
import { listConnectionsForUser } from "@/lib/communications-os/connections";
import { COMMUNICATION_CHANNELS } from "@/lib/communications-os/validation";
import { createConversationAction } from "@/lib/dashboard/actions/communications";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";

export const dynamic = "force-dynamic";

export default async function InboxPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/communications/inbox`);

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

  const [conversations, connections] = await Promise.all([
    listConversationsForUser(db, { organizationId, actorUserId: user.userId }),
    listConnectionsForUser(db, { organizationId, actorUserId: user.userId }),
  ]);
  const createConversation = createConversationAction.bind(null, organizationSlug);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Communications", href: `/app/${organizationSlug}/communications` }, { label: "Inbox" }]} />
      <PageHeader title="Inbox" description="Every conversation — channel, resolved contact where known, assigned user, last message." />

      <section className="flex flex-col gap-3">
        {conversations.length === 0 ? (
          <EmptyState title="No conversations yet." description="Real messages will appear here once a connection is verified and a conversation is started." />
        ) : (
          <ul className="flex flex-col gap-2">
            {conversations.map((c) => (
              <li key={c.id}>
                <Card as={Link} href={`/app/${organizationSlug}/communications/conversations/${c.id}`} interactive padding="sm" className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-foreground">{c.channel} conversation</span>
                    <span className="text-xs text-subtle">{c.contactId ? "Resolved contact" : "No resolved contact"} · last message {c.lastMessageAt ? c.lastMessageAt.toLocaleString() : "none yet"}</span>
                  </div>
                  <Badge tone={c.status === "open" ? "accent" : c.status === "resolved" ? "success" : "neutral"}>{c.status}</Badge>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Start a conversation</h2>
        <Card>
          <ActionForm action={createConversation} className="flex flex-col gap-4">
            <SelectField label="Channel" name="channel" options={COMMUNICATION_CHANNELS.map((c) => ({ value: c, label: c }))} defaultValue="email" />
            <SelectField label="Connection" name="integrationConnectionId" options={[{ value: "", label: "None yet" }, ...connections.map((c) => ({ value: c.id, label: c.displayName }))]} />
            <div>
              <SubmitButton pendingLabel="Starting…">Start conversation</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </section>
    </div>
  );
}
