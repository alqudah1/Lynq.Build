import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { crmLeads, crmSources, marketingChannelAccounts, socialContentVariants, socialEngagementItems } from "@/db/schema";
import { InsufficientRoleError, TenantResourceNotFoundError } from "@/lib/authz/errors";
import { db, makeSocialOrg, makeConnectedAccount, makeMarketingUser, cleanupAgentRuntimeTestData, fakeFetch } from "./test-helpers";
import { fakeTextProvider } from "./providers/ai/test-fakes";
import { createContentItem } from "./content";
import { draftReply, getEngagementItemForUser, getInboxSummary, ignoreItem, linkToCrm, listEngagementItems, sendReply, syncAccountEngagement } from "./engagement";
import { StaleSocialUpdateError } from "./errors";
import { socialContentBriefSchema } from "./validation";

const META_ENV = { META_APP_ID: "test-app", META_APP_SECRET: "test-app-secret", META_GRAPH_API_VERSION: "v25.0" };

async function setup() {
  const { orgId, ownerId, brand } = await makeSocialOrg();
  const igId = `ig${Math.random().toString(36).slice(2, 8)}`;
  const postId = `media${Math.random().toString(36).slice(2, 8)}`;
  const { account } = await makeConnectedAccount(orgId, brand.id, "instagram", { externalAccountId: igId });
  const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Website speed tips", brief: socialContentBriefSchema.parse({ kind: "image_post" }), platforms: ["instagram"] });
  const [variant] = await db.update(socialContentVariants).set({ status: "published", channelAccountId: account.id, externalPostId: postId, publishedAt: new Date(), body: "Is your site slow?" }).where(eq(socialContentVariants.id, item.variants[0].id)).returning();
  const recent = new Date(Date.now() - 3600_000).toISOString();
  const graph = fakeFetch([
    { match: (u, i) => (i?.method ?? "GET") === "GET" && u.includes(`/${igId}/media`), respond: () => ({ json: { data: [{ id: postId, permalink: `https://instagram.test/p/${postId}` }] } }) },
    { match: (u, i) => (i?.method ?? "GET") === "GET" && u.includes(`/${igId}?`) && u.includes("username"), respond: () => ({ json: { username: "ourbrand" } }) },
    {
      match: (u, i) => (i?.method ?? "GET") === "GET" && u.includes(`/${postId}/comments`),
      respond: () => ({
        json: {
          data: [
            { id: "c-customer", text: "How much for a new website?", username: "customer1", timestamp: recent, from: { id: "u-1", username: "customer1" } },
            { id: "c-own-alias", text: "Thanks all!", username: "brand_alias", timestamp: recent, from: { id: igId, username: "brand_alias" } },
            { id: "c-own-name", text: "We reply as ourselves", username: "ourbrand", timestamp: recent, from: { id: "someone", username: "ourbrand" } },
          ],
        },
      }),
    },
    { match: (u) => u.includes(`/${igId}/tags`), respond: () => ({ json: { data: [] } }) },
    { match: (u, i) => i?.method === "POST" && u.includes("/c-customer/replies"), respond: () => ({ json: { id: "reply-123" } }) },
  ]);
  return { orgId, ownerId, brand, account, variant, igId, postId, graph };
}

