import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listConnectionsForUser } from "@/lib/communications-os/connections";
import { INTEGRATION_PROVIDERS, COMMUNICATION_CHANNELS } from "@/lib/communications-os/validation";
import { createConnectionAction } from "@/lib/dashboard/actions/communications";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { getJarvisVoiceReadiness } from "@/lib/voice/readiness";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/integrations`);

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

  const connections = await listConnectionsForUser(db, { organizationId, actorUserId: user.userId });
  const createConnection = createConnectionAction.bind(null, organizationSlug);
  const voice = getJarvisVoiceReadiness();

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Integrations" }]} />
      <PageHeader title="Integrations" description="External account connections — never a raw token shown here. Email/SMS/WhatsApp today; Slack, Teams, calendar, social, ads, and storage later." />

      <section aria-labelledby="jarvis-voice-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="jarvis-voice-heading" className="text-xs uppercase tracking-[0.1em] text-subtle">Jarvis voice</h2>
          <Badge tone={voice.ready ? "success" : "warning"}>{voice.ready ? "Ready" : "Setup needed"}</Badge>
        </div>
        <Card className="grid gap-5 md:grid-cols-[1fr_auto] md:items-start">
          <div>
            <h3 className="text-base font-medium text-foreground">
              {voice.ready ? "Founder calls are connected" : `${voice.completedChecks} of ${voice.totalChecks} voice checks complete`}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              Jarvis can call only the configured founder number when approval is required or a project stops. Customer and prospect calling stays locked.
            </p>
            {voice.missing.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-medium text-foreground">Still needed</p>
                <ul className="mt-2 flex flex-wrap gap-2" aria-label="Missing Jarvis voice setup">
                  {voice.missing.map((item) => <li key={item} className="rounded-sm border border-border px-2 py-1 text-xs text-muted">{item}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="text-left text-xs text-subtle md:text-right">
            <p>Calling: {voice.callingReady ? "connected" : "locked"}</p>
            <p className="mt-1">Call activity: {voice.activityTrackingReady ? "connected" : "not connected"}</p>
          </div>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Connections</h2>
        {connections.length === 0 ? (
          <EmptyState title="No connections yet." description="Connect a provider to start sending real communications." />
        ) : (
          <ul className="flex flex-col gap-2">
            {connections.map((c) => (
              <li key={c.id}>
                <Card as={Link} href={`/app/${organizationSlug}/integrations/${c.id}`} interactive padding="sm" className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-foreground">{c.displayName}</span>
                    <span className="text-xs text-subtle">{c.provider} · {c.integrationType} · last verified {c.lastVerifiedAt ? c.lastVerifiedAt.toLocaleString() : "never"}</span>
                  </div>
                  <Badge tone={c.status === "connected" ? "success" : c.status === "disabled" ? "danger" : "neutral"}>{c.status}</Badge>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Connect a provider</h2>
        <Card>
          <ActionForm action={createConnection} className="flex flex-col gap-4">
            <FormField label="Display name" name="displayName" required placeholder="e.g. Support inbox" />
            <SelectField label="Provider" name="provider" options={INTEGRATION_PROVIDERS.map((p) => ({ value: p, label: p }))} defaultValue="dev_email" />
            <SelectField label="Channel" name="integrationType" options={COMMUNICATION_CHANNELS.map((c) => ({ value: c, label: c }))} defaultValue="email" />
            <div>
              <SubmitButton pendingLabel="Connecting…">Connect</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </section>
    </div>
  );
}
