import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { marketingChannelAccounts, marketingContentPerformanceSnapshots, runtimeJobs, socialAccountMetricSnapshots, socialAdCampaignSnapshots, socialContentVariants } from "@/db/schema";
import { InsufficientRoleError, TenantResourceNotFoundError } from "@/lib/authz/errors";
import { db, makeSocialOrg, makeConnectedAccount, makeMarketingUser, cleanupAgentRuntimeTestData, fakeFetch } from "./test-helpers";
import { createContentItem } from "./content";
import { requestMetricsSync, syncAccountMetrics } from "./analytics-sync";
import { getSocialAnalytics } from "./analytics";
import { SocialProviderError } from "./errors";
import { socialContentBriefSchema } from "./validation";

const META_ENV = { META_APP_ID: "test-app", META_APP_SECRET: "test-app-secret", META_GRAPH_API_VERSION: "v25.0" };

async function publishedVariant(orgId: string, ownerId: string, brandId: string, accountId: string, externalPostId: string) {
  const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brandId, title: "Synced post", brief: socialContentBriefSchema.parse({ kind: "image_post" }), platforms: ["instagram"] });
  const [variant] = await db
    .update(socialContentVariants)
    .set({ status: "published", channelAccountId: accountId, externalPostId, externalPostUrl: `https://instagram.test/p/${externalPostId}`, publishedAt: new Date(Date.now() - 2 * 24 * 3600_000), format: "image" })
    .where(eq(socialContentVariants.id, item.variants[0].id))
    .returning();
  return { item, variant };
}

function instagramGraph(igId: string, postId: string) {
  return fakeFetch([
    { match: (u) => u.includes(`/${igId}/insights`), respond: () => ({ json: { data: [{ name: "reach", total_value: { value: 500 } }, { name: "views", total_value: { value: 1200 } }] } }) },
    { match: (u) => u.includes(`/${igId}?`) && u.includes("followers_count"), respond: () => ({ json: { followers_count: 321, id: igId } }) },
    { match: (u) => u.includes(`/${postId}/insights`), respond: () => ({ json: { data: [{ name: "reach", values: [{ value: 100 }] }, { name: "likes", values: [{ value: 7 }] }] } }) },
  ]);
}

