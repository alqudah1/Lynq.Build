import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { agentApprovalRequests, marketingContentItems, socialContentVariants, socialEngagementItems, socialPublishJobs } from "@/db/schema";
import { decideFounderApproval, listFounderApprovals } from "@/lib/founder-os/approval-center";
import { db, makeSocialOrg, makeConnectedAccount, makeMarketingUser, cleanupAgentRuntimeTestData, fakeFetch } from "./test-helpers";
import { createContentItem, decideVariantApproval, getVariantForUser, submitVariantForReview, updateVariant } from "./content";
import { cancelPublishJob, processPublishJob, retryPublishJob } from "./publishing";
import { rescheduleVariant } from "./calendar";
import { getBrandForUser, updateBrand } from "./brands";
import { createExternalAsset, getAssetForUser, archiveAsset } from "./assets";
import { sendReply } from "./engagement";
import { listConnectionsForUser, storeConnectionCredential, getConnectionForUser } from "@/lib/communications-os/connections";
import { InsufficientRoleError, TenantResourceNotFoundError } from "@/lib/authz/errors";
import { decideAdChange, proposeAdChange, submitAdChangeForApproval } from "./advertising";
import { enqueuePublish } from "./publishing";
import { resolveSocialAccountCredential } from "./connections";
import { SocialProviderError, StaleSocialUpdateError } from "./errors";
import { classifySocialJobError } from "./worker";
import { socialContentBriefSchema } from "./validation";

/**
 * Regression tests for the Module 19 adversarial audit. Each test first
 * reproduced a defect (duplicate public post, approval of content nobody
 * reviewed) and now pins the fix.
 */

const META_ENV = { META_APP_ID: "test-app", META_APP_SECRET: "test-app-secret", META_GRAPH_API_VERSION: "v25.0" };
const brief = socialContentBriefSchema.parse({ topic: "Audit", callToAction: "Book a call" });

async function approvedScheduledFacebookVariant() {
  const { orgId, ownerId, brand } = await makeSocialOrg();
  const externalAccountId = `page${Math.random().toString(36).slice(2, 8)}`;
  const { account } = await makeConnectedAccount(orgId, brand.id, "facebook", { externalAccountId });
  const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Publish once", brief, platforms: ["facebook"] });
  let v = await updateVariant(db, { organizationId: orgId, contentVariantId: item.variants[0].id, actorUserId: ownerId, expectedRevision: item.variants[0].revision, changes: { body: "Exactly once" } });
  v = await submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision });
  const when = new Date(Date.now() + 24 * 3600_000);
  v = await decideVariantApproval(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision, decision: "approve", scheduledFor: when });
  const [job] = await db.select().from(socialPublishJobs).where(eq(socialPublishJobs.contentVariantId, v.id));
  return { orgId, ownerId, account, externalAccountId, variant: v, job, when };
}

async function jobRow(id: string) {
  const [row] = await db.select().from(socialPublishJobs).where(eq(socialPublishJobs.id, id));
  return row;
}

