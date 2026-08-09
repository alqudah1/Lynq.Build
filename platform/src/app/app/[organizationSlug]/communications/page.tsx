import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listConnectionsForUser } from "@/lib/communications-os/connections";
import { listConversationsForUser } from "@/lib/communications-os/conversations";
import { listBulkBatchesForUser } from "@/lib/communications-os/bulk";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

function StatCard({ href, label, value, sublabel }: { href: string; label: string; value: number | string; sublabel?: string }) {
  return (
    <Card as={Link} href={href} interactive className="flex flex-col gap-1.5">
      <p className="text-xs uppercase tracking-[0.15em] text-subtle">{label}</p>
      <p className="font-serif text-3xl italic font-light text-foreground">{value}</p>
      {sublabel ? <p className="text-xs text-subtle">{sublabel}</p> : null}
    </Card>
  );
}

export default async function CommunicationsDashboardPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/communications`);

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

  const [connections, conversations, batches] = await Promise.all([
    listConnectionsForUser(db, { organizationId, actorUserId: user.userId }),
    listConversationsForUser(db, { organizationId, status: "open", actorUserId: user.userId }),
    listBulkBatchesForUser(db, { organizationId, actorUserId: user.userId }),
  ]);

  const connectedCount = connections.filter((c) => c.status === "connected").length;
  const activeBatches = batches.filter((b) => b.status === "in_progress" || b.status === "queued").length;

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Communications" }]} />
      <PageHeader title="Communications" description="The shared, provider-neutral layer for real email/SMS/WhatsApp — canonical conversations and messages CRM, Sales OS, and Marketing OS build on." />

      <section aria-label="Overview" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard href={`/app/${organizationSlug}/integrations`} label="Connections" value={connections.length} sublabel={`${connectedCount} connected`} />
        <StatCard href={`/app/${organizationSlug}/communications/inbox`} label="Open conversations" value={conversations.length} />
        <StatCard href={`/app/${organizationSlug}/communications/batches`} label="Active batches" value={activeBatches} />
        <StatCard href={`/app/${organizationSlug}/communications/consent`} label="Consent & suppression" value="Manage" />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Connections</h2>
        {connections.length === 0 ? (
          <Card className="flex items-center justify-between gap-3">
            <span className="text-sm text-subtle">No integration connections yet.</span>
            <Link href={`/app/${organizationSlug}/integrations`} className="text-xs text-accent">Connect a provider →</Link>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {connections.map((c) => (
              <li key={c.id}>
                <Card padding="sm" className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-foreground">{c.displayName}</span>
                    <span className="text-xs text-subtle">{c.provider} · {c.integrationType}</span>
                  </div>
                  <Badge tone={c.status === "connected" ? "success" : c.status === "disabled" ? "danger" : "neutral"}>{c.status}</Badge>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