describe("analytics sync (integration)", () => {
  afterEach(cleanupAgentRuntimeTestData);

  it("writes only provider-returned fields and upserts the account snapshot on a second sync", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const igId = `ig${Math.random().toString(36).slice(2, 8)}`;
    const postId = `media${Math.random().toString(36).slice(2, 8)}`;
    const { account } = await makeConnectedAccount(orgId, brand.id, "instagram", { externalAccountId: igId });
    const { variant } = await publishedVariant(orgId, ownerId, brand.id, account.id, postId);
    const { fetchImpl } = instagramGraph(igId, postId);

    const result = await syncAccountMetrics(db, { organizationId: orgId, channelAccountId: account.id, deps: { fetchImpl, env: META_ENV } });
    expect(result).toEqual({ accountMetrics: true, postSnapshots: 1, adCampaigns: 0 });

    const accountSnaps = await db.select().from(socialAccountMetricSnapshots).where(eq(socialAccountMetricSnapshots.channelAccountId, account.id));
    expect(accountSnaps).toHaveLength(1);
    expect(accountSnaps[0]).toMatchObject({ source: "synced:meta", followers: 321, reach: 500, views: 1200, impressions: null, engagements: null, websiteClicks: null });

    const postSnaps = await db.select().from(marketingContentPerformanceSnapshots).where(eq(marketingContentPerformanceSnapshots.contentVariantId, variant.id));
    expect(postSnaps).toHaveLength(1);
    expect(postSnaps[0]).toMatchObject({ source: "synced:meta", externalPostId: postId, reach: 100, likes: 7, impressions: 0, recordedByUserId: null });
    expect((postSnaps[0].extraMetrics as { provided: Record<string, number> }).provided).toEqual({ reach: 100, likes: 7 });

    const [after] = await db.select().from(marketingChannelAccounts).where(eq(marketingChannelAccounts.id, account.id));
    expect(after.lastSyncAt).not.toBeNull();

    // Second sync the same day: the account period is upserted, not duplicated.
    await syncAccountMetrics(db, { organizationId: orgId, channelAccountId: account.id, deps: { fetchImpl, env: META_ENV } });
    expect(await db.select().from(socialAccountMetricSnapshots).where(eq(socialAccountMetricSnapshots.channelAccountId, account.id))).toHaveLength(1);

    // The read model shows synced numbers and null (not 0) for what Meta did not return.
    const analytics = await getSocialAnalytics(db, { organizationId: orgId, actorUserId: ownerId });
    const post = analytics.posts.find((p) => p.variantId === variant.id)!;
    expect(post).toMatchObject({ reach: 100, likes: 7, impressions: null, comments: null, source: "synced", engagementRate: 0.07 });
    const acct = analytics.accounts.find((a) => a.accountId === account.id)!;
    expect(acct).toMatchObject({ followers: 321, reach: 500, impressions: null, followersChange: null });
    expect(analytics.dataNotes.join(" ")).toMatch(/Instagram impressions are no longer provided/);
    expect(analytics.paid).toBeNull();
  });

  it("records ad campaign snapshots for an ad account", async () => {
    const { orgId, brand } = await makeSocialOrg();
    const actId = `${Math.floor(Math.random() * 1e9)}`;
    const { account } = await makeConnectedAccount(orgId, brand.id, "meta_ads", { externalAccountId: `act_${actId}` });
    const { fetchImpl } = fakeFetch([
      { match: (u) => u.includes(`/act_${actId}?`) && u.includes("currency"), respond: () => ({ json: { currency: "CAD" } }) },
      { match: (u) => u.includes(`/act_${actId}/campaigns`), respond: () => ({ json: { data: [{ id: "c1", name: "Fall leads", status: "ACTIVE", objective: "OUTCOME_LEADS", daily_budget: "2000" }] } }) },
      { match: (u) => u.includes(`/act_${actId}/insights`), respond: () => ({ json: { data: [{ campaign_id: "c1", spend: "45.50", impressions: "12000", clicks: "240", ctr: "2.0" }] } }) },
    ]);
    const result = await syncAccountMetrics(db, { organizationId: orgId, channelAccountId: account.id, deps: { fetchImpl, env: META_ENV } });
    expect(result).toEqual({ accountMetrics: false, postSnapshots: 0, adCampaigns: 1 });
    await syncAccountMetrics(db, { organizationId: orgId, channelAccountId: account.id, deps: { fetchImpl, env: META_ENV } });
    const snaps = await db.select().from(socialAdCampaignSnapshots).where(eq(socialAdCampaignSnapshots.channelAccountId, account.id));
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ externalCampaignId: "c1", spendMinor: 4550, impressions: 12000, clicks: 240, reach: null, conversions: null, currency: "CAD", dailyBudgetMinor: 2000 });
  });

  it("marks the account when the provider reports a lost authorization, and rethrows", async () => {
    const { orgId, brand } = await makeSocialOrg();
    const igId = `ig${Math.random().toString(36).slice(2, 8)}`;
    const { account } = await makeConnectedAccount(orgId, brand.id, "instagram", { externalAccountId: igId });
    const { fetchImpl } = fakeFetch([{ match: () => true, respond: () => ({ status: 401, json: { error: { message: "Error validating access token: Session has expired", type: "OAuthException", code: 190 } } }) }]);
    await expect(syncAccountMetrics(db, { organizationId: orgId, channelAccountId: account.id, deps: { fetchImpl, env: META_ENV } })).rejects.toBeInstanceOf(SocialProviderError);
    const [row] = await db.select().from(marketingChannelAccounts).where(eq(marketingChannelAccounts.id, account.id));
    expect(row.connectionStatus).toBe("token_expired");
    expect(row.lastErrorCode).toBe("meta_190");
    expect(await db.select().from(socialAccountMetricSnapshots).where(eq(socialAccountMetricSnapshots.channelAccountId, account.id))).toHaveLength(0);
  });

  it("requestMetricsSync enqueues one job, denies viewers, and 404s cross-tenant", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const { account } = await makeConnectedAccount(orgId, brand.id, "facebook");
    const first = await requestMetricsSync(db, { organizationId: orgId, channelAccountId: account.id, actorUserId: ownerId });
    const second = await requestMetricsSync(db, { organizationId: orgId, channelAccountId: account.id, actorUserId: ownerId });
    expect(second.jobId).toBe(first.jobId);
    const jobs = await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.organizationId, orgId), eq(runtimeJobs.idempotencyKey, `social_metrics_sync:${account.id}`)));
    expect(jobs).toHaveLength(1);

    const viewer = await makeMarketingUser(orgId, "viewer", ownerId);
    await expect(requestMetricsSync(db, { organizationId: orgId, channelAccountId: account.id, actorUserId: viewer })).rejects.toBeInstanceOf(InsufficientRoleError);

    const other = await makeSocialOrg();
    await expect(requestMetricsSync(db, { organizationId: other.orgId, channelAccountId: account.id, actorUserId: other.ownerId })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});