describe("engagement inbox (integration)", () => {
  afterEach(cleanupAgentRuntimeTestData);

  it("syncs comments, skips the account's own, links the variant, and dedupes", async () => {
    const s = await setup();
    const first = await syncAccountEngagement(db, { organizationId: s.orgId, channelAccountId: s.account.id, deps: { fetchImpl: s.graph.fetchImpl, env: META_ENV } });
    expect(first).toEqual({ fetched: 2, inserted: 1, skippedOwn: 1 });
    const rows = await db.select().from(socialEngagementItems).where(eq(socialEngagementItems.channelAccountId, s.account.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "c-customer", status: "new", contentVariantId: s.variant.id, authorHandle: "@customer1", itemType: "comment" });
    const [acct] = await db.select().from(marketingChannelAccounts).where(eq(marketingChannelAccounts.id, s.account.id));
    expect(typeof (acct.metadata as Record<string, unknown>).engagementSyncedAt).toBe("string");

    // Reset the cursor so the provider returns the same comments again: the unique key must dedupe them.
    await db.update(marketingChannelAccounts).set({ metadata: {} }).where(eq(marketingChannelAccounts.id, s.account.id));
    const second = await syncAccountEngagement(db, { organizationId: s.orgId, channelAccountId: s.account.id, deps: { fetchImpl: s.graph.fetchImpl, env: META_ENV } });
    expect(second.inserted).toBe(0);
    expect(await db.select().from(socialEngagementItems).where(eq(socialEngagementItems.channelAccountId, s.account.id))).toHaveLength(1);

    const list = await listEngagementItems(db, { organizationId: s.orgId, actorUserId: s.ownerId, status: "new" });
    expect(list[0]).toMatchObject({ postTitle: "Website speed tips", accountDisplayName: s.account.displayName, brandName: "Test Brand", canReply: true });
    const summary = await getInboxSummary(db, { organizationId: s.orgId, actorUserId: s.ownerId });
    expect(summary).toMatchObject({ needsReplyCount: 1, leadsCount: 0, total: 1 });
    expect(summary.oldestUnansweredAt).toBeInstanceOf(Date);
  });

  it("drafts with the text provider, sends a human-approved reply, and enforces capabilities", async () => {
    const s = await setup();
    await syncAccountEngagement(db, { organizationId: s.orgId, channelAccountId: s.account.id, deps: { fetchImpl: s.graph.fetchImpl, env: META_ENV } });
    const [row] = await db.select().from(socialEngagementItems).where(eq(socialEngagementItems.channelAccountId, s.account.id));

    const contributor = await makeMarketingUser(s.orgId, "marketing_contributor", s.ownerId);
    const viewer = await makeMarketingUser(s.orgId, "viewer", s.ownerId);
    const text = fakeTextProvider(() => ({ json: { reply: "Thanks for asking! Send us a DM and we'll share options.", sentiment: "positive", category: "lead", isLead: true } }));
    await expect(draftReply(db, { organizationId: s.orgId, engagementItemId: row.id, actorUserId: contributor, deps: { textProvider: text.provider, aiEnv: {} } })).rejects.toBeInstanceOf(InsufficientRoleError);

    const drafted = await draftReply(db, { organizationId: s.orgId, engagementItemId: row.id, actorUserId: s.ownerId, deps: { textProvider: text.provider, aiEnv: {} } });
    expect(drafted).toMatchObject({ status: "reply_drafted", isLead: true, sentiment: "positive", category: "lead" });
    expect(drafted.replyDraft).toMatch(/Thanks for asking/);
    expect(drafted.replyDraftGenerationId).toBeTruthy();
    expect(JSON.parse(text.calls[0].prompt).message).toBe("How much for a new website?");

    await expect(sendReply(db, { organizationId: s.orgId, engagementItemId: row.id, actorUserId: viewer, expectedRevision: drafted.revision, text: "hi", deps: { fetchImpl: s.graph.fetchImpl, env: META_ENV } })).rejects.toBeInstanceOf(InsufficientRoleError);
    await expect(sendReply(db, { organizationId: s.orgId, engagementItemId: row.id, actorUserId: s.ownerId, expectedRevision: drafted.revision - 1, text: "hi", deps: { fetchImpl: s.graph.fetchImpl, env: META_ENV } })).rejects.toBeInstanceOf(StaleSocialUpdateError);

    const replied = await sendReply(db, { organizationId: s.orgId, engagementItemId: row.id, actorUserId: s.ownerId, expectedRevision: drafted.revision, text: "Thanks for asking! DM us and we'll send options.", deps: { fetchImpl: s.graph.fetchImpl, env: META_ENV } });
    expect(replied).toMatchObject({ status: "replied", externalReplyId: "reply-123", repliedByUserId: s.ownerId, replyText: "Thanks for asking! DM us and we'll send options.", canReply: false });
    const post = s.graph.calls.find((c) => c.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ message: "Thanks for asking! DM us and we'll send options." });
    await expect(ignoreItem(db, { organizationId: s.orgId, engagementItemId: row.id, actorUserId: s.ownerId, expectedRevision: replied.revision })).rejects.toThrow();
  });

  it("links a high-intent comment to a new CRM lead with a social source, idempotently", async () => {
    const s = await setup();
    await syncAccountEngagement(db, { organizationId: s.orgId, channelAccountId: s.account.id, deps: { fetchImpl: s.graph.fetchImpl, env: META_ENV } });
    const [row] = await db.select().from(socialEngagementItems).where(eq(socialEngagementItems.channelAccountId, s.account.id));
    const manager = await makeMarketingUser(s.orgId, "marketing_manager", s.ownerId);
    // A marketing manager without CRM authority is refused by CRM Core itself.
    await expect(linkToCrm(db, { organizationId: s.orgId, engagementItemId: row.id, actorUserId: manager, expectedRevision: row.revision, mode: "create_lead" })).rejects.toBeInstanceOf(InsufficientRoleError);

    const linked = await linkToCrm(db, { organizationId: s.orgId, engagementItemId: row.id, actorUserId: s.ownerId, expectedRevision: row.revision, mode: "create_lead" });
    expect(linked.isLead).toBe(true);
    expect(linked.crmLeadId).toBeTruthy();
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, linked.crmLeadId!));
    const [source] = await db.select().from(crmSources).where(and(eq(crmSources.organizationId, s.orgId), eq(crmSources.id, lead.sourceId!)));
    expect(source).toMatchObject({ sourceKey: "social_instagram", sourceType: "social" });
    expect(lead.qualificationNotes).toMatch(/How much for a new website/);

    const again = await linkToCrm(db, { organizationId: s.orgId, engagementItemId: row.id, actorUserId: s.ownerId, expectedRevision: linked.revision, mode: "create_lead" });
    expect(again.crmLeadId).toBe(linked.crmLeadId);
    expect(await db.select().from(crmLeads).where(eq(crmLeads.organizationId, s.orgId))).toHaveLength(1);
  });

  it("cross-tenant ids 404", async () => {
    const s = await setup();
    await syncAccountEngagement(db, { organizationId: s.orgId, channelAccountId: s.account.id, deps: { fetchImpl: s.graph.fetchImpl, env: META_ENV } });
    const [row] = await db.select().from(socialEngagementItems).where(eq(socialEngagementItems.channelAccountId, s.account.id));
    const other = await makeSocialOrg();
    await expect(getEngagementItemForUser(db, { organizationId: other.orgId, engagementItemId: row.id, actorUserId: other.ownerId })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    await expect(sendReply(db, { organizationId: other.orgId, engagementItemId: row.id, actorUserId: other.ownerId, expectedRevision: row.revision, text: "x" })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    await expect(syncAccountEngagement(db, { organizationId: other.orgId, channelAccountId: s.account.id })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    expect(await listEngagementItems(db, { organizationId: other.orgId, actorUserId: other.ownerId })).toEqual([]);
  });
});
