import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getConnectionForUser } from "@/lib/communications-os/connections";
import { verifyConnectionAction, storeConnectionCredentialAction, disableConnectionAction } from "@/lib/dashboard/actions/communications";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";

export const dynamic = "force-dynamic";

export default async function ConnectionDetailPage({ params }: { params: Promise<{ organizationSlug: string; connectionId: string }> }) {
  const { organizationSlug, connectionId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/integrations/${connectionId}`);

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

  let connection;
  try {
    connection = await getConnectionForUser(db, { organizationId, connectionId, actorUserId: user.userId });
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const verify = verifyConnectionAction.bind(null, organizationSlug);
  const storeCredential = storeConnectionCredentialAction.bind(null, organizationSlug);
  const disable = disableConnectionAction.bind(null, organizationSlug);
  const webhookUrl = `/api/integrations/${connection.provider}/${connection.id}/webhook`;

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Integrations", href: `/app/${organizationSlug}/integrations` }, { label: connection.displayName }]} />
      <PageHeader title={connection.displayName} description={`${connection.provider} · ${connection.integrationType}`} actions={<Badge tone={connection.status === "connected" ? "success" : connection.status === "disabled" ? "danger" : "neutral"}>{connection.status}</Badge>} />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Status</h2>
          <p className="text-sm text-subtle">Last verified: {connection.lastVerifiedAt ? connection.lastVerifiedAt.toLocaleString() : "never"}</p>
          <p className="text-sm text-subtle">External account: {connection.externalAccountId ?? "not yet resolved"}</p>
          <p className="text-sm text-subtle">Webhook URL: <code className="text-xs">{webhookUrl}</code></p>
          <div className="flex gap-3">
            <ActionForm action={verify} hiddenFields={{ connectionId: connection.id }}>
              <SubmitButton pendingLabel="Verifying…" variant="glass">Verify connection</SubmitButton>
            </ActionForm>
            <ActionForm action={disable} hiddenFields={{ connectionId: connection.id, expectedRevision: connection.revision }}>
              <SubmitButton pendingLabel="Disabling…" variant="danger">Disable</SubmitButton>
            </ActionForm>
          </div>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Credential</h2>
          <p className="text-sm text-subtle">Never displayed once stored — encrypted at rest.</p>
          <ActionForm action={storeCredential} hiddenFields={{ connectionId: connection.id }} className="flex flex-col gap-4">
            <FormField label="Secret (API key)" name="secret" type="password" placeholder="Only needed for a real provider (e.g. Resend)" />
            <div>
              <SubmitButton pendingLabel="Storing…">Store credential</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </section>
    </div>
  );
}
