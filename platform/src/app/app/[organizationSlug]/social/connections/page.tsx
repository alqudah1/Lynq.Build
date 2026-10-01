import Link from "next/link";
import { loadEnv } from "@/lib/env";
import { loadAuthEnv } from "@/lib/auth/env";
import { listBrands } from "@/lib/social-os/brands";
import { describeConnectionCenter, type SocialAccountView, type SocialConnectionView } from "@/lib/social-os/connections";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import { hasMarketingCapability, resolveMarketingAuthContext } from "@/lib/marketing-os/authz";
import { SOCIAL_PLATFORMS, SOCIAL_PLATFORM_LABELS, SOCIAL_PLATFORM_PROVIDER } from "@/lib/social-os/validation";
import {
  archiveAccountAction,
  createManualAccountAction,
  disconnectConnectionAction,
  requestEngagementSyncAction,
  requestMetricsSyncAction,
  updateAccountAction,
  verifyAccountAction,
} from "@/lib/dashboard/actions/social";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SocialBrandSwitcher } from "@/components/social/SocialBrandSwitcher";
import { SocialActionForm } from "@/components/social/SocialActionForm";
import { LabeledSelect, TextField } from "@/components/social/fields";
import { Chip, LINK_BUTTON, SectionHeading } from "@/components/social/parts";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { firstParam, resolveBrandSelection } from "@/components/social/brand-selection";
import { ACCOUNT_STATUS_TONE, CONNECTION_STATUS_LABEL, formatDateTime, formatShortDate, humanize } from "@/components/social/format";

export const dynamic = "force-dynamic";

const PROVIDER_SHORT: Record<string, string> = { meta: "Meta", linkedin: "LinkedIn", google_ads: "Google Ads" };

/** Plain-language reasons for `?social_error=` codes coming back from the OAuth routes. */
const SOCIAL_ERRORS: Record<string, string> = {
  social_oauth_state_invalid: "The connection request expired or was started in another browser. Start it again from this page.",
  social_provider_not_configured: "This provider is not configured on the server yet — see Owner setup below.",
  social_brand_archived: "That brand is archived. Choose an active brand and try again.",
  access_denied: "Permission was declined on the provider’s screen, so nothing was connected.",
  missing_code: "The provider did not return an authorization code. Try again.",
  insufficient_role: "You need the marketing role that manages connections to connect accounts.",
  connection_failed: "The connection could not be completed. Try again — if it keeps failing, check the provider app settings.",
};

function explainAccountError(a: SocialAccountView): string | null {
  if (!a.lastErrorCode && !a.lastErrorMessage) return null;
  const lead =
    a.connectionStatus === "token_expired" || a.lastErrorCode === "token_expired"
      ? "The authorization expired — reconnect this account."
      : a.connectionStatus === "authorization_required"
        ? "The platform no longer accepts LYNQ’s authorization — reconnect this account."
        : a.lastErrorCode === "credential_missing"
          ? "No stored authorization — reconnect this account."
          : a.lastErrorCode === "network_error"
            ? "The last call to the platform did not get through (network or platform outage)."
            : "The last call to the platform failed.";
  return a.lastErrorMessage ? `${lead} (${a.lastErrorMessage})` : lead;
}

