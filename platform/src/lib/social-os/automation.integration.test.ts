import { describe, it, expect, afterEach } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { runtimeJobs, socialAutomationRules, socialAutomationRuns } from "@/db/schema";
import { InsufficientRoleError, TenantResourceNotFoundError } from "@/lib/authz/errors";
import { db, makeSocialOrg, makeConnectedAccount, makeManualAccount, makeMarketingUser, cleanupAgentRuntimeTestData } from "./test-helpers";
import { SocialAutomationIntervalError, archiveAutomationRule, enqueueDueAutomationRules, listAutomationRules, runAutomationRule, setAutomationRuleEnabled, upsertAutomationRule } from "./automation";

describe("social automation (integration)", () => {
  afterEach(cleanupAgentRuntimeTestData);

  it("upsert enforces the minimum interval, updates the same scope+kind, and checks authority", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    await expect(upsertAutomationRule(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, kind: "metrics_sync", enabled: true, intervalMinutes: 10 })).rejects.toBeInstanceOf(SocialAutomationIntervalError);

    const created = await upsertAutomationRule(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, kind: "metrics_sync", enabled: false });
    expect(created).toMatchObject({ enabled: false, intervalMinutes: 360, nextRunAt: null, label: "Performance sync" });
    const updated = await upsertAutomationRule(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, kind: "metrics_sync", enabled: true, intervalMinutes: 120 });
    expect(updated.id).toBe(created.id);
    expect(updated).toMatchObject({ enabled: true, intervalMinutes: 120, revision: created.revision + 1 });
    expect(updated.nextRunAt).toBeInstanceOf(Date);

    const orgLevel = await upsertAutomationRule(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: null, kind: "metrics_sync", enabled: false });
    const orgLevelAgain = await upsertAutomationRule(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: null, kind: "metrics_sync", enabled: false, config: { lookbackDays: 7 } });
    expect(orgLevelAgain.id).toBe(orgLevel.id);
    expect(orgLevel.id).not.toBe(created.id);

    const contributor = await makeMarketingUser(orgId, "marketing_contributor", ownerId);
    await expect(upsertAutomationRule(db, { organizationId: orgId, actorUserId: contributor, brandProfileId: null, kind: "token_watch", enabled: true })).rejects.toBeInstanceOf(InsufficientRoleError);
    const listed = await listAutomationRules(db, { organizationId: orgId, actorUserId: contributor });
    expect(listed.rules).toHaveLength(2);
    expect(listed.kinds).toHaveLength(6);

    const disabled = await setAutomationRuleEnabled(db, { organizationId: orgId, ruleId: updated.id, actorUserId: ownerId, expectedRevision: updated.revision, enabled: false });
    expect(disabled).toMatchObject({ enabled: false, nextRunAt: null });
    const archived = await archiveAutomationRule(db, { organizationId: orgId, ruleId: updated.id, actorUserId: ownerId, expectedRevision: disabled.revision });
    expect(archived.archivedAt).not.toBeNull();

    const other = await makeSocialOrg();
    await expect(setAutomationRuleEnabled(db, { organizationId: other.orgId, ruleId: orgLevel.id, actorUserId: other.ownerId, expectedRevision: 1, enabled: true })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("enqueueDueAutomationRules enqueues a due rule exactly once across two scheduler calls", async () => {
    const { orgId, ownerId } = await makeSocialOrg();
    const rule = await upsertAutomationRule(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: null, kind: "token_watch", enabled: true });
    const tick = new Date(Date.now() + 1000);
    const [a, b] = await Promise.all([enqueueDueAutomationRules(db, { now: tick }), enqueueDueAutomationRules(db, { now: tick })]);
    const c = await enqueueDueAutomationRules(db, { now: tick });
    const hits = [a, b, c].filter((r) => r.ruleIds.includes(rule.id)).length;
    expect(hits).toBe(1);
    const jobs = await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.organizationId, orgId), like(runtimeJobs.idempotencyKey, `social_automation_run:${rule.id}:%`)));
    expect(jobs).toHaveLength(1);
    const [row] = await db.select().from(socialAutomationRules).where(eq(socialAutomationRules.id, rule.id));
    expect(row.nextRunAt!.getTime()).toBe(tick.getTime() + 1440 * 60_000);
  });

  it("metrics_sync run enqueues one sync per connected account of the brand and records the run", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const { account: fb } = await makeConnectedAccount(orgId, brand.id, "facebook");
    const { account: ig } = await makeConnectedAccount(orgId, brand.id, "instagram");
    await makeManualAccount(orgId, brand.id, "linkedin");
    const rule = await upsertAutomationRule(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, kind: "metrics_sync", enabled: false });

    const result = await runAutomationRule(db, { organizationId: orgId, ruleId: rule.id });
    expect(result).toMatchObject({ kind: "metrics_sync", succeeded: true });
    const keys = (await db.select({ key: runtimeJobs.idempotencyKey }).from(runtimeJobs).where(and(eq(runtimeJobs.organizationId, orgId), like(runtimeJobs.idempotencyKey, "social_metrics_sync:%")))).map((r) => r.key).sort();
    expect(keys).toEqual([`social_metrics_sync:${fb.id}`, `social_metrics_sync:${ig.id}`].sort());

    const runs = await db.select().from(socialAutomationRuns).where(eq(socialAutomationRuns.ruleId, rule.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ succeeded: true, kind: "metrics_sync" });
    expect(runs[0].completedAt).not.toBeNull();
    expect((runs[0].result as { enqueued: number }).enqueued).toBe(2);
    const [after] = await db.select().from(socialAutomationRules).where(eq(socialAutomationRules.id, rule.id));
    expect(after).toMatchObject({ lastRunStatus: "succeeded" });
    expect(after.lastRunAt).not.toBeNull();
    const listed = await listAutomationRules(db, { organizationId: orgId, actorUserId: ownerId });
    expect(listed.rules[0].recentRuns).toHaveLength(1);
  });

  it("daily_attention run stores the computed attention in the run result; reply_drafts skips when the creator lost authority", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    await makeConnectedAccount(orgId, brand.id, "instagram", { tokenExpiresAt: new Date(Date.now() + 2 * 24 * 3600_000) });
    const rule = await upsertAutomationRule(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: null, kind: "daily_attention", enabled: false });
    const result = await runAutomationRule(db, { organizationId: orgId, ruleId: rule.id, deps: { aiEnv: {} } });
    expect(result.succeeded).toBe(true);
    const [run] = await db.select().from(socialAutomationRuns).where(eq(socialAutomationRuns.ruleId, rule.id));
    const attention = (run.result as { attention: { items: { reasonCode: string }[]; greeting: string } }).attention;
    expect(attention.greeting).toMatch(/^Good (morning|afternoon|evening)$/);
    expect(attention.items.map((i) => i.reasonCode)).toEqual(expect.arrayContaining(["social_account_expiring", "social_brand_needs_content"]));

    const manager = await makeMarketingUser(orgId, "marketing_manager", ownerId);
    const drafts = await upsertAutomationRule(db, { organizationId: orgId, actorUserId: manager, brandProfileId: null, kind: "reply_drafts", enabled: false });
    const { marketingRoleAssignments } = await import("@/db/schema");
    await db.update(marketingRoleAssignments).set({ revokedAt: new Date() }).where(and(eq(marketingRoleAssignments.organizationId, orgId), eq(marketingRoleAssignments.userId, manager)));
    const skipped = await runAutomationRule(db, { organizationId: orgId, ruleId: drafts.id });
    expect(skipped).toMatchObject({ succeeded: true, skipped: true });
    expect(skipped.summary).toMatch(/no longer holds/);
  });
});
