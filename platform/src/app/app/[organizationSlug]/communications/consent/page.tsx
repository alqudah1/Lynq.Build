import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listConsentRecordsForUser, listSuppressionsForUser } from "@/lib/communications-os/consent";
import { COMMUNICATION_CHANNELS, COMMUNICATION_CONSENT_STATUSES, COMMUNICATION_CONSENT_SOURCES, COMMUNICATION_SUPPRESSION_REASONS } from "@/lib/communications-os/validation";
import { upsertConsentAction, suppressIdentityAction, liftSuppressionAction } from "@/lib/dashboard/actions/communications";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";

export const dynamic = "force-dynamic";

export default async function ConsentPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/communications/consent`);

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

  const [consentRecords, suppressions] = await Promise.all([
    listConsentRecordsForUser(db, { organizationId, actorUserId: user.userId }),
    listSuppressionsForUser(db, { organizationId, actorUserId: user.userId }),
  ]);

  const upsertConsent = upsertConsentAction.bind(null, organizationSlug);
  const suppress = suppressIdentityAction.bind(null, organizationSlug);
  const lift = liftSuppressionAction.bind(null, organizationSlug);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Communications", href: `/app/${organizationSlug}/communications` }, { label: "Consent" }]} />
      <PageHeader title="Consent & suppression" description="Never assumes opt-in from CRM existence. Suppression is a broader 'never send' signal — hard bounce, complaint, manual, or compliance hold — tracked separately from consent." />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Consent records</h2>
          {consentRecords.length === 0 ? (
            <EmptyState title="No consent records yet." />
          ) : (
            <ul className="flex flex-col gap-2">
              {consentRecords.map((r) => (
                <li key={r.id}>
                  <Card padding="sm" className="flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-foreground">{r.normalizedIdentity}</span>
                      <span className="text-xs text-subtle">{r.channel} · {r.consentSource ?? "unspecified source"}</span>
                    </div>
                    <Badge tone={r.consentStatus === "opted_in" ? "success" : r.consentStatus === "opted_out" || r.consentStatus === "suppressed" ? "danger" : "neutral"}>{r.consentStatus}</Badge>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          <Card>
            <ActionForm action={upsertConsent} className="flex flex-col gap-4">
              <SelectField label="Channel" name="channel" options={COMMUNICATION_CHANNELS.map((c) => ({ value: c, label: c }))} defaultValue="email" />
              <FormField label="Identity (email or phone)" name="rawIdentity" required />
              <SelectField label="Status" name="consentStatus" options={COMMUNICATION_CONSENT_STATUSES.map((s) => ({ value: s, label: s }))} defaultValue="opted_in" />
              <SelectField label="Source" name="consentSource" options={COMMUNICATION_CONSENT_SOURCES.map((s) => ({ value: s, label: s }))} defaultValue="manual_admin" />
              <div>
                <SubmitButton pendingLabel="Saving…">Record consent</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Suppressions</h2>
          {suppressions.length === 0 ? (
            <EmptyState title="No active suppressions." />
          ) : (
            <ul className="flex flex-col gap-2">
              {suppressions.map((s) => (
                <li key={s.id}>
                  <Card padding="sm" className="flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-foreground">{s.normalizedIdentity}</span>
                      <span className="text-xs text-subtle">{s.channel} · {s.suppressionReason}</span>
                    </div>
                    <ActionForm action={lift} hiddenFields={{ suppressionId: s.id }}>
                      <SubmitButton pendingLabel="Lifting…" variant="ghost">Lift</SubmitButton>
                    </ActionForm>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          <Card>
            <ActionForm action={suppress} className="flex flex-col gap-4">
              <SelectField label="Channel" name="channel" options={COMMUNICATION_CHANNELS.map((c) => ({ value: c, label: c }))} defaultValue="email" />
              <FormField label="Identity (email or phone)" name="rawIdentity" required />
              <SelectField label="Reason" name="suppressionReason" options={COMMUNICATION_SUPPRESSION_REASONS.map((r) => ({ value: r, label: r }))} defaultValue="manual" />
              <div>
                <SubmitButton pendingLabel="Suppressing…" variant="danger">Suppress</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </div>
      </section>
    </div>
  );
}
