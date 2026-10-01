import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLogs, marketingContentItems, socialAiGenerations, socialContentVariants, socialManagerMessages } from "@/db/schema";
import { InsufficientRoleError, TenantResourceNotFoundError } from "@/lib/authz/errors";
import { db, makeSocialOrg, makeMarketingUser, cleanupAgentRuntimeTestData } from "./test-helpers";
import { buildManagerTools, createManagerThread, FORBIDDEN_MANAGER_TOOL_PATTERN, getManagerThread, listManagerThreads, sendManagerMessage } from "./manager";
import { SocialProviderNotConfiguredError } from "./errors";
import { fakeTextProvider } from "./providers/ai/test-fakes";
import type { TextGenerationRequest } from "./providers/ai/types";

function variantWriter(req: TextGenerationRequest) {
  const p = JSON.parse(req.prompt) as { platforms?: { platform: string }[] };
  return { json: { variants: (p.platforms ?? []).map(({ platform }) => ({ platform, hook: "Hook", body: `Body for ${platform}`, hashtags: [], callToAction: "Book a call" })) } };
}

describe("AI Social Manager (integration)", () => {
  afterEach(cleanupAgentRuntimeTestData);

  it("runs a tool loop that creates a draft, records proposed actions, and never publishes", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const thread = await createManagerThread(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id });
    expect(thread.title).toBe("New conversation");
    let managerCalls = 0;
    const fake = fakeTextProvider((req) => {
      if (!req.system.includes("TOOL PROTOCOL")) return variantWriter(req);
      managerCalls++;
      if (managerCalls === 1) return { text: '{"tool":"get_calendar","input":{}}' };
      if (managerCalls === 2) return { text: JSON.stringify({ tool: "create_content_draft", input: { title: "Why fast sites win", kind: "text_post", objective: "education", topic: "Page speed and local search", platforms: ["linkedin"] } }) };
      return { text: '{"final":"I drafted one LinkedIn post for your review in the Approval Center."}' };
    });
    const out = await sendManagerMessage(db, { organizationId: orgId, threadId: thread.id, actorUserId: ownerId, content: "Draft a LinkedIn post about page speed", deps: { textProvider: fake.provider, env: {} } });

    const roles = out.messages!.map((m) => m.role);
    expect(roles).toEqual(["user", "tool", "tool", "assistant"]);
    const assistant = out.messages!.at(-1)!;
    expect(assistant.content).toMatch(/drafted one LinkedIn post/);
    expect(assistant.proposedActions).toHaveLength(1);
    expect(assistant.proposedActions[0].type).toBe("content_item");
    expect(assistant.generationId).toBeTruthy();
    expect(out.title).toBe("Draft a LinkedIn post about page speed");

    const [item] = await db.select().from(marketingContentItems).where(and(eq(marketingContentItems.organizationId, orgId), eq(marketingContentItems.id, assistant.proposedActions[0].id)));
    expect(item.title).toBe("Why fast sites win");
    const variants = await db.select().from(socialContentVariants).where(eq(socialContentVariants.contentItemId, item.id));
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({ platform: "linkedin", status: "draft", body: "Body for linkedin", approvalRequestId: null, publishedAt: null });

    // The manager's own model calls are recorded as manager_task generations.
    const gens = await db.select().from(socialAiGenerations).where(and(eq(socialAiGenerations.organizationId, orgId), eq(socialAiGenerations.generationType, "manager_task")));
    expect(gens).toHaveLength(3);
    expect(gens.every((g) => g.status === "succeeded")).toBe(true);

    // The tool catalogue has no publish/approve/ad capability at all.
    const tools = buildManagerTools(db, { organizationId: orgId, actorUserId: ownerId, threadBrandProfileId: brand.id });
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["create_content_draft", "plan_week", "propose_schedule", "get_performance_summary"]));
    expect(tools.filter((t) => FORBIDDEN_MANAGER_TOOL_PATTERN.test(t.name)).map((t) => t.name)).toEqual([]);
    expect(fake.calls.find((c) => c.system.includes("TOOL PROTOCOL"))!.system).not.toMatch(/- publish|- approve/);

    const audits = await db.select({ eventType: auditLogs.eventType }).from(auditLogs).where(eq(auditLogs.targetId, thread.id));
    expect(audits.map((a) => a.eventType)).toEqual(expect.arrayContaining(["social_manager_thread_created", "social_manager_message_sent"]));
  });

  it("propose_schedule only touches draft variants and the item's planned date", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const thread = await createManagerThread(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id });
    const tools = buildManagerTools(db, { organizationId: orgId, actorUserId: ownerId, threadBrandProfileId: brand.id, deps: { textProvider: fakeTextProvider(variantWriter).provider, env: {} } });
    const create = tools.find((t) => t.name === "create_content_draft")!;
    const created = await create.execute(create.input.parse({ title: "T", topic: "x", platforms: ["linkedin", "facebook"] }));
    const contentItemId = (created.result as { contentItemId: string }).contentItemId;
    const when = new Date(Date.now() + 5 * 86400_000).toISOString();
    const propose = tools.find((t) => t.name === "propose_schedule")!;
    const res = await propose.execute(propose.input.parse({ contentItemId, scheduledFor: when }));
    expect((res.result as { updatedDraftVariants: string[] }).updatedDraftVariants).toHaveLength(2);
    const variants = await db.select().from(socialContentVariants).where(eq(socialContentVariants.contentItemId, contentItemId));
    for (const v of variants) {
      expect(v.scheduledFor?.toISOString()).toBe(when);
      expect(v.status).toBe("draft");
    }
    await expect(propose.execute(propose.input.parse({ contentItemId, scheduledFor: new Date(Date.now() - 1000).toISOString() }))).rejects.toThrow(/future/);
    expect(thread.id).toBeTruthy();
  });

  it("threads are private to their owner, tenant-scoped, and need generate authority to send", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const other = await makeSocialOrg();
    const contributor = await makeMarketingUser(orgId, "marketing_contributor", ownerId);
    const viewer = await makeMarketingUser(orgId, "viewer", ownerId);
    const thread = await createManagerThread(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Mine" });
    await expect(getManagerThread(db, { organizationId: orgId, threadId: thread.id, actorUserId: contributor })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    await expect(getManagerThread(db, { organizationId: other.orgId, threadId: thread.id, actorUserId: other.ownerId })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    await expect(createManagerThread(db, { organizationId: orgId, actorUserId: viewer })).rejects.toBeInstanceOf(InsufficientRoleError);
    expect(await listManagerThreads(db, { organizationId: orgId, actorUserId: viewer })).toEqual([]);
    expect((await listManagerThreads(db, { organizationId: orgId, actorUserId: ownerId })).map((t) => t.id)).toEqual([thread.id]);
    const own = await createManagerThread(db, { organizationId: orgId, actorUserId: contributor });
    expect(own.brandProfileId).toBeNull();
  });

  it("with no text provider configured, refuses honestly before writing anything", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const thread = await createManagerThread(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id });
    await expect(sendManagerMessage(db, { organizationId: orgId, threadId: thread.id, actorUserId: ownerId, content: "hello", deps: { env: {} } })).rejects.toBeInstanceOf(SocialProviderNotConfiguredError);
    const msgs = await db.select().from(socialManagerMessages).where(eq(socialManagerMessages.threadId, thread.id));
    expect(msgs).toHaveLength(0);
  });
});
