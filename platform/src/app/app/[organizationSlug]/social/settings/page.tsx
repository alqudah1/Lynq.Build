import Link from "next/link";
import { loadEnv } from "@/lib/env";
import { describeAiProviders, loadSocialAiEnv } from "@/lib/social-os/providers/ai/registry";
import { describeProviderAvailability } from "@/lib/social-os/providers/social/registry";
import { listGenerations, summarizeGenerationUsage } from "@/lib/social-os/generation";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import { hasMarketingCapability, resolveMarketingAuthContext } from "@/lib/marketing-os/authz";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-os/validation";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { Chip, Meter, SectionHeading } from "@/components/social/parts";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { formatDateTime, formatUsd, humanize } from "@/components/social/format";

export const dynamic = "force-dynamic";

/**
 * The Marketing OS role → capability map as documented in
 * `marketing-os/authz.ts` (`ROLE_CAPABILITIES` is module-private there).
 * Display only — every action re-checks authority in its service.
 */
const ROLE_ROWS: { role: string; label: string; caps: string[] }[] = [
  { role: "marketing_admin", label: "Marketing admin (and org owners/admins)", caps: ["draft", "approve", "publish", "reply", "brands", "ads", "approve_ads", "connections", "automation"] },
  { role: "marketing_manager", label: "Marketing manager", caps: ["draft", "approve", "publish", "reply", "brands", "ads", "automation"] },
  { role: "marketing_contributor", label: "Marketing contributor", caps: ["draft"] },
  { role: "viewer", label: "Viewer", caps: [] },
];
const CAP_COLUMNS: { key: string; label: string }[] = [
  { key: "draft", label: "Draft & generate" },
  { key: "approve", label: "Approve posts" },
  { key: "publish", label: "Publish" },
  { key: "reply", label: "Reply & triage" },
  { key: "brands", label: "Edit brands" },
  { key: "ads", label: "Propose ad changes" },
  { key: "approve_ads", label: "Approve ad spend" },
  { key: "connections", label: "Connect accounts" },
  { key: "automation", label: "Automation" },
];