describe("Module 19 audit regressions (integration)", () => {
  afterEach(cleanupAgentRuntimeTestData);

  it("a worker that dies mid provider call is never re-delivered into a second public post", async () => {
    const s = await approvedScheduledFacebookVariant();
    let feedPosts = 0;
    let reachedProvider!: () => void;
    const providerReached = new Promise<void>((resolve) => (reachedProvider = resolve));
    // Attempt 1: the platform receives the post, but the worker never sees the response (crash / timeout / lease loss).
    const hanging = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "POST" && String(url).endsWith(`/${s.externalAccountId}/feed`)) {
        feedPosts++;
        reachedProvider();
        return new Promise<Response>(() => undefined);
      }
      return new Response(JSON.stringify({ error: { message: "unexpected" } }), { status: 599 });
    };
    void processPublishJob(db, { organizationId: s.orgId, publishJobId: s.job.id, deps: { fetchImpl: hanging, env: META_ENV, now: () => s.when } });
    await providerReached;
    expect((await jobRow(s.job.id)).status).toBe("processing");

    // The runtime reclaims the expired lease and re-delivers the job.
    const { fetchImpl, calls } = fakeFetch([{ match: (u, i) => i?.method === "POST" && u.endsWith(`/${s.externalAccountId}/feed`), respond: () => ({ json: { id: `${s.externalAccountId}_2` } }) }]);
    const err = await processPublishJob(db, { organizationId: s.orgId, publishJobId: s.job.id, deps: { fetchImpl, env: META_ENV, now: () => s.when } }).catch((e) => e);
    expect(calls).toHaveLength(0);
    expect(feedPosts).toBe(1);
    expect(err).toBeInstanceOf(SocialProviderError);
    expect((err as SocialProviderError).code).toBe("publish_outcome_unknown");
    expect(classifySocialJobError(err)).toMatchObject({ failureClass: "unsafe_uncertain", requiresHumanReview: true });
    expect(await jobRow(s.job.id)).toMatchObject({ status: "failed", lastErrorCode: "publish_outcome_unknown" });
    const [variant] = await db.select().from(socialContentVariants).where(eq(socialContentVariants.id, s.variant.id));
    expect(variant.status).toBe("failed");
  });

  it("a crash before the provider was contacted still resumes normally", async () => {
    const s = await approvedScheduledFacebookVariant();
    // Simulate a claim whose worker died before reaching the provider (no in-flight marker).
    await db.update(socialPublishJobs).set({ status: "processing", attemptCount: 1, revision: s.job.revision + 1 }).where(eq(socialPublishJobs.id, s.job.id));
    const { fetchImpl, calls } = fakeFetch([{ match: (u, i) => i?.method === "POST" && u.endsWith(`/${s.externalAccountId}/feed`), respond: () => ({ json: { id: `${s.externalAccountId}_1` } }) }]);
    const result = await processPublishJob(db, { organizationId: s.orgId, publishJobId: s.job.id, deps: { fetchImpl, env: META_ENV, now: () => s.when } });
    expect(result).toMatchObject({ outcome: "published", externalPostId: `${s.externalAccountId}_1` });
    expect(calls).toHaveLength(1);
  });

  it("an ambiguous failure of the final create call (HTTP 5xx / network) is not retried into a duplicate", async () => {
    const s = await approvedScheduledFacebookVariant();
    const { fetchImpl, calls } = fakeFetch([{ match: (u, i) => i?.method === "POST" && u.endsWith(`/${s.externalAccountId}/feed`), respond: () => ({ status: 500, json: { error: { message: "An unexpected error has occurred", code: 2, is_transient: true } } }) }]);
    const err = await processPublishJob(db, { organizationId: s.orgId, publishJobId: s.job.id, deps: { fetchImpl, env: META_ENV, now: () => s.when } }).catch((e) => e);
    expect(err).toBeInstanceOf(SocialProviderError);
    expect((err as SocialProviderError).code).toBe("publish_outcome_unknown");
    expect((err as SocialProviderError).retryable).toBe(false);
    expect(await jobRow(s.job.id)).toMatchObject({ status: "failed", lastErrorCode: "publish_outcome_unknown" });
    expect(calls).toHaveLength(1);
  });

  it("deciding a superseded approval in the Founder Approval Center never approves the post's newer content", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    await makeConnectedAccount(orgId, brand.id, "facebook");
    const contributorId = await makeMarketingUser(orgId, "marketing_contributor", ownerId);
    const managerId = await makeMarketingUser(orgId, "marketing_manager", ownerId);
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: contributorId, brandProfileId: brand.id, title: "Swap", brief, platforms: ["facebook"] });
    let v = await updateVariant(db, { organizationId: orgId, contentVariantId: item.variants[0].id, actorUserId: contributorId, expectedRevision: item.variants[0].revision, changes: { body: "The harmless version the founder reads." } });
    v = await submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: contributorId, expectedRevision: v.revision });
    const staleApprovalId = v.approvalRequestId!;

    // A manager (not the submitter, not an org admin) edits after submission: the old request cannot be closed by them.
    v = await updateVariant(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: managerId, expectedRevision: v.revision, changes: { body: "A different version nobody reviewed under the old request." } });
    v = await submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: managerId, expectedRevision: v.revision });
    expect(v.approvalRequestId).not.toBe(staleApprovalId);

    const listed = await listFounderApprovals(db, { organizationId: orgId, actorUserId: ownerId });
    const stale = listed.find((a) => a.id === staleApprovalId);
    expect(stale).toBeTruthy(); // still pending and visible to the founder, showing the OLD summary
    await expect(decideFounderApproval(db, { organizationId: orgId, approvalId: staleApprovalId, decision: "approve", actorUserId: ownerId })).rejects.toBeInstanceOf(StaleSocialUpdateError);
    const after = await getVariantForUser(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId });
    expect(after.status).toBe("ready_for_review");
    const [current] = await db.select().from(agentApprovalRequests).where(and(eq(agentApprovalRequests.id, v.approvalRequestId!), eq(agentApprovalRequests.organizationId, orgId)));
    expect(current.status).toBe("pending");
  });

  it("a double-submitted reply posts exactly one public reply", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const igId = `ig${Math.random().toString(36).slice(2, 8)}`;
    const { account } = await makeConnectedAccount(orgId, brand.id, "instagram", { externalAccountId: igId });
    const [item] = await db.insert(socialEngagementItems).values({ organizationId: orgId, channelAccountId: account.id, platform: "instagram", itemType: "comment", externalId: "c-1", text: "How much?", postedAt: new Date() }).returning();
    let replies = 0;
    const { fetchImpl } = fakeFetch([{ match: (u, i) => i?.method === "POST" && u.includes("/c-1/replies"), respond: () => ({ json: { id: `reply-${++replies}` } }) }]);
    const send = () => sendReply(db, { organizationId: orgId, engagementItemId: item.id, actorUserId: ownerId, expectedRevision: item.revision, text: "Thanks — DM us!", deps: { fetchImpl, env: META_ENV } });
    const results = await Promise.allSettled([send(), send()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(replies).toBe(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(StaleSocialUpdateError);
    const [after] = await db.select().from(socialEngagementItems).where(eq(socialEngagementItems.id, item.id));
    expect(after).toMatchObject({ status: "replied", externalReplyId: "reply-1" });
  });

  it("Communications never lists, opens or overwrites a Social OAuth grant", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const { account, connection } = await makeConnectedAccount(orgId, brand.id, "facebook");
    const listed = await listConnectionsForUser(db, { organizationId: orgId, actorUserId: ownerId });
    expect(listed.find((c) => c.id === connection.id)).toBeUndefined();
    await expect(getConnectionForUser(db, { organizationId: orgId, connectionId: connection.id, actorUserId: ownerId })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    await expect(storeConnectionCredential(db, { organizationId: orgId, connectionId: connection.id, secret: "not-a-token-bundle", actorUserId: ownerId })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    // The social credential is untouched and still decrypts to the token bundle.
    const resolved = await resolveSocialAccountCredential(db, { organizationId: orgId, channelAccountId: account.id });
    expect(resolved.credential.bundle.accessToken).toBe("test-user-token");
  });

  it("ids from another organization 404 on publishing, calendar, approvals, brands and assets", async () => {
    const a = await approvedScheduledFacebookVariant();
    const other = await makeSocialOrg();
    const asset = await createExternalAsset(db, { organizationId: a.orgId, actorUserId: a.ownerId, assetType: "image", title: "Ext", url: "https://cdn.example.com/a.jpg", contentType: "image/jpeg" });
    const [variant] = await db.select().from(socialContentVariants).where(eq(socialContentVariants.id, a.variant.id));
    const foreign = { organizationId: other.orgId, actorUserId: other.ownerId };
    const [{ brandProfileId }] = await db.select({ brandProfileId: marketingContentItems.brandProfileId }).from(marketingContentItems).where(eq(marketingContentItems.id, variant.contentItemId));
    const attempts: [string, () => Promise<unknown>][] = [
      ["cancelPublishJob", () => cancelPublishJob(db, { ...foreign, publishJobId: a.job.id })],
      ["retryPublishJob", () => retryPublishJob(db, { ...foreign, publishJobId: a.job.id })],
      ["rescheduleVariant", () => rescheduleVariant(db, { ...foreign, contentVariantId: a.variant.id, expectedRevision: variant.revision, scheduledFor: new Date(Date.now() + 3 * 86400_000) })],
      ["decideVariantApproval", () => decideVariantApproval(db, { ...foreign, contentVariantId: a.variant.id, expectedRevision: variant.revision, decision: "reject" })],
      ["getVariantForUser", () => getVariantForUser(db, { ...foreign, contentVariantId: a.variant.id })],
      ["getAssetForUser", () => getAssetForUser(db, { ...foreign, assetId: asset.id })],
      ["archiveAsset", () => archiveAsset(db, { ...foreign, assetId: asset.id })],
      ["getBrandForUser", () => getBrandForUser(db, { ...foreign, brandProfileId: brandProfileId! })],
      ["updateBrand", () => updateBrand(db, { ...foreign, brandProfileId: brandProfileId!, expectedRevision: 1, changes: { name: "x" } })],
    ];
    for (const [name, attempt] of attempts) {
      const err = await attempt().then(() => null, (e) => e);
      expect(err, name).toBeInstanceOf(TenantResourceNotFoundError);
    }
    // The worker entry is keyed by (org, id): a foreign org id is a no-op.
    expect(await processPublishJob(db, { organizationId: other.orgId, publishJobId: a.job.id })).toMatchObject({ skipped: true, reason: "not_found" });
    expect(await jobRow(a.job.id)).toMatchObject({ status: "queued" });
  });

  it("refuses external asset URLs on private hosts", async () => {
    const { orgId, ownerId } = await makeSocialOrg();
    for (const url of ["https://169.254.169.254/latest/meta-data", "https://localhost:8443/x.jpg", "https://10.1.2.3/x.jpg"]) {
      await expect(createExternalAsset(db, { organizationId: orgId, actorUserId: ownerId, assetType: "image", title: "Bad", url, contentType: "image/jpeg" })).rejects.toThrow(/public internet host/);
    }
  });

  it("a contributor can draft and submit but never approve, publish, reply or touch ads; a manager cannot approve spend", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    await makeConnectedAccount(orgId, brand.id, "facebook");
    const ig = await makeConnectedAccount(orgId, brand.id, "instagram");
    const ads = await makeConnectedAccount(orgId, brand.id, "meta_ads", { externalAccountId: `act_${Math.floor(Math.random() * 1e9)}` });
    const contributor = await makeMarketingUser(orgId, "marketing_contributor", ownerId);
    const manager = await makeMarketingUser(orgId, "marketing_manager", ownerId);
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: contributor, brandProfileId: brand.id, title: "Mine", brief, platforms: ["facebook"] });
    let v = await updateVariant(db, { organizationId: orgId, contentVariantId: item.variants[0].id, actorUserId: contributor, expectedRevision: item.variants[0].revision, changes: { body: "Draft by a contributor" } });
    v = await submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: contributor, expectedRevision: v.revision });
    await expect(decideVariantApproval(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: contributor, expectedRevision: v.revision, decision: "approve" })).rejects.toBeInstanceOf(InsufficientRoleError);
    await expect(enqueuePublish(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: contributor, now: true })).rejects.toBeInstanceOf(InsufficientRoleError);
    const [eng] = await db.insert(socialEngagementItems).values({ organizationId: orgId, channelAccountId: ig.account.id, platform: "instagram", itemType: "comment", externalId: "c-9", text: "hi", postedAt: new Date() }).returning();
    await expect(sendReply(db, { organizationId: orgId, engagementItemId: eng.id, actorUserId: contributor, expectedRevision: eng.revision, text: "hello" })).rejects.toBeInstanceOf(InsufficientRoleError);
    await expect(proposeAdChange(db, { organizationId: orgId, channelAccountId: ads.account.id, actorUserId: contributor, changeType: "pause_campaign", title: "Pause", payload: { externalCampaignId: "c1" } })).rejects.toBeInstanceOf(InsufficientRoleError);
    const proposed = await proposeAdChange(db, { organizationId: orgId, channelAccountId: ads.account.id, actorUserId: manager, changeType: "pause_campaign", title: "Pause", payload: { externalCampaignId: "c1" } });
    const submitted = await submitAdChangeForApproval(db, { organizationId: orgId, changeRequestId: proposed.id, actorUserId: manager, expectedRevision: proposed.revision });
    await expect(decideAdChange(db, { organizationId: orgId, changeRequestId: proposed.id, actorUserId: manager, expectedRevision: submitted.revision, decision: "approve" })).rejects.toBeInstanceOf(InsufficientRoleError);
  });
});
