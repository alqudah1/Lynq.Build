import { listBrands } from "@/lib/social-os/brands";
import { listAutomationRules, type AutomationRuleView, type AutomationRunView } from "@/lib/social-os/automation";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import { hasMarketingCapability, resolveMarketingAuthContext } from "@/lib/marketing-os/authz";
import { SOCIAL_AUTOMATION_DEFAULTS, SOCIAL_AUTOMATION_KINDS, SOCIAL_ORGANIC_PLATFORMS, SOCIAL_PLATFORM_LABELS, type SocialAutomationKind } from "@/lib/social-os/validation";
import { archiveAutomationRuleAction, runAutomationRuleNowAction, setAutomationRuleEnabledAction, upsertAutomationRuleAction } from "@/lib/dashboard/actions/social";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SocialBrandSwitcher } from "@/components/social/SocialBrandSwitcher";
import { SocialActionForm } from "@/components/social/SocialActionForm";
import { TextField } from "@/components/social/fields";
import { FIELD_LABEL } from "@/components/social/parts";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { resolveBrandSelection } from "@/components/social/brand-selection";
import { formatDateTime, humanize } from "@/components/social/format";

export const dynamic = "force-dynamic";

/** Kinds that act per brand; the rest are organization-wide housekeeping but may still be scoped to one brand. */
const BRAND_KINDS: readonly SocialAutomationKind[] = ["weekly_plan", "reply_drafts"];

function intervalLabel(minutes: number): string {
  if (minutes % 10080 === 0) return `every ${minutes / 10080 === 1 ? "week" : `${minutes / 10080} weeks`}`;
  if (minutes % 1440 === 0) return `every ${minutes / 1440 === 1 ? "day" : `${minutes / 1440} days`}`;
  if (minutes % 60 === 0) return `every ${minutes / 60 === 1 ? "hour" : `${minutes / 60} hours`}`;
  return `every ${minutes} minutes`;
}

/** The numeric/boolean top-level counters a run recorded (nested detail omitted). */
function counters(run: AutomationRunView): [string, string][] {
  return Object.entries(run.result)
    .filter(([, v]) => typeof v === "number" || typeof v === "boolean")
    .slice(0, 6)
    .map(([k, v]) => [humanize(k.replace(/([A-Z])/g, "_$1").toLowerCase()), String(v)]);
}

