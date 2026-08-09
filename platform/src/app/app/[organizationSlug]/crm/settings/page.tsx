import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listTagsForUser } from "@/lib/crm/tags";
import { listSourcesForUser } from "@/lib/crm/sources";
import { listCrmAgentPermissionGrants } from "@/lib/crm/agent-permissions";
import { listAgents } from "@/lib/agents/agents";
import { createTagAction, seedSourcesAction, grantAgentPermissionAction, revokeAgentPermissionAction } from "@/lib/dashboard/actions/crm";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { CreateTagForm } from "@/components/dashboard/crm/CreateTagForm";
import { GrantAgentPermissionForm } from "@/components/dashboard/crm/GrantAgentPermissionForm";
import { SeedSourcesForm } from "@/components/dashboard/crm/SeedSourcesForm";
import { RevokeAgentGrantForm } from "@/components/dashboard/crm/RevokeAgentGrantForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

/**
 * CRM settings — tags, source attribution, and agent permission grants.
 * Custom field definitions are managed via the API for now (a dedicated
 * builder UI is deferred; see MODULE_12_CRM_CORE.md's "Deferred" section).
 */
export default async function CrmSettingsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/crm/settings`);

  let organizationId: string;
  let organizationName: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationId = organization.id;
    organizationName = organization.name;
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const [tags, sources] = await Promise.all([listTagsForUser(db, { organizationId, actorUserId: user.userId }), listSourcesForUser(db, { organizationId, actorUserId: user.userId })]);

  let agents: Awaited<ReturnType<typeof listAgents>> = [];
  let grants: Awaited<ReturnType<typeof listCrmAgentPermissionGrants>> = [];
  try {
    agents = await listAgents(db, { organizationId, actorUserId: user.userId });
    grants = await listCrmAgentPermissionGrants(db, { organizationId, actorUserId: user.userId });
  } catch {
    // Requires org owner/admin (agent-permission grants) and Agent Registry management authority (agent list) — an ordinary member simply doesn't see this section, never a hard error on the page.
  }

  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "CRM", href: `/app/${organizationSlug}/crm` }, { label: "Settings" }]} />
      <PageHeader title="CRM settings" />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Tags</h2>
        {tags.length === 0 ? <EmptyState title="No tags yet." /> : (
          <ul className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <li key={t.id}>
                <Badge tone="neutral">{t.name}</Badge>
              </li>
            ))}
          </ul>
        )}
        <CreateTagForm action={createTagAction.bind(null, organizationSlug)} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Sources</h2>
        {sources.length === 0 ? (
          <SeedSourcesForm action={seedSourcesAction.bind(null, organizationSlug)} />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {sources.map((s) => (
              <li key={s.id}>
                <Badge tone="neutral">{s.name}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Agent CRM read permissions</h2>
        <p className="text-sm text-muted">Default deny — an agent&apos;s Brain access never implies CRM access. Only the grants below are honored.</p>
        {grants.length === 0 ? <EmptyState title="No agent grants yet." /> : (
          <ul className="flex flex-col gap-2">
            {grants
              .filter((g) => !g.revokedAt)
              .map((g) => (
                <Card as="li" key={g.id} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-foreground">
                    {agentNameById.get(g.agentId) ?? g.agentId} — {g.permission}
                  </span>
                  <RevokeAgentGrantForm expectedRevision={g.revision} action={revokeAgentPermissionAction.bind(null, organizationSlug, g.id)} />
                </Card>
              ))}
          </ul>
        )}
        <GrantAgentPermissionForm agents={agents.map((a) => ({ id: a.id, name: a.name }))} action={grantAgentPermissionAction.bind(null, organizationSlug)} />
      </section>
    </div>
  );
}
