import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getMarketingCommandCenter } from "@/lib/marketing-os/command-center";
import { setupMarketingCommandCenterAction, recordMarketingPerformanceAction } from "@/lib/dashboard/actions/marketing";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export const dynamic = "force-dynamic";

const statusTone: Record<string, BadgeTone> = { published: "success", scheduled: "info", approved: "success", review: "warning", rejected: "danger" };
const inputClass = "min-h-11 w-full border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-foreground";

function number(value: number) { return new Intl.NumberFormat("en-CA").format(value); }
function money(value: number) { return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 }).format(value); }

export default async function MarketingCommandCenterPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const db = createDbClient(loadEnv());
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/command-center`);
  let organization;
  try {
    ({ organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId));
  } catch (error) {
    if (error instanceof TenantResourceNotFoundError) notFound();
    throw error;
  }
  const data = await getMarketingCommandCenter(db, { organizationId: organization.id, actorUserId: user.userId });
  const upcoming = data.content.filter((item) => item.status !== "archived").slice(0, 20);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organization.name, href: `/app/${organizationSlug}` }, { label: "Marketing", href: `/app/${organizationSlug}/marketing` }, { label: "Command Center" }]} />
      <PageHeader title="Marketing Command Center" description="One source of truth for LYNQ and CodeItLearn across content, channels, approvals, publishing progress and real performance." />

      {data.accounts.length === 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div><p className="text-sm font-medium text-foreground">Set up your channel board</p><p className="text-sm text-muted">Creates manual tracking rows for both brands across Instagram, Facebook, TikTok, YouTube and paid ads. It does not connect or publish to external accounts.</p></div>
          <ActionForm action={setupMarketingCommandCenterAction.bind(null, organizationSlug)}><SubmitButton pendingLabel="Setting up…">Set up command center</SubmitButton></ActionForm>
        </Card>
      ) : null}

      <section aria-label="Performance overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        {[['Impressions', number(data.totals.impressions)], ['Views', number(data.totals.views)], ['Engagements', number(data.totals.engagement)], ['Clicks', number(data.totals.clicks)], ['Leads', number(data.totals.leads)], ['Conversions', number(data.totals.conversions)], ['Spend', money(data.totals.spend)], ['Revenue', money(data.totals.revenue)]].map(([label, value]) => <Card key={label} padding="sm"><p className="text-[10px] uppercase tracking-[0.13em] text-subtle">{label}</p><p className="mt-1 text-xl text-foreground">{value}</p></Card>)}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg text-foreground">Channel accounts</h2><p className="text-sm text-muted">Manual tracking is live. Connected sync will be added provider by provider—nothing below pretends to be connected.</p></div><Link href={`/app/${organizationSlug}/marketing/content-studio`} className="text-sm text-foreground underline underline-offset-4">Create content →</Link></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.accounts.map((account) => <Card key={account.id} padding="sm" className="flex flex-col gap-2"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-foreground">{account.displayName}</p><Badge tone={account.accountKind === "paid" ? "warning" : "neutral"}>{account.accountKind}</Badge></div><p className="text-xs uppercase tracking-[0.12em] text-subtle">{account.brandName} · {account.platform.replaceAll("_", " ")}</p><p className="text-xs text-muted">{account.connectionStatus === "manual" ? "Manual progress tracking" : account.connectionStatus}</p></Card>)}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between"><h2 className="text-lg text-foreground">Content pipeline</h2><Link href={`/app/${organizationSlug}/marketing/calendar`} className="text-sm text-foreground underline underline-offset-4">Open calendar →</Link></div>
        <div className="flex flex-wrap gap-2">{Object.entries(data.pipeline).map(([status, count]) => <Badge key={status} tone={statusTone[status] ?? "neutral"}>{status}: {count}</Badge>)}</div>
        <div className="overflow-x-auto border border-border">
          <table className="w-full min-w-[840px] text-left text-sm"><thead className="border-b border-border bg-surface text-xs uppercase tracking-[0.12em] text-subtle"><tr><th className="p-3">Brand</th><th className="p-3">Content</th><th className="p-3">Type</th><th className="p-3">Channel</th><th className="p-3">Status</th><th className="p-3">Publish date</th></tr></thead><tbody>{upcoming.map((item) => <tr key={item.id} className="border-b border-border last:border-0"><td className="p-3 text-muted">{item.brandName}</td><td className="p-3"><Link href={`/app/${organizationSlug}/marketing/content/${item.id}`} className="text-foreground underline-offset-4 hover:underline">{item.title}</Link><p className="text-xs text-subtle">{item.campaignName}</p></td><td className="p-3 text-muted">{item.contentType.replaceAll("_", " ")}</td><td className="p-3 text-muted">{item.intendedChannel ?? "Not assigned"}</td><td className="p-3"><Badge tone={statusTone[item.status] ?? "neutral"}>{item.status}</Badge></td><td className="p-3 text-muted">{item.plannedPublishAt ? item.plannedPublishAt.toLocaleString("en-CA") : "Not scheduled"}</td></tr>)}</tbody></table>
          {upcoming.length === 0 ? <p className="p-6 text-sm text-muted">No saved content yet. Create a package in Content Studio, review it, then save it to the pipeline.</p> : null}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="flex flex-col gap-4"><div><h2 className="text-lg text-foreground">Record real results</h2><p className="text-sm text-muted">Replace the Google Sheet with a dated snapshot from each platform. Zero is valid; the Office never invents a number.</p></div>
          {data.accounts.length > 0 && data.content.length > 0 ? <ActionForm action={recordMarketingPerformanceAction.bind(null, organizationSlug)} className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">Content<select name="contentItemId" required className={inputClass}>{data.content.map((item) => <option key={item.id} value={item.id}>{item.brandName} — {item.title}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">Account<select name="channelAccountId" required className={inputClass}>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select></label>
            {["impressions", "reach", "views", "likes", "comments", "shares", "saves", "clicks", "leads", "conversions"].map((name) => <label key={name} className="flex flex-col gap-1 text-xs capitalize text-muted">{name}<input className={inputClass} name={name} type="number" min="0" defaultValue="0" /></label>)}
            <label className="flex flex-col gap-1 text-xs text-muted">Spend<input className={inputClass} name="spendAmount" type="number" min="0" step="0.01" defaultValue="0" /></label><label className="flex flex-col gap-1 text-xs text-muted">Revenue<input className={inputClass} name="revenueAmount" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">Notes<textarea className={`${inputClass} min-h-24 py-3`} name="notes" placeholder="What worked, what changed, or what to test next" /></label><div className="sm:col-span-2"><SubmitButton pendingLabel="Saving results…">Save performance snapshot</SubmitButton></div>
          </ActionForm> : <p className="text-sm text-muted">Set up channel accounts and save at least one content item first.</p>}
        </Card>
        <Card className="flex flex-col gap-4"><div><h2 className="text-lg text-foreground">Recent learning history</h2><p className="text-sm text-muted">Saved results stay attached to the exact content and account so future AI decisions can use evidence, not guesses.</p></div>{data.snapshots.length === 0 ? <p className="text-sm text-muted">No performance snapshots yet.</p> : <ul className="flex flex-col gap-3">{data.snapshots.slice(0, 10).map((row) => <li key={row.id} className="border-b border-border pb-3 last:border-0"><p className="text-sm text-foreground">{row.contentTitle}</p><p className="text-xs text-muted">{row.accountName} · {row.capturedAt.toLocaleString("en-CA")}</p><p className="mt-1 text-xs text-subtle">{number(row.views)} views · {number(row.likes + row.comments + row.shares + row.saves)} engagements · {number(row.clicks)} clicks · {number(row.leads)} leads</p>{row.notes ? <p className="mt-1 text-xs text-muted">{row.notes}</p> : null}</li>)}</ul>}</Card>
      </section>

      <Card className="border-l-4 border-l-lime-300"><h2 className="text-lg text-foreground">Publishing safety</h2><p className="mt-1 text-sm text-muted">Content creation, rendering, scheduling, approval history and results are live. External account connection and auto-publishing remain intentionally off. A human must approve every item before any future provider integration can publish it.</p></Card>
    </div>
  );
}

