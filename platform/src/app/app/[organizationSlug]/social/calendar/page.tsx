import Link from "next/link";
import { listBrands } from "@/lib/social-os/brands";
import { getInstagramGridPreview, getSocialCalendar, type InstagramGridTile } from "@/lib/social-os/calendar";
import { assetPreviewPath } from "@/lib/social-os/assets";
import { currentWeekPlan, getWeekPlanStatus, type WeekPlanEntryStatus } from "@/lib/social-os/week-plans";
import { zonedDateTimeToUtc } from "@/lib/social-os/studio";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import { hasMarketingCapability, resolveMarketingAuthContext } from "@/lib/marketing-os/authz";
import { SOCIAL_CALENDAR_STATES, SOCIAL_ORGANIC_PLATFORMS, SOCIAL_PLATFORM_LABELS, socialOrganicPlatformSchema } from "@/lib/social-os/validation";
import { decideVariantApprovalAction, loadWeekPlanAction, rescheduleSocialVariantAction } from "@/lib/dashboard/actions/social";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { StatusMessage } from "@/components/dashboard/StatusMessage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { SocialBrandSwitcher } from "@/components/social/SocialBrandSwitcher";
import { SocialCalendarGrid, type CalendarDay, type CalendarEntryView, type CalendarGapView } from "@/components/social/SocialCalendarGrid";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { firstParam, resolveBrandSelection } from "@/components/social/brand-selection";
import { PLATFORM_GLYPH, PLATFORM_SHORT_LABEL, VARIANT_STATUS_LABEL, VARIANT_STATUS_TONE, formatDateTime, formatTime, localDayKey, socialHref } from "@/components/social/format";

export const dynamic = "force-dynamic";
// Loading a week plan generates its images in the background after the redirect.
export const maxDuration = 300;

