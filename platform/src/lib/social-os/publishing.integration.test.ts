import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { marketingChannelAccounts, marketingContentItems, runtimeJobs, socialContentVariants, socialPublishJobs } from "@/db/schema";
import { db, makeSocialOrg, makeConnectedAccount, cleanupAgentRuntimeTestData, fakeFetch, pollUntilJobDone, TINY_JPEG } from "./test-helpers";
import { createContentItem, updateVariant, submitVariantForReview, decideVariantApproval } from "./content";
import { createUploadedAsset, type SocialAssetStorage } from "./assets";
import { enqueuePublish, processPublishJob, retryPublishJob, listPublishJobs } from "./publishing";
import { SocialDuplicatePublishError, SocialProviderError } from "./errors";
import { socialContentBriefSchema, type SocialOrganicPlatform, type SocialVariantMedia } from "./validation";

const META_ENV = { META_APP_ID: "test-app", META_APP_SECRET: "test-app-secret", META_GRAPH_API_VERSION: "v25.0" };
const URL_ENV = { AUTH_BASE_URL: "https://app.example.test", AUTH_SECRET: "s".repeat(40) };

function memoryStorage(): SocialAssetStorage & { files: Map<string, { bytes: Uint8Array; contentType: string }> } {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    files,
    async put(pathname, bytes, options) {
      const stored = `${pathname}-r${files.size}`;
      files.set(stored, { bytes, contentType: options.contentType });
      return { pathname: stored, url: `https://blob.test/${stored}` };
    },
    async get(pathname) {
      const f = files.get(pathname);
      if (!f) return null;
      return { stream: new Blob([new Uint8Array(f.bytes)]).stream(), contentType: f.contentType, size: f.bytes.byteLength };
    },
  };
}

/** An approved variant scheduled one day out (so no background worker picks the runtime job up), ready for `processPublishJob`. */
async function approvedScheduledVariant(opts: { platform?: SocialOrganicPlatform; format?: string; media?: (orgId: string, ownerId: string, brandId: string) => Promise<SocialVariantMedia> } = {}) {
  const platform = opts.platform ?? "facebook";
  const { orgId, ownerId, brand } = await makeSocialOrg();
  const externalAccountId = `page${Math.random().toString(36).slice(2, 8)}`;
  const { account } = await makeConnectedAccount(orgId, brand.id, platform, { externalAccountId });
  const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Publish me", brief: socialContentBriefSchema.parse({ kind: platform === "instagram" ? "image_post" : "text_post" }), platforms: [platform] });
  const media = opts.media ? await opts.media(orgId, ownerId, brand.id) : [];
  let v = await updateVariant(db, { organizationId: orgId, contentVariantId: item.variants[0].id, actorUserId: ownerId, expectedRevision: item.variants[0].revision, changes: { body: "Hello from LYNQ", hashtags: ["lynq"], media, ...(opts.format ? { format: opts.format as never } : {}) } });
  v = await submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision });
  const when = new Date(Date.now() + 24 * 3600_000);
  v = await decideVariantApproval(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision, decision: "approve", scheduledFor: when });
  const [job] = await db.select().from(socialPublishJobs).where(eq(socialPublishJobs.contentVariantId, v.id));
  return { orgId, ownerId, brand, account, externalAccountId, item, variant: v, job, when };
}

async function variantRow(id: string) {
  const [row] = await db.select().from(socialContentVariants).where(eq(socialContentVariants.id, id));
  return row;
}
async function jobRow(id: string) {
  const [row] = await db.select().from(socialPublishJobs).where(eq(socialPublishJobs.id, id));
  return row;
}

