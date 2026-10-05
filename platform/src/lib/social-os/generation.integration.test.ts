import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLogs, socialAiGenerations, socialAssets, socialContentVariants } from "@/db/schema";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { db, makeSocialOrg, makeUser, addOrgMember, makeMarketingUser, cleanupAgentRuntimeTestData } from "./test-helpers";
import { beginGeneration, completeGeneration, failGeneration, generateTextRecorded, getGenerationForUser, listGenerations, recordProviderTask, runGenerationJob, summarizeGenerationUsage } from "./generation";
import { createContentItem } from "./content";
import { SocialGenerationFailedError, SocialGenerationLimitError } from "./errors";
import { socialContentBriefSchema } from "./validation";
import { fakeTextProvider, fakeVideoProvider, memoryStorage } from "./providers/ai/test-fakes";

async function auditTypes(targetId: string) {
  const rows = await db.select({ eventType: auditLogs.eventType }).from(auditLogs).where(eq(auditLogs.targetId, targetId));
  return rows.map((r) => r.eventType);
}

describe("Social AI generations (integration)", () => {
  afterEach(cleanupAgentRuntimeTestData);

  it("begin → complete records running then succeeded with usage, cost and audit", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const g = await beginGeneration(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, generationType: "text", provider: "anthropic", model: "claude-sonnet-5-5", request: { prompt: "hello" }, env: {} });
    expect(g.status).toBe("running");
    expect(g.startedAt).toBeInstanceOf(Date);
    const done = await completeGeneration(db, { organizationId: orgId, generationId: g.id, output: { text: "hi" }, usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.0012, estimated: true } });
    expect(done.status).toBe("succeeded");
    expect(done.costUsd).toBeCloseTo(0.0012, 6);
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(await auditTypes(g.id)).toEqual(expect.arrayContaining(["social_generation_requested", "social_generation_completed"]));
    // idempotent: completing twice is a no-op
    expect((await completeGeneration(db, { organizationId: orgId, generationId: g.id, output: {}, usage: {} })).status).toBe("succeeded");
  });

  it("dedupes an identical in-flight request, and allows it again once it failed", async () => {
    const { orgId, ownerId } = await makeSocialOrg();
    const input = { organizationId: orgId, actorUserId: ownerId, generationType: "text" as const, provider: "openai", model: "gpt", request: { prompt: "same", system: "s" }, env: {} };
    const first = await beginGeneration(db, input);
    await expect(beginGeneration(db, { ...input, request: { system: "s", prompt: "same" } })).rejects.toBeInstanceOf(SocialGenerationLimitError);
    // a different request is fine
    await beginGeneration(db, { ...input, request: { prompt: "different" } });
    const failed = await failGeneration(db, { organizationId: orgId, generationId: first.id, errorCode: "boom", errorMessage: "it broke" });
    expect(failed.status).toBe("failed");
    expect(failed.errorCode).toBe("boom");
    expect(await auditTypes(first.id)).toContain("social_generation_failed");
    const again = await beginGeneration(db, input);
    expect(again.id).not.toBe(first.id);
  });

  it("enforces the daily media budget atomically under concurrent requests", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const env = { SOCIAL_AI_DAILY_BUDGET_USD: 1 } as const;
    // Ten concurrent $0.40 video requests against a $1 budget: at most two may be admitted.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        beginGeneration(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, generationType: "video", provider: "runway", model: "gen4.5", request: { prompt: `clip ${i}` }, estimatedCostUsd: 0.4, env }),
      ),
    );
    const admitted = results.filter((r) => r.status === "fulfilled").length;
    const refused = results.filter((r) => r.status === "rejected" && r.reason instanceof SocialGenerationLimitError).length;
    expect(admitted).toBeLessThanOrEqual(2);
    expect(admitted + refused).toBe(10);
    const rows = await db.select({ id: socialAiGenerations.id }).from(socialAiGenerations).where(and(eq(socialAiGenerations.organizationId, orgId), eq(socialAiGenerations.generationType, "video")));
    expect(rows.length).toBe(admitted);
  });

  it("refuses media generations that would exceed today's budget (running ones count at their estimate)", async () => {
    const { orgId, ownerId } = await makeSocialOrg();
    const env = { SOCIAL_AI_DAILY_BUDGET_USD: 1 };
    const base = { organizationId: orgId, actorUserId: ownerId, generationType: "image" as const, provider: "openai", model: "gpt-image-1.5", env };
    const a = await beginGeneration(db, { ...base, request: { prompt: "a" }, estimatedCostUsd: 0.6 });
    const err = await beginGeneration(db, { ...base, request: { prompt: "b" }, estimatedCostUsd: 0.6 }).catch((e) => e);
    expect(err).toBeInstanceOf(SocialGenerationLimitError);
    expect(err.message).toContain("$0.60");
    expect(err.message).toContain("$1.00");
    // text generations are not budgeted
    await beginGeneration(db, { ...base, generationType: "text", request: { prompt: "c" }, estimatedCostUsd: 5 });
    // a failed media generation frees its estimate
    await failGeneration(db, { organizationId: orgId, generationId: a.id, errorCode: "x", errorMessage: "x" });
    await beginGeneration(db, { ...base, request: { prompt: "b" }, estimatedCostUsd: 0.6 });
    const usage = await summarizeGenerationUsage(db, { organizationId: orgId, actorUserId: ownerId, days: 1, env });
    expect(usage.dailyBudgetUsd).toBe(1);
    expect(usage.todaySpendUsd).toBeCloseTo(0.6, 6);
    expect(usage.byProvider.find((p) => p.provider === "openai" && p.model === "gpt-image-1.5")?.count).toBe(3); // two image rows + the text row on the same provider/model
  });

  it("generateTextRecorded records success, and an output that fails validation as a failed generation", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const ok = fakeTextProvider(() => ({ json: { answer: 42 } }));
    const r = await generateTextRecorded(db, { organizationId: orgId, actorUserId: ownerId, scope: { brandProfileId: brand.id }, generationType: "strategy", system: "s", prompt: "p", jsonSchema: { type: "object" }, deps: { textProvider: ok.provider, env: {} } });
    expect(r.json).toEqual({ answer: 42 });
    const row = await getGenerationForUser(db, { organizationId: orgId, generationId: r.generationId, actorUserId: ownerId });
    expect(row).toMatchObject({ status: "succeeded", provider: "anthropic", generationType: "strategy", brandProfileId: brand.id });
    expect(row.usage.inputTokens).toBe(100);

    const bad = fakeTextProvider(() => ({ json: { nope: true } }));
    const err = await generateTextRecorded(db, { organizationId: orgId, actorUserId: ownerId, generationType: "strategy", system: "s", prompt: "p2", jsonSchema: { type: "object" }, parse: (j) => { if (!(j as { answer?: number }).answer) throw new Error("answer missing"); return j; }, deps: { textProvider: bad.provider, env: {} } }).catch((e) => e);
    expect(err).toBeInstanceOf(SocialGenerationFailedError);
    const [failed] = await db.select().from(socialAiGenerations).where(and(eq(socialAiGenerations.organizationId, orgId), eq(socialAiGenerations.status, "failed")));
    expect(failed.errorMessage).toContain("answer missing");
  });

  it("listing requires marketing view", async () => {
    const { orgId, ownerId } = await makeSocialOrg();
    const viewer = await makeMarketingUser(orgId, "viewer", ownerId);
    const outsider = await makeUser();
    await addOrgMember(orgId, outsider, "member");
    await beginGeneration(db, { organizationId: orgId, actorUserId: ownerId, generationType: "text", provider: "openai", model: "m", request: { p: 1 }, env: {} });
    expect(await listGenerations(db, { organizationId: orgId, actorUserId: viewer })).toHaveLength(1);
    await expect(listGenerations(db, { organizationId: orgId, actorUserId: outsider })).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("runGenerationJob: still rendering → retryable; succeeded → asset stored and attached as the primary video", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Reel", brief: socialContentBriefSchema.parse({ kind: "image_post", topic: "t" }), platforms: ["instagram"] });
    const variant = item.variants[0];
    await db.update(socialContentVariants).set({ status: "generating" }).where(eq(socialContentVariants.id, variant.id));
    const g = await beginGeneration(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, contentItemId: item.id, contentVariantId: variant.id, generationType: "video", provider: "runway", model: "gen4.5", request: { prompt: "p", durationSeconds: 5, aspectRatio: "9:16", title: "Reel video" }, estimatedCostUsd: 0.6, env: {} });
    await recordProviderTask(db, { organizationId: orgId, generationId: g.id, providerTaskId: "task-1" });
    const storage = memoryStorage();

    const rendering = fakeVideoProvider({ statuses: [{ status: "running" }] });
    const err = await runGenerationJob(db, { organizationId: orgId, generationId: g.id, deps: { videoProvider: rendering.provider, storage, env: {} } }).catch((e) => e);
    expect(err).toBeInstanceOf(SocialGenerationFailedError);
    expect(err.retryable).toBe(true);

    const done = fakeVideoProvider({ statuses: [{ status: "succeeded", outputUrl: "https://cdn.example/v.mp4" }] });
    const out = await runGenerationJob(db, { organizationId: orgId, generationId: g.id, deps: { videoProvider: done.provider, storage, env: {} } });
    expect(out).toMatchObject({ status: "succeeded", attachedToVariant: true });
    const [asset] = await db.select().from(socialAssets).where(eq(socialAssets.id, out.assetId as string));
    expect(asset).toMatchObject({ assetType: "video", source: "generated", provider: "runway", generationId: g.id, contentType: "video/mp4" });
    const [v] = await db.select().from(socialContentVariants).where(eq(socialContentVariants.id, variant.id));
    expect(v.status).toBe("draft");
    expect(v.format).toBe("reel");
    expect(v.media).toEqual([{ assetId: asset.id, position: 0, role: "primary" }]);
    expect(v.lastGenerationId).toBe(g.id);
    const [gen] = await db.select().from(socialAiGenerations).where(eq(socialAiGenerations.id, g.id));
    expect(gen.status).toBe("succeeded");
    expect(Number(gen.costUsd)).toBeCloseTo(0.6, 6);
    // re-running a finished job is a no-op
    expect(await runGenerationJob(db, { organizationId: orgId, generationId: g.id, deps: { videoProvider: done.provider, storage, env: {} } })).toMatchObject({ skipped: true });
  });

  it("runGenerationJob: a failed render fails the generation and releases the variant", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Reel", brief: socialContentBriefSchema.parse({ topic: "t" }), platforms: ["tiktok"] });
    await db.update(socialContentVariants).set({ status: "generating" }).where(eq(socialContentVariants.id, item.variants[0].id));
    const g = await beginGeneration(db, { organizationId: orgId, actorUserId: ownerId, contentItemId: item.id, contentVariantId: item.variants[0].id, generationType: "video", provider: "runway", model: "gen4.5", request: { prompt: "p" }, providerTaskId: "t", env: {} });
    const failing = fakeVideoProvider({ statuses: [{ status: "failed", failureCode: "SAFETY", failureMessage: "rejected" }] });
    const err = await runGenerationJob(db, { organizationId: orgId, generationId: g.id, deps: { videoProvider: failing.provider, env: {} } }).catch((e) => e);
    expect(err).toBeInstanceOf(SocialGenerationFailedError);
    expect(err.retryable).toBe(false);
    const [gen] = await db.select().from(socialAiGenerations).where(eq(socialAiGenerations.id, g.id));
    expect(gen).toMatchObject({ status: "failed", errorCode: "SAFETY" });
    const [v] = await db.select().from(socialContentVariants).where(eq(socialContentVariants.id, item.variants[0].id));
    expect(v.status).toBe("draft");
  });
});