export default async function SocialSettingsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/settings`);

  let data;
  try {
    const aiEnv = await loadSocialAiEnv();
    const [usage, generations, ctx, timeZone] = await Promise.all([
      summarizeGenerationUsage(db, { organizationId: organization.id, actorUserId: user.userId, env: aiEnv }),
      listGenerations(db, { organizationId: organization.id, actorUserId: user.userId, limit: 50 }),
      resolveMarketingAuthContext(db, { organizationId: organization.id, actorUserId: user.userId }),
      getSocialTimezone(db, organization.id),
    ]);
    data = { aiProviders: describeAiProviders(aiEnv), socialProviders: describeProviderAvailability(loadEnv()), usage, generations, ctx, timeZone };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "Social settings" });
  }
  const { aiProviders, socialProviders, usage, generations, ctx, timeZone } = data;
  const isOrgAdmin = ctx.orgRole === "owner" || ctx.orgRole === "admin";
  const myRole = isOrgAdmin ? `Organization ${ctx.orgRole} (full marketing access)` : ctx.marketingRole ? humanize(ctx.marketingRole.replace(/^marketing_/, "")) : "No marketing role";
  const totalCost = usage.byProvider.reduce((s, r) => s + r.costUsd, 0);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "Settings" }])} />
      <PageHeader title="Social settings" description="Which AI and social providers this server can use, what they cost, who may do what, and the rules every post and ad change follows." />

      <section aria-labelledby="settings-policy" className="flex flex-col gap-3">
        <SectionHeading id="settings-policy">Publishing policy</SectionHeading>
        <Card className="flex flex-col gap-2 text-sm text-muted">
          <p><span className="text-foreground">Approval is required by default.</span> Every post is reviewed by someone who can approve before it can be scheduled or published; editing an approved post sends it back to draft.</p>
          <p><span className="text-foreground">No autonomous spend.</span> AI and automation can only propose ad changes; each one executes once, after a person with ad-approval rights approves the exact change.</p>
          <p><span className="text-foreground">Replies are human.</span> AI drafts replies; one is posted only when a person presses send.</p>
          <p><span className="text-foreground">Official APIs only.</span> TikTok, YouTube and X are tracked manually in this build.</p>
        </Card>
      </section>

      <section aria-labelledby="settings-ai" className="flex flex-col gap-3">
        <SectionHeading id="settings-ai">AI providers</SectionHeading>
        <Table>
          <THead>
            <tr>
              <Th>Provider</Th>
              <Th>Kind</Th>
              <Th>Status</Th>
              <Th className="hidden md:table-cell">Default model</Th>
            </tr>
          </THead>
          <TBody>
            {aiProviders.map((p) => (
              <Tr key={`${p.kind}-${p.id}`}>
                <Td>
                  <span className="text-sm text-foreground">{p.label}</span>
                  {p.missing.length ? (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {p.missing.map((m) => <Chip key={m}><code>{m}</code></Chip>)}
                    </span>
                  ) : null}
                </Td>
                <Td className="text-muted">{humanize(p.kind)}</Td>
                <Td><Badge tone={p.configured ? "success" : "neutral"} dot>{p.configured ? "Configured" : "Not configured"}</Badge></Td>
                <Td className="hidden font-mono text-xs text-muted md:table-cell">{p.defaultModel}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        <p className="text-xs text-subtle">The first configured provider of each kind is used. Missing environment variables are listed by name; values are never shown.</p>
      </section>

      <section aria-labelledby="settings-usage" className="flex flex-col gap-3">
        <SectionHeading id="settings-usage">AI usage</SectionHeading>
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm text-foreground">Today’s media spend</span>
            <span className="text-sm tabular-nums text-foreground">{formatUsd(usage.todaySpendUsd)} of {formatUsd(usage.dailyBudgetUsd)} daily budget</span>
          </div>
          <Meter value={usage.todaySpendUsd} total={usage.dailyBudgetUsd} label="Daily AI budget used" />
          <p className="text-xs text-subtle">Image and video generation stops for the day once the budget is reached. Text generation cost is recorded when the provider reports it.</p>
        </Card>
        {usage.byProvider.length === 0 ? (
          <EmptyState title={`No AI generations in the last ${usage.days} days.`} />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Provider · model</Th>
                <Th className="text-right">Runs</Th>
                <Th className="hidden text-right sm:table-cell">Failed</Th>
                <Th className="text-right">Cost ({usage.days}d)</Th>
              </tr>
            </THead>
            <TBody>
              {usage.byProvider.map((r) => (
                <Tr key={`${r.provider}-${r.model}`}>
                  <Td><span className="text-sm text-foreground">{r.provider}</span> <span className="font-mono text-xs text-subtle">{r.model}</span></Td>
                  <Td className="text-right tabular-nums">{r.count}</Td>
                  <Td className="hidden text-right tabular-nums sm:table-cell">{r.failed}</Td>
                  <Td className="text-right tabular-nums">{formatUsd(r.costUsd)}</Td>
                </Tr>
              ))}
              <Tr>
                <Td className="text-xs uppercase tracking-[0.08em] text-subtle">Total</Td>
                <Td className="text-right tabular-nums">{usage.byProvider.reduce((s, r) => s + r.count, 0)}</Td>
                <Td className="hidden text-right tabular-nums sm:table-cell">{usage.byProvider.reduce((s, r) => s + r.failed, 0)}</Td>
                <Td className="text-right tabular-nums">{formatUsd(totalCost)}</Td>
              </Tr>
            </TBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="settings-social" className="flex flex-col gap-3">
        <SectionHeading id="settings-social" action={<Link href={`/app/${organizationSlug}/social/connections`} className="text-xs text-muted hover:text-foreground">Connection Center →</Link>}>
          Social providers
        </SectionHeading>
        <ul className="grid gap-3 md:grid-cols-3">
          {socialProviders.map((p) => (
            <li key={p.provider}>
              <Card variant="surface" padding="sm" className="flex h-full flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-foreground">{p.label}</span>
                  <Badge tone={p.configured ? "success" : "warning"}>{p.configured ? "Configured" : "Setup needed"}</Badge>
                </div>
                <span className="text-xs text-subtle">{p.platforms.map((pl) => SOCIAL_PLATFORM_LABELS[pl] ?? pl).join(" · ")}</span>
                {p.missing.length ? (
                  <div className="flex flex-wrap gap-1">
                    {p.missing.map((m) => <Chip key={m}><code>{m}</code></Chip>)}
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="settings-roles" className="flex flex-col gap-3">
        <SectionHeading id="settings-roles" action={hasMarketingCapability(ctx, "marketing_admin") ? <Link href={`/app/${organizationSlug}/marketing/settings`} className="text-xs text-muted hover:text-foreground">Grant roles in Marketing settings →</Link> : null}>
          Roles and capabilities
        </SectionHeading>
        <p className="text-sm text-muted">Your access: <span className="text-foreground">{myRole}</span>.</p>
        <Table>
          <THead>
            <tr>
              <Th>Role</Th>
              {CAP_COLUMNS.map((c) => <Th key={c.key} className="text-center">{c.label}</Th>)}
            </tr>
          </THead>
          <TBody>
            {ROLE_ROWS.map((r) => (
              <Tr key={r.role}>
                <Td className="whitespace-nowrap text-sm">{r.label}</Td>
                {CAP_COLUMNS.map((c) => (
                  <Td key={c.key} className="text-center">
                    {r.caps.includes(c.key) ? <span className="text-success" aria-label="Yes">✓</span> : <span className="text-subtle" aria-label="No">—</span>}
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
        <p className="text-xs text-subtle">Every member with a marketing role can view Social. Roles are granted per person in Marketing settings; organization owners and admins always have full access.</p>
      </section>

      <section aria-labelledby="settings-generations" className="flex flex-col gap-3">
        <SectionHeading id="settings-generations">Generation log (latest 50)</SectionHeading>
        {generations.length === 0 ? (
          <EmptyState title="No AI generations yet." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>When</Th>
                <Th>Type</Th>
                <Th className="hidden sm:table-cell">Provider · model</Th>
                <Th>Status</Th>
                <Th className="hidden text-right md:table-cell">Cost</Th>
              </tr>
            </THead>
            <TBody>
              {generations.map((g) => (
                <Tr key={g.id}>
                  <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(g.createdAt, timeZone)}</Td>
                  <Td>{humanize(g.generationType)}</Td>
                  <Td className="hidden text-xs text-muted sm:table-cell">{g.provider} · <span className="font-mono">{g.model}</span></Td>
                  <Td>
                    <Badge tone={g.status === "succeeded" ? "success" : g.status === "failed" ? "danger" : g.status === "cancelled" ? "neutral" : "info"}>{humanize(g.status)}</Badge>
                    {g.status === "failed" && g.errorMessage ? <p className="mt-1 max-w-xs text-xs text-subtle">{g.errorMessage.slice(0, 160)}</p> : null}
                  </Td>
                  <Td className="hidden text-right tabular-nums text-muted md:table-cell">{g.costUsd === null ? "Not reported" : formatUsd(g.costUsd)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}