describe("Publishing engine (integration)", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanupAgentRuntimeTestData();
  });

  it("publishes through the adapter, records the external id, and is a no-op the second time", async () => {
    const s = await approvedScheduledVariant();
    expect(s.job.status).toBe("queued");
    const { fetchImpl, calls } = fakeFetch([{ match: (u, i) => i?.method === "POST" && u.endsWith(`/${s.externalAccountId}/feed`), respond: () => ({ json: { id: `${s.externalAccountId}_777` } }) }]);
    const deps = { fetchImpl, env: META_ENV, now: () => s.when, assetUrlEnv: URL_ENV };

    const result = await processPublishJob(db, { organizationId: s.orgId, publishJobId: s.job.id, deps });
    expect(result).toMatchObject({ outcome: "published", externalPostId: `${s.externalAccountId}_777` });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.message).toBe("Hello from LYNQ\n\n#lynq");
    expect(String((calls[0].init?.headers as Record<string, string>).Authorization)).toBe("Bearer test-asset-token");

    const job = await jobRow(s.job.id);
    expect(job).toMatchObject({ status: "published", externalPostId: `${s.externalAccountId}_777`, attemptCount: 1 });
    const v = await variantRow(s.variant.id);
    expect(v).toMatchObject({ status: "published", externalPostId: `${s.externalAccountId}_777`, externalPostUrl: `https://www.facebook.com/${s.externalAccountId}_777` });
    const [item] = await db.select().from(marketingContentItems).where(eq(marketingContentItems.id, s.item.id));
    expect(item.status).toBe("published");

    const again = await processPublishJob(db, { organizationId: s.orgId, publishJobId: s.job.id, deps });
    expect(again).toMatchObject({ skipped: true });
    expect(calls).toHaveLength(1);

    const jobs = await listPublishJobs(db, { organizationId: s.orgId, actorUserId: s.ownerId });
    expect(jobs[0]).toMatchObject({ id: s.job.id, status: "published", title: "Publish me", variantStatus: "published" });
  });

  it("rejects a duplicate enqueue while a job is active", async () => {
    const s = await approvedScheduledVariant();
    await expect(enqueuePublish(db, { organizationId: s.orgId, contentVariantId: s.variant.id, actorUserId: s.ownerId, scheduledFor: new Date(Date.now() + 48 * 3600_000) })).rejects.toBeInstanceOf(SocialDuplicatePublishError);
  });

  it("a provider 500 leaves the job retrying with resumable provider state, and the retry resumes it", async () => {
    const storage = memoryStorage();
    const s = await approvedScheduledVariant({
      format: "carousel",
      media: async (orgId, ownerId, brandId) => {
        const a = await createUploadedAsset(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brandId, assetType: "image", title: "One", file: { bytes: TINY_JPEG, contentType: "image/jpeg", filename: "one.jpg" }, storage });
        const b = await createUploadedAsset(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brandId, assetType: "image", title: "Two", file: { bytes: TINY_JPEG, contentType: "image/jpeg", filename: "two.jpg" }, storage });
        expect(a).toMatchObject({ width: 1, height: 1, storageKind: "blob" });
        return [
          { assetId: a.id, position: 0, role: "carousel_item" },
          { assetId: b.id, position: 1, role: "carousel_item" },
        ];
      },
    });
    let photo = 0;
    let feedFails = true;
    const { fetchImpl, calls } = fakeFetch([
      { match: (u, i) => i?.method === "POST" && u.endsWith(`/${s.externalAccountId}/photos`), respond: () => ({ json: { id: `photo${++photo}` } }) },
      { match: (u, i) => i?.method === "POST" && u.endsWith(`/${s.externalAccountId}/feed`), respond: () => (feedFails ? { status: 500, json: { error: { message: "An unexpected error has occurred", code: 2, is_transient: true } } } : { json: { id: `${s.externalAccountId}_888` } }) },
    ]);
    const deps = { fetchImpl, env: META_ENV, now: () => s.when, assetUrlEnv: URL_ENV, storage };

    const err = await processPublishJob(db, { organizationId: s.orgId, publishJobId: s.job.id, deps }).catch((e) => e);
    expect(err).toBeInstanceOf(SocialProviderError);
    expect((err as SocialProviderError).retryable).toBe(true);
    const failed = await jobRow(s.job.id);
    expect(failed).toMatchObject({ status: "retrying", attemptCount: 1, lastErrorClass: "transient" });
    expect(failed.providerState).toEqual({ photoIds: ["photo1", "photo2"] });
    // The media URL Meta pulls from is our signed public delivery route.
    const firstPhoto = JSON.parse(String(calls[0].init?.body));
    expect(firstPhoto.url).toMatch(/^https:\/\/app\.example\.test\/api\/social\/assets\/[0-9a-f-]{36}\?token=\d+\./);
    expect((await variantRow(s.variant.id)).status).toBe("publishing");

    feedFails = false;
    const ok = await processPublishJob(db, { organizationId: s.orgId, publishJobId: s.job.id, deps });
    expect(ok).toMatchObject({ outcome: "published", externalPostId: `${s.externalAccountId}_888` });
    expect(photo).toBe(2); // resumed from provider_state — no duplicate photo uploads
    expect(await jobRow(s.job.id)).toMatchObject({ status: "published", attemptCount: 2, providerState: {} });
  });

  it("a revoked token (Meta 190) fails the job, the variant, and marks the account's authorization lost; retry is a new job series", async () => {
    const s = await approvedScheduledVariant();
    const { fetchImpl } = fakeFetch([{ match: (u) => u.endsWith("/feed"), respond: () => ({ status: 400, json: { error: { message: "Error validating access token", type: "OAuthException", code: 190, error_subcode: 460 } } }) }]);
    const err = await processPublishJob(db, { organizationId: s.orgId, publishJobId: s.job.id, deps: { fetchImpl, env: META_ENV, now: () => s.when } }).catch((e) => e);
    expect(err).toBeInstanceOf(SocialProviderError);
    expect((err as SocialProviderError).authorizationLost).toBe(true);
    expect(await jobRow(s.job.id)).toMatchObject({ status: "failed", lastErrorCode: "meta_190_460", lastErrorClass: "authorization_lost" });
    expect((await variantRow(s.variant.id)).status).toBe("failed");
    const [account] = await db.select().from(marketingChannelAccounts).where(eq(marketingChannelAccounts.id, s.account.id));
    expect(account.connectionStatus).toBe("token_expired");
    expect(account.lastErrorCode).toBe("meta_190_460");

    // Account is no longer connected → a retry is refused by the warnings check.
    await expect(retryPublishJob(db, { organizationId: s.orgId, publishJobId: s.job.id, actorUserId: s.ownerId })).rejects.toThrow(/not connected/);
    await db.update(marketingChannelAccounts).set({ connectionStatus: "connected" }).where(eq(marketingChannelAccounts.id, s.account.id));
    const next = await retryPublishJob(db, { organizationId: s.orgId, publishJobId: s.job.id, actorUserId: s.ownerId });
    expect(next.id).not.toBe(s.job.id);
    expect(next.status).toBe("queued");
    expect((await variantRow(s.variant.id)).status).toBe("publishing");
  });

  it("cancels the job instead of publishing when the variant is no longer publishable", async () => {
    const s = await approvedScheduledVariant();
    await db.update(socialContentVariants).set({ status: "draft" }).where(eq(socialContentVariants.id, s.variant.id));
    const { fetchImpl, calls } = fakeFetch([]);
    const result = await processPublishJob(db, { organizationId: s.orgId, publishJobId: s.job.id, deps: { fetchImpl, env: META_ENV } });
    expect(result).toMatchObject({ outcome: "cancelled", skipped: true });
    expect(calls).toHaveLength(0);
    expect((await jobRow(s.job.id)).status).toBe("cancelled");
  });

  it("an Instagram container still processing → pending → retrying with the container id persisted", async () => {
    const storage = memoryStorage();
    const s = await approvedScheduledVariant({
      platform: "instagram",
      media: async (orgId, ownerId, brandId) => {
        const a = await createUploadedAsset(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brandId, assetType: "image", title: "IG", file: { bytes: TINY_JPEG, contentType: "image/jpeg" }, storage });
        return [{ assetId: a.id, position: 0, role: "primary" }];
      },
    });
    const { fetchImpl, calls } = fakeFetch([
      { match: (u, i) => i?.method === "POST" && u.endsWith(`/${s.externalAccountId}/media`), respond: () => ({ json: { id: "container-1" } }) },
      { match: (u) => u.includes("/container-1?") && u.includes("status_code"), respond: () => ({ json: { status_code: "IN_PROGRESS" } }) },
    ]);
    const err = await processPublishJob(db, { organizationId: s.orgId, publishJobId: s.job.id, deps: { fetchImpl, env: META_ENV, now: () => s.when, sleep: async () => {}, assetUrlEnv: URL_ENV, storage } }).catch((e) => e);
    expect(err).toBeInstanceOf(SocialProviderError);
    expect((err as SocialProviderError).code).toBe("pending");
    expect((err as SocialProviderError).retryable).toBe(true);
    const job = await jobRow(s.job.id);
    expect(job).toMatchObject({ status: "retrying", lastErrorCode: "pending" });
    expect(job.providerState).toMatchObject({ containerId: "container-1" });
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(1);
    expect((await variantRow(s.variant.id)).status).toBe("publishing");
  });

  it("publishes now through the real runtime worker", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const pageId = `page${Math.random().toString(36).slice(2, 8)}`;
    await makeConnectedAccount(orgId, brand.id, "facebook", { externalAccountId: pageId });
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Now", brief: socialContentBriefSchema.parse({}), platforms: ["facebook"] });
    let v = await updateVariant(db, { organizationId: orgId, contentVariantId: item.variants[0].id, actorUserId: ownerId, expectedRevision: item.variants[0].revision, changes: { body: "Right now" } });
    v = await submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision });

    const realFetch = globalThis.fetch;
    const { fetchImpl } = fakeFetch([{ match: (u, i) => i?.method === "POST" && u.endsWith(`/${pageId}/feed`), respond: () => ({ json: { id: `${pageId}_999` } }) }]);
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => (String(input instanceof Request ? input.url : input).startsWith("https://graph.facebook.com/") ? fetchImpl(String(input), init) : realFetch(input, init)));

    v = await decideVariantApproval(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision, decision: "approve", publishNow: true });
    expect(v.status).toBe("publishing");
    const [job] = await db.select().from(socialPublishJobs).where(eq(socialPublishJobs.contentVariantId, v.id));
    const runtime = await pollUntilJobDone(job.runtimeJobId!);
    expect(runtime.status).toBe("completed");
    const [rt] = await db.select().from(runtimeJobs).where(eq(runtimeJobs.id, job.runtimeJobId!));
    expect(rt.status).toBe("completed");
    expect(await jobRow(job.id)).toMatchObject({ status: "published", externalPostId: `${pageId}_999` });
    expect((await variantRow(v.id)).status).toBe("published");
  });
});