function safeAuthBaseUrl(): string | null {
  try {
    return loadAuthEnv().AUTH_BASE_URL.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export default async function SocialConnectionsPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ brand?: string; connected?: string; provider?: string; accounts?: string; social_error?: string }> }) {
  const { organizationSlug } = await params;
  const sp = await searchParams;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/connections`);

  let data;
  try {
    const [brands, center, ctx, timeZone] = await Promise.all([
      listBrands(db, { organizationId: organization.id, actorUserId: user.userId }),
      describeConnectionCenter(db, { organizationId: organization.id, actorUserId: user.userId }),
      resolveMarketingAuthContext(db, { organizationId: organization.id, actorUserId: user.userId }),
      getSocialTimezone(db, organization.id),
    ]);
    data = { brands, center, ctx, timeZone, selection: resolveBrandSelection(brands, sp.brand, true) };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "Connections" });
  }
  const { brands, center, ctx, timeZone, selection } = data;
  const canManage = hasMarketingCapability(ctx, "marketing_manage_connections");
  const baseUrl = safeAuthBaseUrl();
  const webhookTokenConfigured = Boolean(loadEnv().META_WEBHOOK_VERIFY_TOKEN);
  const accounts = center.accounts.filter((a) => !selection.brandProfileId || a.brandProfileId === selection.brandProfileId);
  const selectedBrand = brands.find((b) => b.id === selection.brandProfileId) ?? null;
  const connectedNotice = firstParam(sp.connected) === "1";
  const errorCode = firstParam(sp.social_error);
  const connectedCount = Number(firstParam(sp.accounts) ?? "");
  const providerParam = firstParam(sp.provider);
  const nowMs = new Date().getTime();

  function connectHref(provider: string, brandProfileId: string): string {
    const redirectTo = `/app/${organizationSlug}/social/connections?brand=${brandProfileId}`;
    const qs = new URLSearchParams({ organizationId: organization.id, brandProfileId, redirectTo });
    return `/api/social/oauth/${provider}/start?${qs.toString()}`;
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "Connections" }])} />
      <PageHeader
        title="Connection Center"
        description="Official-API connections per brand. A status says exactly what LYNQ can do with an account right now — a row existing never means connected."
        actions={<SocialBrandSwitcher brands={brands.map((b) => ({ id: b.id, name: b.name }))} selectedBrandId={selection.selectedBrandId} />}
      />

      {connectedNotice ? (
        <StatusMessage tone="success" message={`Connected${providerParam ? ` ${PROVIDER_SHORT[providerParam] ?? providerParam}` : ""}${Number.isFinite(connectedCount) && connectedCount >= 0 ? ` — ${connectedCount} account${connectedCount === 1 ? "" : "s"} linked` : ""}. Verify each one below.`} />
      ) : null}
      {errorCode ? <StatusMessage tone="error" message={SOCIAL_ERRORS[errorCode] ?? `The connection did not complete (${humanize(errorCode)}). Nothing was changed.`} /> : null}

      <section aria-labelledby="conn-providers" className="flex flex-col gap-3">
        <SectionHeading id="conn-providers">Providers</SectionHeading>
        <ul className="grid gap-3 lg:grid-cols-3">
          {center.providers.map((p) => {
            const short = PROVIDER_SHORT[p.provider] ?? p.label;
            const reason = !p.configured ? "Not configured on this server" : !canManage ? "Needs the connection-manager role" : !selectedBrand ? "Choose a brand to connect for" : null;
            return (
              <li key={p.provider}>
                <Card className="flex h-full flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm text-foreground">{p.label}</h3>
                    <Badge tone={p.configured ? "success" : "warning"}>{p.configured ? "Configured" : "Setup needed"}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {p.platforms.map((pl) => <Chip key={pl}>{SOCIAL_PLATFORM_LABELS[pl] ?? pl}</Chip>)}
                  </div>
                  {p.missing.length ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs text-subtle">Missing environment variables</span>
                      <ul className="flex flex-wrap gap-1.5" aria-label={`Missing configuration for ${short}`}>
                        {p.missing.map((m) => <li key={m}><Chip><code>{m}</code></Chip></li>)}
                      </ul>
                    </div>
                  ) : null}
                  {p.redirectUri ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-subtle">Redirect URI to register with {short}</span>
                      <code className="break-all rounded-sm border border-border bg-elevated px-2 py-1 text-xs text-muted">{p.redirectUri}</code>
                    </div>
                  ) : null}
                  <div className="mt-auto pt-1">
                    {reason || !selectedBrand ? (
                      <div className="flex flex-col gap-1">
                        <span aria-disabled="true" className={`${LINK_BUTTON} w-full cursor-not-allowed border border-border text-subtle opacity-60`}>Connect {short}</span>
                        <span className="text-xs text-subtle">{reason}</span>
                      </div>
                    ) : (
                      <a href={connectHref(p.provider, selectedBrand.id)} className={`${LINK_BUTTON} w-full bg-foreground text-background hover:opacity-90`}>
                        Connect {short} for {selectedBrand.name}
                      </a>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="conn-accounts" className="flex flex-col gap-3">
        <SectionHeading id="conn-accounts">{selectedBrand ? `${selectedBrand.name} accounts` : "All accounts"} ({accounts.length})</SectionHeading>
        {accounts.length === 0 ? (
          <EmptyState title="No accounts yet." description="Connect a provider above, or add a tracking-only account below." />
        ) : (
          <ul className="grid gap-3 xl:grid-cols-2">
            {accounts.map((a) => (
              <li key={a.id}>
                <AccountCard organizationSlug={organizationSlug} account={a} timeZone={timeZone} canManage={canManage} brands={brands.map((b) => ({ id: b.id, name: b.name }))} nowMs={nowMs} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="conn-grants" className="flex flex-col gap-3">
        <SectionHeading id="conn-grants">Authorizations</SectionHeading>
        <p className="text-xs text-subtle">One authorization per sign-in with a provider; it can cover several accounts. Disconnecting revokes the stored token and marks its accounts disconnected.</p>
        {center.connections.length === 0 ? (
          <p className="text-sm text-subtle">No provider has been authorized yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {center.connections.map((c) => (
              <li key={c.id}>
                <GrantRow organizationSlug={organizationSlug} connection={c} timeZone={timeZone} canManage={canManage} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && brands.length ? (
        <section aria-labelledby="conn-manual" className="flex flex-col gap-3">
          <SectionHeading id="conn-manual">Add a manual account</SectionHeading>
          <Card>
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center text-sm text-foreground">Track an account without connecting it — results are recorded by hand</summary>
              <SocialActionForm action={createManualAccountAction.bind(null, organizationSlug)} className="flex flex-col gap-4 pt-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <LabeledSelect label="Brand" name="brandProfileId" id="manual-brand" defaultValue={selection.brandProfileId ?? brands[0]?.id} options={brands.map((b) => ({ value: b.id, label: b.name }))} />
                  <LabeledSelect label="Platform" name="platform" id="manual-platform" options={SOCIAL_PLATFORMS.map((p) => ({ value: p, label: SOCIAL_PLATFORM_PROVIDER[p] ? SOCIAL_PLATFORM_LABELS[p] : `${SOCIAL_PLATFORM_LABELS[p]} — tracking only, no API publishing` }))} />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <TextField label="Account name" name="displayName" id="manual-name" required maxLength={200} />
                  <TextField label="Handle" name="handle" id="manual-handle" maxLength={200} placeholder="@handle" />
                  <TextField label="Profile URL" name="externalUrl" id="manual-url" type="url" placeholder="https://" />
                </div>
                <div className="[&_button]:w-full sm:[&_button]:w-auto">
                  <SubmitButton variant="glass" pendingLabel="Adding…">Add account</SubmitButton>
                </div>
              </SocialActionForm>
            </details>
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="conn-owner" className="flex flex-col gap-3">
        <SectionHeading id="conn-owner">Owner setup</SectionHeading>
        <Card variant="surface">
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center text-sm text-foreground">Provider app settings for the server owner</summary>
            <div className="flex flex-col gap-4 pt-3 text-sm text-muted">
              <p>Each provider needs an app created in its developer console, with the redirect URI shown on its card registered exactly, and the listed environment variables set on the server.</p>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-[0.1em] text-subtle">Meta webhook (instant comment updates)</span>
                <p>Callback URL:</p>
                <code className="break-all rounded-sm border border-border bg-elevated px-2 py-1 text-xs">{baseUrl ? `${baseUrl}/api/social/webhooks/meta` : "Set AUTH_BASE_URL to see the callback URL"}</code>
                <p>
                  The verify token entered in Meta must match <code className="text-xs">META_WEBHOOK_VERIFY_TOKEN</code> (at least 16 characters).{" "}
                  <Badge tone={webhookTokenConfigured ? "success" : "warning"}>{webhookTokenConfigured ? "Token set" : "Token not set"}</Badge>
                </p>
                <p className="text-xs text-subtle">Webhook events only nudge a sync; the inbox still pulls through the official API.</p>
              </div>
              <p className="text-xs text-subtle">TikTok, YouTube and X have no official-API integration in this build: add them as manual accounts to track results.</p>
              <Link href={`/app/${organizationSlug}/social/settings`} className="text-xs text-muted underline-offset-4 hover:text-foreground hover:underline">AI providers and roles → Settings</Link>
            </div>
          </details>
        </Card>
      </section>
    </div>
  );
}

function AccountCard({ organizationSlug, account: a, timeZone, canManage, brands, nowMs }: { organizationSlug: string; account: SocialAccountView; timeZone: string; canManage: boolean; brands: { id: string; name: string }[]; nowMs: number }) {
  const rev = String(a.revision);
  const error = a.connectionStatus !== "connected" || a.lastErrorCode ? explainAccountError(a) : null;
  const expiresSoon = a.tokenExpiresAt ? a.tokenExpiresAt.getTime() - nowMs < 7 * 24 * 3600_000 : false;
  const caps = [
    { label: "Publish", on: a.canPublish },
    { label: "Insights", on: a.canReadInsights },
    { label: "Engagement", on: a.canReadEngagement },
    { label: "Ads", on: a.canManageAds },
  ];

  return (
    <Card variant="surface" padding="sm" className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm text-foreground">{a.displayName}</span>
          <span className="text-xs text-subtle">
            {a.platformLabel}
            {a.handle ? ` · ${a.handle}` : ""}
            {a.brandName ? ` · ${a.brandName}` : ""}
          </span>
        </div>
        <Badge tone={ACCOUNT_STATUS_TONE[a.connectionStatus] ?? "neutral"} dot>{CONNECTION_STATUS_LABEL[a.connectionStatus] ?? a.connectionStatus}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-subtle">Authorization expires</dt>
          <dd className={expiresSoon ? "text-warning" : "text-muted"}>{a.tokenExpiresAt ? formatShortDate(a.tokenExpiresAt, timeZone) : a.integrationConnectionId ? "No expiry reported" : "—"}</dd>
        </div>
        <div>
          <dt className="text-subtle">Last sync</dt>
          <dd className="text-muted">{a.lastSyncAt ? formatDateTime(a.lastSyncAt, timeZone) : "Never"}</dd>
        </div>
      </dl>
      {a.supported ? (
        <div className="flex flex-wrap gap-1.5" aria-label="What LYNQ can do with this account">
          {caps.map((c) => <Chip key={c.label} tone={c.on ? "on" : "off"}>{c.label}</Chip>)}
        </div>
      ) : (
        <p className="text-xs text-subtle">Tracking only — {a.platformLabel} has no official-API integration in this build, so nothing is published or synced. Record results manually in Analytics.</p>
      )}
      {error ? <p className="rounded-sm border border-danger/30 bg-danger-wash px-3 py-2 text-xs text-danger">{error}{a.lastErrorAt ? ` · ${formatDateTime(a.lastErrorAt, timeZone)}` : ""}</p> : null}

      {canManage ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap [&_button]:w-full sm:[&_button]:w-auto">
            {a.integrationConnectionId && a.connectionStatus !== "disconnected" ? (
              <SocialActionForm action={verifyAccountAction.bind(null, organizationSlug, a.id)} className="flex flex-col gap-2">
                <SubmitButton variant="glass" pendingLabel="Checking…">Verify</SubmitButton>
              </SocialActionForm>
            ) : null}
            {a.canReadInsights ? (
              <SocialActionForm action={requestMetricsSyncAction.bind(null, organizationSlug, a.id)} className="flex flex-col gap-2">
                <SubmitButton variant="glass" pendingLabel="Queuing…">Sync metrics</SubmitButton>
              </SocialActionForm>
            ) : null}
            {a.canReadEngagement ? (
              <SocialActionForm action={requestEngagementSyncAction.bind(null, organizationSlug, a.id)} className="flex flex-col gap-2">
                <SubmitButton variant="glass" pendingLabel="Queuing…">Sync engagement</SubmitButton>
              </SocialActionForm>
            ) : null}
            <ConfirmDialog triggerLabel="Archive" triggerVariant="subtle" variant="danger" title={`Archive ${a.displayName}?`} description="It leaves every account picker and stops syncing. Its history stays. The provider authorization is not revoked — disconnect that below." confirmLabel="Archive" formAction={archiveAccountAction.bind(null, organizationSlug, a.id)} hiddenFields={{ expectedRevision: rev }} />
          </div>
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center text-xs text-muted hover:text-foreground">Edit details</summary>
            <SocialActionForm action={updateAccountAction.bind(null, organizationSlug, a.id)} hiddenFields={{ expectedRevision: rev }} className="flex flex-col gap-3 pt-2">
              <LabeledSelect label="Brand" name="brandProfileId" id={`acct-brand-${a.id}`} defaultValue={a.brandProfileId} options={brands.map((b) => ({ value: b.id, label: b.name }))} />
              <TextField label="Display name" name="displayName" id={`acct-name-${a.id}`} defaultValue={a.displayName} required maxLength={200} />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Handle" name="handle" id={`acct-handle-${a.id}`} defaultValue={a.handle ?? ""} maxLength={200} />
                <TextField label="Profile URL" name="externalUrl" id={`acct-url-${a.id}`} type="url" defaultValue={a.externalUrl ?? ""} placeholder="https://" />
              </div>
              <div className="[&_button]:w-full sm:[&_button]:w-auto">
                <SubmitButton variant="glass" pendingLabel="Saving…">Save</SubmitButton>
              </div>
            </SocialActionForm>
          </details>
        </>
      ) : null}
    </Card>
  );
}

function GrantRow({ organizationSlug, connection: c, timeZone, canManage }: { organizationSlug: string; connection: SocialConnectionView; timeZone: string; canManage: boolean }) {
  const disconnected = Boolean(c.disconnectedAt) || c.status === "disconnected";
  return (
    <Card variant="surface" padding="sm" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-foreground">{c.displayName}</span>
          <Badge>{PROVIDER_SHORT[c.provider] ?? c.provider}</Badge>
          <Badge tone={disconnected ? "neutral" : c.status === "connected" ? "success" : "warning"} dot>{disconnected ? "Disconnected" : humanize(c.status)}</Badge>
        </div>
        <span className="text-xs text-subtle">
          {c.accountCount} account{c.accountCount === 1 ? "" : "s"} · {c.scopes.length} permission{c.scopes.length === 1 ? "" : "s"} · {disconnected && c.disconnectedAt ? `disconnected ${formatDateTime(c.disconnectedAt, timeZone)}` : c.lastVerifiedAt ? `verified ${formatDateTime(c.lastVerifiedAt, timeZone)}` : "never verified"}
        </span>
      </div>
      {canManage && !disconnected ? (
        <div className="[&>button]:w-full sm:[&>button]:w-auto">
          <ConfirmDialog triggerLabel="Disconnect" triggerVariant="danger" variant="danger" title={`Disconnect ${PROVIDER_SHORT[c.provider] ?? c.provider}?`} description={`The stored token is revoked and ${c.accountCount} account${c.accountCount === 1 ? "" : "s"} stop publishing and syncing until reconnected. Scheduled posts on those accounts will fail.`} confirmLabel="Disconnect" formAction={disconnectConnectionAction.bind(null, organizationSlug, c.id)} hiddenFields={{ expectedRevision: String(c.revision) }} />
        </div>
      ) : null}
    </Card>
  );
}
