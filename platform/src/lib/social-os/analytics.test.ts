import { describe, it, expect } from "vitest";
import { computeOrganicVsPaid, engagementRate, groupPosts, pickDisjointPeriods, postCountersFromSnapshot, sumNullable, topPostsOf, type AnalyticsPost } from "./analytics";
import { accountSnapshotValues, providedPostCounters } from "./analytics-sync";

const D = (iso: string) => new Date(iso);

function post(overrides: Partial<AnalyticsPost>): AnalyticsPost {
  return {
    variantId: "v",
    contentItemId: "i",
    title: "t",
    platform: "instagram",
    format: "image",
    campaignId: "c1",
    campaignName: "Always on",
    channelAccountId: "a1",
    publishedAt: D("2026-09-01T00:00:00Z"),
    externalPostUrl: null,
    impressions: null,
    reach: null,
    views: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    clicks: null,
    engagements: null,
    engagementRate: null,
    source: null,
    capturedAt: null,
    ...overrides,
  };
}

describe("analytics aggregation (null-safe)", () => {
  it("sumNullable distinguishes no data (null) from zero", () => {
    expect(sumNullable([])).toBeNull();
    expect(sumNullable([null, undefined])).toBeNull();
    expect(sumNullable([0, null])).toBe(0);
    expect(sumNullable([2, 3, null])).toBe(5);
  });

  it("engagementRate is null when reach is 0 or absent, or no interaction counter is known", () => {
    expect(engagementRate({ likes: 5, comments: 1, shares: 0, saves: 0, reach: 0 })).toBeNull();
    expect(engagementRate({ likes: 5, comments: 1, shares: 0, saves: 0, reach: null })).toBeNull();
    expect(engagementRate({ likes: null, comments: null, shares: null, saves: null, reach: 100 })).toBeNull();
    expect(engagementRate({ likes: 8, comments: 2, shares: null, saves: null, reach: 100 })).toBe(0.1);
  });

  it("synced snapshots expose only provider-returned counters; manual snapshots expose all", () => {
    const synced = postCountersFromSnapshot({ source: "synced:meta", impressions: 0, reach: 120, views: 0, likes: 9, comments: 0, shares: 0, saves: 0, clicks: 0, extraMetrics: { provided: { reach: 120, likes: 9 }, raw: {} } });
    expect(synced).toEqual({ impressions: null, reach: 120, views: null, likes: 9, comments: null, shares: null, saves: null, clicks: null });
    const manual = postCountersFromSnapshot({ source: "manual", impressions: 0, reach: 50, views: 0, likes: 1, comments: 0, shares: 0, saves: 0, clicks: 2, extraMetrics: {} });
    expect(manual.impressions).toBe(0);
    expect(manual.clicks).toBe(2);
  });

  it("the sync helpers keep missing provider fields absent/null", () => {
    expect(providedPostCounters({ externalPostId: "p", reach: 10.4, likes: 3, extra: { foo: 1 } })).toEqual({ reach: 10, likes: 3 });
    const values = accountSnapshotValues({ periodStart: D("2026-09-01T00:00:00Z"), periodEnd: D("2026-09-29T00:00:00Z"), followers: 1200, views: 5000, extra: { views: 5000 } });
    expect(values).toMatchObject({ followers: 1200, views: 5000, reach: null, impressions: null, engagements: null, profileViews: null, websiteClicks: null });
  });

  it("only non-overlapping rolling windows are summed", () => {
    const snaps = [
      { periodStart: D("2026-09-01T00:00:00Z"), periodEnd: D("2026-09-29T00:00:00Z"), capturedAt: D("2026-09-29T01:00:00Z"), reach: 100 },
      { periodStart: D("2026-08-31T00:00:00Z"), periodEnd: D("2026-09-28T00:00:00Z"), capturedAt: D("2026-09-28T01:00:00Z"), reach: 95 },
      { periodStart: D("2026-08-04T00:00:00Z"), periodEnd: D("2026-09-01T00:00:00Z"), capturedAt: D("2026-09-01T01:00:00Z"), reach: 80 },
    ];
    const picked = pickDisjointPeriods(snaps, D("2026-08-01T00:00:00Z"));
    expect(picked.map((s) => s.reach)).toEqual([100, 80]);
  });

  it("groups posts with null-safe sums and counts posts without data", () => {
    const posts = [
      post({ variantId: "a", platform: "instagram", reach: 100, likes: 10, engagements: 10, engagementRate: 0.1, source: "synced" }),
      post({ variantId: "b", platform: "instagram" }),
      post({ variantId: "c", platform: "linkedin", impressions: 40, source: "manual" }),
    ];
    const byPlatform = groupPosts(posts, (p) => ({ key: p.platform, label: p.platform }));
    const ig = byPlatform.find((g) => g.key === "instagram")!;
    expect(ig).toMatchObject({ posts: 2, postsWithData: 1, reach: 100, impressions: null, avgEngagementRate: 0.1 });
    const li = byPlatform.find((g) => g.key === "linkedin")!;
    expect(li).toMatchObject({ posts: 1, reach: null, impressions: 40, avgEngagementRate: null });
  });

  it("top posts rank by engagement rate then reach and exclude posts without a rate", () => {
    const posts = [post({ variantId: "a", engagementRate: 0.05, reach: 1000 }), post({ variantId: "b", engagementRate: 0.1, reach: 10 }), post({ variantId: "c", engagementRate: 0.05, reach: 2000 }), post({ variantId: "d" })];
    expect(topPostsOf(posts).map((p) => p.variantId)).toEqual(["b", "c", "a"]);
  });

  it("organic vs paid stays null when a side has no data", () => {
    expect(computeOrganicVsPaid({ organicAccounts: [], paidCampaigns: [] })).toEqual({ organicReach: null, paidReach: null, organicEngagements: null, paidClicks: null });
    expect(computeOrganicVsPaid({ organicAccounts: [{ reach: 500, engagements: null }], paidCampaigns: [{ reach: 2000, clicks: 30 }, { reach: null, clicks: 5 }] })).toEqual({ organicReach: 500, paidReach: 2000, organicEngagements: null, paidClicks: 35 });
  });
});