type View = "day" | "week" | "month";
const DAY_MS = 86_400_000;
const MOVABLE = ["idea", "draft", "ready_for_review", "approved", "scheduled"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Pure date math on "calendar dates" (UTC midnight stands for a local date). */
function parseKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function keyOf(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}
function mondayOf(t: number): number {
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return t - dow * DAY_MS;
}

export default async function SocialCalendarPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ brand?: string; view?: string; from?: string; platform?: string; notice?: string }> }) {
  const { organizationSlug } = await params;
  const sp = await searchParams;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/calendar`);
  const view: View = sp.view === "day" || sp.view === "month" ? sp.view : "week";
  const platform = socialOrganicPlatformSchema.safeParse(firstParam(sp.platform));

  let data;
  try {
    const [brands, timeZone] = await Promise.all([listBrands(db, { organizationId: organization.id, actorUserId: user.userId }), getSocialTimezone(db, organization.id)]);
    const selection = resolveBrandSelection(brands, sp.brand, true);
    const todayKey = localDayKey(new Date(), timeZone);
    const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? parseKey(sp.from!) : parseKey(todayKey);
    let start: number;
    let count: number;
    let monthIndex = new Date(anchor).getUTCMonth();
    if (view === "day") {
      start = anchor;
      count = 1;
    } else if (view === "week") {
      start = mondayOf(anchor);
      count = 7;
    } else {
      const first = Date.UTC(new Date(anchor).getUTCFullYear(), new Date(anchor).getUTCMonth(), 1);
      monthIndex = new Date(first).getUTCMonth();
      const lastDay = Date.UTC(new Date(first).getUTCFullYear(), monthIndex + 1, 0);
      start = mondayOf(first);
      const end = mondayOf(lastDay) + 7 * DAY_MS;
      count = Math.round((end - start) / DAY_MS);
    }
    const toUtc = (t: number) => {
      const d = new Date(t);
      return zonedDateTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, timeZone);
    };
    const plan = currentWeekPlan();
    const gridBrands = brands.filter((b) => !b.archivedAt && (!selection.brandProfileId || b.id === selection.brandProfileId)).slice(0, 3);
    const [calendar, ctx, planStatus, grids] = await Promise.all([
      getSocialCalendar(db, { organizationId: organization.id, actorUserId: user.userId, from: toUtc(start), to: toUtc(start + count * DAY_MS), view, timeZone, brandProfileId: selection.brandProfileId, platform: platform.success ? platform.data : undefined }),
      resolveMarketingAuthContext(db, { organizationId: organization.id, actorUserId: user.userId }),
      plan ? getWeekPlanStatus(db, { organizationId: organization.id, actorUserId: user.userId, planKey: plan.key }) : Promise.resolve(null),
      Promise.all(gridBrands.map(async (b) => ({ id: b.id, name: b.name, tiles: await getInstagramGridPreview(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId: b.id, limit: 12 }).catch(() => [] as InstagramGridTile[]) }))),
    ]);
    data = { brands, selection, timeZone, todayKey, anchor, start, count, monthIndex, calendar, ctx, plan, planStatus, grids };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "Content Calendar" });
  }
  const { brands, selection, timeZone, todayKey, anchor, start, count, monthIndex, calendar, ctx, plan, planStatus, grids } = data;
  const brandParam = selection.brandParam;
  const platformParam = platform.success ? platform.data : undefined;
  const href = (path: string, extra: Record<string, string | undefined> = {}) => socialHref(organizationSlug, path, { brand: brandParam, ...extra });
  const calHref = (v: View, from: string) => href("/social/calendar", { view: v, from, platform: platformParam });

  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  const days: CalendarDay[] = Array.from({ length: count }, (_, i) => {
    const t = start + i * DAY_MS;
    const key = keyOf(t);
    return { key, weekday: WEEKDAYS[(new Date(t).getUTCDay() + 6) % 7], dayNumber: new Date(t).getUTCDate(), label: dayFmt.format(new Date(t)), inMonth: view !== "month" || new Date(t).getUTCMonth() === monthIndex, isToday: key === todayKey, isPast: key < todayKey };
  });

  const entries: CalendarEntryView[] = calendar.entries.map((e) => {
    const at = e.publishedAt ?? e.scheduledFor ?? new Date(e.date);
    return {
      variantId: e.variantId,
      contentItemId: e.contentItemId,
      title: e.title,
      platform: e.platform,
      platformLabel: PLATFORM_SHORT_LABEL[e.platform] ?? e.platform,
      glyph: PLATFORM_GLYPH[e.platform] ?? "?",
      status: e.status,
      statusLabel: VARIANT_STATUS_LABEL[e.status] ?? e.status,
      tone: VARIANT_STATUS_TONE[e.status] ?? "neutral",
      dayKey: localDayKey(at, timeZone),
      timeLabel: formatTime(at, timeZone),
      originalAt: at.toISOString(),
      revision: e.revision,
      movable: MOVABLE.includes(e.status),
      pendingApproval: e.status === "ready_for_review",
      warningsCount: e.warningsCount,
      blocking: e.blocking,
      brandName: selection.brandProfileId ? null : e.brandName,
      accountDisplayName: e.accountDisplayName,
      href: href(`/social/library/${e.contentItemId}`, { variant: e.variantId }),
    };
  });

  const gaps: Record<string, CalendarGapView[]> = {};
  for (const g of calendar.gaps) {
    (gaps[g.date] ??= []).push({ platform: g.platform, platformLabel: PLATFORM_SHORT_LABEL[g.platform] ?? g.platform, createHref: href("/social/create", { platform: g.platform, date: g.date, brand: selection.brandProfileId ?? brandParam }) });
  }

  const step = view === "day" ? 1 : view === "week" ? 7 : 0;
  const prevKey = view === "month" ? keyOf(Date.UTC(new Date(anchor).getUTCFullYear(), monthIndex - 1, 1)) : keyOf(start - step * DAY_MS);
  const nextKey = view === "month" ? keyOf(Date.UTC(new Date(anchor).getUTCFullYear(), monthIndex + 1, 1)) : keyOf(start + step * DAY_MS);
  const rangeLabel =
    view === "month"
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(new Date(anchor).getUTCFullYear(), monthIndex, 1)))
      : view === "week"
        ? `${dayFmt.format(new Date(start))} – ${dayFmt.format(new Date(start + 6 * DAY_MS))}`
        : dayFmt.format(new Date(start));
  const notice = /^planned_(\d+)$/.exec(firstParam(sp.notice) ?? "");
  const planNotice = /^weekplan_(\d+)_(\d+)$/.exec(firstParam(sp.notice) ?? "");
  const canApprove = hasMarketingCapability(ctx, "marketing_approve_content");
  const legendStates = SOCIAL_CALENDAR_STATES.filter((s) => s !== "generating");
  const navLink = "lynq-transition inline-flex min-h-11 items-center justify-center rounded-sm border border-border px-3 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong";

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "Calendar" }])} />
      <PageHeader
        title="Content Calendar"
        description={`Every planned, scheduled and published post. Times in ${timeZone}.`}
        actions={<SocialBrandSwitcher brands={brands.map((b) => ({ id: b.id, name: b.name }))} selectedBrandId={selection.selectedBrandId} />}
      />

      {planNotice ? <StatusMessage tone="success" message={`Week plan loaded: ${planNotice[1]} posts, stories and reels are on the calendar as drafts${planNotice[2] !== "0" ? ` — ${planNotice[2]} need something from you (below)` : ""}. New images are being made now; refresh in a few minutes. Each morning at 8, that day's posts are sent to your Telegram to approve.`} /> : null}

      {plan && planStatus ? <WeekPlanPanel planLabel={plan.label} planKey={plan.key} status={planStatus.entries} loaded={planStatus.loaded} action={loadWeekPlanAction.bind(null, organizationSlug)} timeZone={timeZone} itemHref={(id) => href(`/social/library/${id}`)} /> : null}

      {grids.length ? <InstagramGridPanel grids={grids.map((g) => ({ ...g, tiles: g.tiles.map((t) => ({ ...t, imageUrl: t.imageAssetId ? assetPreviewPath(organization.id, t.imageAssetId) : null, href: href(`/social/library/${t.contentItemId}`, { variant: t.variantId }), when: t.at ? formatDateTime(t.at, timeZone) : "" })) }))} /> : null}

      {notice ? <StatusMessage tone="success" message={`Drafted ${notice[1]} post${notice[1] === "1" ? "" : "s"} for next week. Review them, then submit for approval — nothing was scheduled.`} /> : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={calHref(view, prevKey)} className={navLink} aria-label="Previous">←</Link>
          <Link href={calHref(view, todayKey)} className={navLink}>Today</Link>
          <Link href={calHref(view, nextKey)} className={navLink} aria-label="Next">→</Link>
          <h2 className="ml-1 text-sm text-foreground" aria-live="polite">{rangeLabel}</h2>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <nav aria-label="Calendar view" className="flex rounded-sm border border-border">
            {(["day", "week", "month"] as const).map((v) => (
              <Link key={v} href={calHref(v, keyOf(anchor))} aria-current={v === view ? "page" : undefined} className={`lynq-transition inline-flex min-h-11 flex-1 items-center justify-center px-4 text-xs font-medium uppercase tracking-[0.08em] ${v === view ? "bg-glass-strong text-foreground" : "text-subtle hover:text-foreground"}`}>{v}</Link>
            ))}
          </nav>
          <form method="get" className="flex items-end gap-2">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="from" value={keyOf(anchor)} />
            {brandParam ? <input type="hidden" name="brand" value={brandParam} /> : null}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-[0.1em] text-subtle">Platform</span>
              <select name="platform" defaultValue={platformParam ?? ""} className="lynq-transition min-h-11 rounded-sm border border-border bg-elevated px-3 py-2 text-sm text-foreground hover:border-border-strong">
                <option value="">All platforms</option>
                {SOCIAL_ORGANIC_PLATFORMS.map((p) => <option key={p} value={p}>{SOCIAL_PLATFORM_LABELS[p]}</option>)}
              </select>
            </label>
            <button type="submit" className="lynq-glass lynq-transition min-h-11 rounded-sm px-4 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong">Apply</button>
          </form>
        </div>
      </div>

      <SocialCalendarGrid
        view={view}
        days={days}
        entries={entries}
        gaps={gaps}
        reschedule={rescheduleSocialVariantAction.bind(null, organizationSlug)}
        approve={decideVariantApprovalAction.bind(null, organizationSlug)}
        canApprove={canApprove}
      />

      <section aria-labelledby="calendar-legend" className="flex flex-col gap-2">
        <h2 id="calendar-legend" className="text-xs uppercase tracking-[0.1em] text-subtle">States</h2>
        <ul className="flex flex-wrap gap-2">
          {legendStates.map((s) => (
            <li key={s}><Badge tone={VARIANT_STATUS_TONE[s] ?? "neutral"}>{VARIANT_STATUS_LABEL[s] ?? s}{calendar.countsByStatus[s] ? ` · ${calendar.countsByStatus[s]}` : ""}</Badge></li>
          ))}
          <li className="inline-flex min-h-6 items-center rounded-sm border border-dashed border-border px-2 text-[0.65rem] uppercase tracking-[0.08em] text-subtle">No approved post</li>
        </ul>
      </section>

      <section aria-labelledby="calendar-undated" className="flex flex-col gap-3">
        <h2 id="calendar-undated" className="text-xs uppercase tracking-[0.1em] text-subtle">Not on the calendar yet</h2>
        {calendar.undated.length === 0 ? (
          <p className="text-sm text-subtle">Every draft has a date.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {calendar.undated.map((e) => (
              <li key={e.variantId}>
                <Link href={href(`/social/library/${e.contentItemId}`, { variant: e.variantId })} className="lynq-transition flex min-h-11 flex-col gap-1 px-4 py-3 hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-foreground">{e.title}</span>
                    <span className="text-xs text-subtle">{PLATFORM_SHORT_LABEL[e.platform]}{e.brandName ? ` · ${e.brandName}` : ""} · created {formatDateTime(e.date, timeZone)}</span>
                  </span>
                  <Badge tone={VARIANT_STATUS_TONE[e.status] ?? "neutral"}>{VARIANT_STATUS_LABEL[e.status] ?? e.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const NEEDS_LABEL: Record<NonNullable<WeekPlanEntryStatus["needs"]>, string> = { video: "Film & upload video", photo: "Upload a real photo", image: "Image being made", account: "Link account" };
const KIND_LABEL: Record<WeekPlanEntryStatus["kind"], string> = { post: "Post", story: "Story", reel: "Reel" };

function WeekPlanPanel({ planLabel, planKey, status, loaded, action, timeZone, itemHref }: { planLabel: string; planKey: string; status: WeekPlanEntryStatus[]; loaded: boolean; action: (formData: FormData) => Promise<unknown>; timeZone: string; itemHref: (id: string) => string }) {
  const days = [...new Set(status.map((e) => e.day))];
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  const label = (day: string) => { const [y, m, d] = day.split("-").map(Number); return dayFmt.format(new Date(Date.UTC(y, m - 1, d))); };
  const open = status.filter((e) => e.needs && e.needs !== "image").length;
  return (
    <section aria-labelledby="week-plan" className="flex flex-col gap-4 rounded-md border border-border p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="week-plan" className="text-xs uppercase tracking-[0.1em] text-subtle">Week plan</h2>
          <p className="text-sm text-foreground">{planLabel}</p>
          <p className="text-xs text-subtle">{loaded ? `On the calendar.${open ? ` ${open} thing${open === 1 ? "" : "s"} need you.` : ""} Each morning at 8 (${timeZone}) that day's posts go to your Telegram.` : "Feed posts, stories (with their highlight) and reels for every brand, one click. Nothing posts until you approve it."}</p>
        </div>
        <form action={action as unknown as (fd: FormData) => void}>
          <input type="hidden" name="planKey" value={planKey} />
          <button type="submit" className="lynq-glass lynq-transition min-h-11 rounded-sm px-4 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong">{loaded ? "Re-load plan" : "Load week plan"}</button>
        </form>
      </div>
      {loaded ? (
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {days.map((day) => (
            <li key={day} className="flex flex-col gap-2 rounded-sm border border-border p-3">
              <span className="text-xs uppercase tracking-[0.08em] text-subtle">{label(day)}</span>
              <ul className="flex flex-col gap-1.5">
                {status.filter((e) => e.day === day).map((e) => {
                  const body = (
                    <span className="flex flex-col">
                      <span className="text-xs text-foreground">{e.time} · {e.brand} · {KIND_LABEL[e.kind]}{e.pillar ? ` · ${e.pillar}` : ""}{e.highlight ? ` → ${e.highlight}` : ""}</span>
                      <span className="truncate text-xs text-subtle">{e.title}</span>
                      <span className="text-[0.65rem] uppercase tracking-[0.08em]">{e.needs ? <span className="text-amber-300">{NEEDS_LABEL[e.needs]}</span> : <span className="text-subtle">{VARIANT_STATUS_LABEL[e.status ?? ""] ?? (e.status ? e.status : "Not loaded")}</span>}</span>
                    </span>
                  );
                  return <li key={e.key}>{e.contentItemId ? <Link href={itemHref(e.contentItemId)} className="lynq-transition block rounded-sm px-1 py-0.5 hover:bg-white/[0.03]">{body}</Link> : body}</li>;
                })}
              </ul>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

type GridTileView = InstagramGridTile & { imageUrl: string | null; href: string; when: string };

function InstagramGridPanel({ grids }: { grids: { id: string; name: string; tiles: GridTileView[] }[] }) {
  return (
    <section aria-labelledby="ig-grid" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="ig-grid" className="text-xs uppercase tracking-[0.1em] text-subtle">Instagram grid preview</h2>
        <p className="text-xs text-subtle">Newest first, the way your profile will read. Planned posts sit on top of what&apos;s already live; reels stay off the grid. Read it in rows of three.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {grids.map((g) => (
          <div key={g.id} className="flex flex-col gap-2">
            <span className="text-sm text-foreground">{g.name}</span>
            {g.tiles.length === 0 ? (
              <p className="text-xs text-subtle">No dated Instagram feed posts yet.</p>
            ) : (
              <ul className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-sm bg-black">
                {g.tiles.map((t) => (
                  <li key={t.variantId} className="relative aspect-[3/4] bg-elevated">
                    <Link href={t.href} className="group block h-full w-full" title={`${t.title} · ${t.when}`}>
                      {t.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- private asset streamed from the authenticated assets API; no image loader applies.
                        <img src={t.imageUrl} alt={t.title} loading="lazy" decoding="async" className={`h-full w-full object-cover ${t.published ? "" : "opacity-90"}`} />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center p-2 text-center text-[0.65rem] text-subtle">{t.title}</span>
                      )}
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4 text-[0.6rem] leading-tight text-white">{t.published ? "Live" : t.when}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