export default async function SocialAutomationPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ brand?: string }> }) {
  const { organizationSlug } = await params;
  const sp = await searchParams;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/automation`);

  let data;
  try {
    const [brands, rules, ctx, timeZone] = await Promise.all([
      listBrands(db, { organizationId: organization.id, actorUserId: user.userId }),
      listAutomationRules(db, { organizationId: organization.id, actorUserId: user.userId }),
      resolveMarketingAuthContext(db, { organizationId: organization.id, actorUserId: user.userId }),
      getSocialTimezone(db, organization.id),
    ]);
    // Automation defaults to the organization-wide scope; picking a brand shows that brand's own rules.
    data = { brands, rules: rules.rules, ctx, timeZone, selection: resolveBrandSelection(brands, sp.brand ?? "all", true) };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "Automation" });
  }
  const { brands, rules, ctx, timeZone, selection } = data;
  const canManage = hasMarketingCapability(ctx, "marketing_manage_automation");
  const scopeId = selection.brandProfileId ?? null;
  const scopeName = selection.brandName ?? "All brands (organization-wide)";
  const otherScopes = rules.filter((r) => r.brandProfileId !== scopeId);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "Automation" }])} />
      <PageHeader
        title="Automation"
        description={`Rules for: ${scopeName}. Each one is off until a person turns it on.`}
        actions={<SocialBrandSwitcher brands={brands.map((b) => ({ id: b.id, name: b.name }))} selectedBrandId={selection.selectedBrandId} />}
      />

      <p role="note" className="rounded-sm border border-info/30 bg-info-wash px-4 py-3 text-sm text-info">
        Automation only prepares drafts, syncs data and flags what needs attention. It never publishes a post, sends a reply or spends ad money — those always wait for a person.
      </p>

      {!canManage ? <p className="rounded-sm border border-border px-4 py-3 text-sm text-muted">Read-only — changing automation needs the marketing manager role.</p> : null}

      <ul className="flex flex-col gap-4">
        {SOCIAL_AUTOMATION_KINDS.map((kind) => {
          const rule = rules.find((r) => r.kind === kind && r.brandProfileId === scopeId) ?? null;
          return (
            <li key={kind}>
              <RuleCard organizationSlug={organizationSlug} kind={kind} rule={rule} scopeId={scopeId} scopeName={scopeName} timeZone={timeZone} canManage={canManage} />
            </li>
          );
        })}
      </ul>

      {otherScopes.length ? (
        <section aria-labelledby="automation-other" className="flex flex-col gap-2">
          <h2 id="automation-other" className="text-xs uppercase tracking-[0.1em] text-subtle">Rules in other scopes</h2>
          <ul className="flex flex-col gap-1.5">
            {otherScopes.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-sm border border-border px-3 py-2 text-xs text-muted">
                <span className="text-foreground">{r.label}</span>
                <span>· {r.brandName ?? "All brands"}</span>
                <Badge tone={r.enabled ? "success" : "neutral"}>{r.enabled ? "On" : "Off"}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function RuleCard({ organizationSlug, kind, rule, scopeId, scopeName, timeZone, canManage }: { organizationSlug: string; kind: SocialAutomationKind; rule: AutomationRuleView | null; scopeId: string | null; scopeName: string; timeZone: string; canManage: boolean }) {
  const d = SOCIAL_AUTOMATION_DEFAULTS[kind];
  const interval = rule?.intervalMinutes ?? d.intervalMinutes;
  const config = rule?.config ?? {};
  const statusTone = rule?.lastRunStatus === "failed" ? "danger" : rule?.lastRunStatus === "succeeded" ? "success" : "neutral";

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base text-foreground">{d.label}</h2>
            <Badge tone={rule?.enabled ? "success" : "neutral"} dot>{rule ? (rule.enabled ? "On" : "Off") : "Not set up"}</Badge>
            <Badge>{scopeId ? "Brand" : BRAND_KINDS.includes(kind) ? "All brands" : "Organization"}</Badge>
          </div>
          <p className="text-sm text-muted">{d.description}</p>
          <p className="text-xs text-subtle">
            Runs {intervalLabel(interval)} · {scopeName}
            {rule?.enabled && rule.nextRunAt ? ` · next ${formatDateTime(rule.nextRunAt, timeZone)}` : ""}
          </p>
        </div>
        {rule && canManage ? (
          <div className="flex flex-wrap gap-2">
            <SocialActionForm action={setAutomationRuleEnabledAction.bind(null, organizationSlug, rule.id)} hiddenFields={{ expectedRevision: String(rule.revision), enabled: rule.enabled ? "0" : "1" }}>
              <SubmitButton variant={rule.enabled ? "glass" : "primary"} pendingLabel="Saving…">{rule.enabled ? "Turn off" : "Turn on"}</SubmitButton>
            </SocialActionForm>
            <SocialActionForm action={runAutomationRuleNowAction.bind(null, organizationSlug, rule.id)}>
              <SubmitButton variant="glass" pendingLabel="Queuing…">Run now</SubmitButton>
            </SocialActionForm>
          </div>
        ) : null}
      </div>

      {rule?.lastRunAt ? (
        <div className="flex flex-col gap-1 rounded-sm border border-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
            <Badge tone={statusTone}>{rule.lastRunStatus ?? "unknown"}</Badge>
            Last run {formatDateTime(rule.lastRunAt, timeZone)}
          </div>
          {rule.lastRunSummary ? <p className="text-sm text-muted">{rule.lastRunSummary}</p> : null}
        </div>
      ) : rule ? (
        <p className="text-xs text-subtle">Has not run yet.</p>
      ) : null}

      {canManage ? (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-xs text-muted hover:text-foreground">{rule ? "Settings" : "Set up this rule"}</summary>
          <SocialActionForm action={upsertAutomationRuleAction.bind(null, organizationSlug)} hiddenFields={{ kind, ...(scopeId ? { brandProfileId: scopeId } : {}) }} className="flex flex-col gap-4 pt-2">
            <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
              <input type="checkbox" name="enabled" defaultChecked={rule ? rule.enabled : false} className="h-4 w-4 accent-white" />
              Enabled
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Interval (minutes)" name="intervalMinutes" id={`interval-${kind}`} type="number" defaultValue={String(interval)} hint={`At least ${d.minIntervalMinutes} minutes (${intervalLabel(d.minIntervalMinutes)}).`} />
              {kind === "weekly_plan" ? <TextField label="Posts per week" name="postsPerWeek" id={`ppw-${kind}`} type="number" defaultValue={config.postsPerWeek !== undefined ? String(config.postsPerWeek) : ""} hint="1–21. Empty uses the planner's default." /> : null}
              {kind === "reply_drafts" ? <TextField label="Max drafts per run" name="maxDraftsPerRun" id={`max-${kind}`} type="number" defaultValue={config.maxDraftsPerRun !== undefined ? String(config.maxDraftsPerRun) : ""} hint="1–50. Empty means 10." /> : null}
              {kind === "token_watch" ? <TextField label="Warn days before expiry" name="expiryWarningDays" id={`exp-${kind}`} type="number" defaultValue={config.expiryWarningDays !== undefined ? String(config.expiryWarningDays) : ""} hint="1–30. Empty uses 7." /> : null}
            </div>
            {kind === "weekly_plan" ? (
              <fieldset className="flex flex-col gap-2">
                <legend className={FIELD_LABEL}>Platforms (empty = the brand’s preferred platforms)</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {SOCIAL_ORGANIC_PLATFORMS.map((p) => (
                    <label key={p} className="flex min-h-11 items-center gap-2 rounded-sm border border-border px-3 text-sm text-foreground">
                      <input type="checkbox" name="platforms" value={p} defaultChecked={config.platforms?.includes(p) ?? false} className="h-4 w-4 accent-white" />
                      {SOCIAL_PLATFORM_LABELS[p]}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center [&_button]:w-full sm:[&_button]:w-auto">
              <SubmitButton variant="glass" pendingLabel="Saving…">Save rule</SubmitButton>
            </div>
          </SocialActionForm>
          {rule ? (
            <div className="pt-3 [&>button]:w-full sm:[&>button]:w-auto">
              <ConfirmDialog triggerLabel="Remove rule" triggerVariant="subtle" variant="danger" title={`Remove “${d.label}”?`} description="It stops running. Past runs stay in the audit log." confirmLabel="Remove" formAction={archiveAutomationRuleAction.bind(null, organizationSlug, rule.id)} hiddenFields={{ expectedRevision: String(rule.revision) }} />
            </div>
          ) : null}
        </details>
      ) : null}

      {rule?.recentRuns.length ? (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-xs text-muted hover:text-foreground">Recent runs ({rule.recentRuns.length})</summary>
          <ul className="flex flex-col gap-2 pt-2">
            {rule.recentRuns.map((run) => (
              <li key={run.id} className="flex flex-col gap-1 rounded-sm border border-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
                  <Badge tone={run.succeeded === null ? "info" : run.succeeded ? "success" : "danger"}>{run.succeeded === null ? "Running" : run.succeeded ? "Succeeded" : "Failed"}</Badge>
                  {formatDateTime(run.startedAt, timeZone)}
                </div>
                {run.summary ? <p className="text-sm text-muted">{run.summary}</p> : null}
                {run.errorMessage ? <p className="text-xs text-danger">{run.errorMessage}</p> : null}
                {counters(run).length ? (
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {counters(run).map(([k, v]) => (
                      <div key={k} className="flex gap-1">
                        <dt className="text-subtle">{k}:</dt>
                        <dd className="text-foreground">{v}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
