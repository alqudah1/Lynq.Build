import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { agentApprovalRequests, marketingApprovalLinks, marketingContentItems, runtimeJobs, socialPublishJobs } from "@/db/schema";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";
import { db, makeSocialOrg, makeSocialBrand, makeManualAccount, makeConnectedAccount, makeMarketingUser, cleanupAgentRuntimeTestData } from "./test-helpers";
import {
  createContentItem,
  getContentItemForUser,
  listContentItemsForUser,
  updateContentItem,
  addVariant,
  updateVariant,
  submitVariantForReview,
  decideVariantApproval,
  returnVariantToDraft,
  listPendingApprovals,
  archiveContentItem,
  SocialVariantExistsError,
} from "./content";
import { SOCIAL_MANAGER_AGENT_NAME } from "./agents";
import { StaleSocialUpdateError, SocialVariantNotPublishableError, SocialPlatformMismatchError, SocialAccountBrandMismatchError, InvalidSocialTransitionError } from "./errors";
import { socialContentBriefSchema } from "./validation";

const brief = (overrides: Record<string, unknown> = {}) => socialContentBriefSchema.parse({ topic: "Why local businesses need fast websites", hook: "Your site is losing you customers", callToAction: "Book a call", ...overrides });

async function itemStatus(itemId: string) {
  const [row] = await db.select({ status: marketingContentItems.status }).from(marketingContentItems).where(eq(marketingContentItems.id, itemId));
  return row.status;
}

describe("Social content (integration)", () => {
  afterEach(cleanupAgentRuntimeTestData);

  it("creates one draft variant per platform and auto-picks the only connected / only account", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const { account: ig } = await makeConnectedAccount(orgId, brand.id, "instagram");
    await makeManualAccount(orgId, brand.id, "instagram", "IG manual");
    const fb = await makeManualAccount(orgId, brand.id, "facebook", "FB page");
    await makeManualAccount(orgId, brand.id, "linkedin", "LI one");
    await makeManualAccount(orgId, brand.id, "linkedin", "LI two");

    const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Fast sites", brief: brief({ kind: "carousel" }), platforms: ["instagram", "facebook", "linkedin"] });
    expect(item.status).toBe("draft");
    expect(item.brandName).toBe(brand.name);
    expect(item.campaignName).toContain("always-on");
    expect(item.brief.topic).toContain("fast websites");
    const by = Object.fromEntries(item.variants.map((v) => [v.platform, v]));
    expect(Object.keys(by).sort()).toEqual(["facebook", "instagram", "linkedin"]);
    expect(by.instagram.channelAccountId).toBe(ig.id); // the one connected account wins over a manual one
    expect(by.facebook.channelAccountId).toBe(fb.id); // only account of any status
    expect(by.linkedin.channelAccountId).toBeNull(); // ambiguous — a human must choose
    expect(by.instagram.format).toBe("carousel");
    expect(by.instagram.hook).toBe("Your site is losing you customers");
    expect(by.linkedin.warnings.map((w) => w.code)).toContain("no_account");
    expect(by.facebook.warnings.map((w) => w.code)).toContain("account_not_connected");

    const listed = await listContentItemsForUser(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, platform: "linkedin" });
    expect(listed.map((i) => i.id)).toEqual([item.id]);
    expect(await listContentItemsForUser(db, { organizationId: orgId, actorUserId: ownerId, status: "approved" })).toEqual([]);
  });

  it("enforces revisions, tenancy, account/platform/brand matching and per-account uniqueness", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const other = await makeSocialOrg();
    const otherBrand = await makeSocialBrand(orgId, ownerId);
    const li = await makeManualAccount(orgId, brand.id, "linkedin", "LI");
    const fbOtherBrand = await makeManualAccount(orgId, otherBrand.id, "facebook", "FB other brand");
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "T", brief: brief(), platforms: ["linkedin"] });

    const updated = await updateContentItem(db, { organizationId: orgId, contentItemId: item.id, actorUserId: ownerId, expectedRevision: item.revision, changes: { title: "T2", brief: { tone: "Confident" } } });
    expect(updated.title).toBe("T2");
    expect(updated.brief.tone).toBe("Confident");
    expect(updated.brief.topic).toBe(item.brief.topic); // partial brief merged, not replaced
    await expect(updateContentItem(db, { organizationId: orgId, contentItemId: item.id, actorUserId: ownerId, expectedRevision: item.revision, changes: { title: "stale" } })).rejects.toBeInstanceOf(StaleSocialUpdateError);

    await expect(getContentItemForUser(db, { organizationId: other.orgId, contentItemId: item.id, actorUserId: other.ownerId })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    await expect(updateVariant(db, { organizationId: other.orgId, contentVariantId: item.variants[0].id, actorUserId: other.ownerId, expectedRevision: 1, changes: { body: "x" } })).rejects.toBeInstanceOf(TenantResourceNotFoundError);

    await expect(addVariant(db, { organizationId: orgId, contentItemId: item.id, actorUserId: ownerId, input: { platform: "facebook", channelAccountId: li.id } as never })).rejects.toBeInstanceOf(SocialPlatformMismatchError);
    await expect(addVariant(db, { organizationId: orgId, contentItemId: item.id, actorUserId: ownerId, input: { platform: "facebook", channelAccountId: fbOtherBrand.id } as never })).rejects.toBeInstanceOf(SocialAccountBrandMismatchError);
    await expect(addVariant(db, { organizationId: orgId, contentItemId: item.id, actorUserId: ownerId, input: { platform: "linkedin", channelAccountId: li.id } as never })).rejects.toBeInstanceOf(SocialVariantExistsError);

    const v = item.variants[0];
    const edited = await updateVariant(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision, changes: { body: "Hello", hashtags: ["lynq", "#Lynq", "web"] } });
    expect(edited.hashtags).toEqual(["#lynq", "#web"]);
    const bodyOnly = await updateVariant(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: edited.revision, changes: { body: "Hello again" } });
    expect(bodyOnly).toMatchObject({ body: "Hello again", hashtags: ["#lynq", "#web"], hook: v.hook, format: v.format }); // a partial PATCH never resets other fields
    await expect(updateVariant(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: edited.revision, changes: { body: "stale" } })).rejects.toBeInstanceOf(StaleSocialUpdateError);
  });

  it("lets a contributor draft and submit but not approve; refuses submission with blocking warnings", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const contributor = await makeMarketingUser(orgId, "marketing_contributor", ownerId);
    const viewerOnly = await makeMarketingUser(orgId, "viewer", ownerId);
    await makeConnectedAccount(orgId, brand.id, "linkedin");
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: contributor, brandProfileId: brand.id, title: "By contributor", brief: brief(), platforms: ["linkedin"] });
    const v = item.variants[0];

    await expect(submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: contributor, expectedRevision: v.revision })).rejects.toBeInstanceOf(SocialVariantNotPublishableError);
    await expect(createContentItem(db, { organizationId: orgId, actorUserId: viewerOnly, brandProfileId: brand.id, title: "No", brief: brief(), platforms: ["linkedin"] })).rejects.toBeInstanceOf(InsufficientRoleError);

    const edited = await updateVariant(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: contributor, expectedRevision: v.revision, changes: { body: "A real post body" } });
    const submitted = await submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: contributor, expectedRevision: edited.revision });
    expect(submitted.status).toBe("ready_for_review");
    expect(submitted.approvalRequestId).toBeTruthy();
    expect(await itemStatus(item.id)).toBe("review");

    await expect(decideVariantApproval(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: contributor, expectedRevision: submitted.revision, decision: "approve" })).rejects.toBeInstanceOf(InsufficientRoleError);

    const pending = await listPendingApprovals(db, { organizationId: orgId, actorUserId: ownerId });
    expect(pending.map((p) => p.variant.id)).toEqual([v.id]);
    expect(pending[0].title).toBe("By contributor");
    expect(pending[0].brandName).toBe(brand.name);
  });

  it("runs draft → review → approve + schedule, queueing a publish job for the scheduled time", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const { account } = await makeConnectedAccount(orgId, brand.id, "facebook");
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Launch", brief: brief(), platforms: ["facebook"] });
    let v = item.variants[0];
    expect(v.channelAccountId).toBe(account.id);
    v = await updateVariant(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision, changes: { body: "We just launched." } });
    v = await submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision });

    const [link] = await db.select().from(marketingApprovalLinks).where(eq(marketingApprovalLinks.approvalRequestId, v.approvalRequestId!));
    expect(link).toMatchObject({ linkedEntityType: "content_variant", linkedEntityId: v.id, purpose: "publish_social_post" });
    const [approval] = await db.select().from(agentApprovalRequests).where(eq(agentApprovalRequests.id, v.approvalRequestId!));
    expect(approval).toMatchObject({ status: "pending", requestedAction: "publish_social_post", riskLevel: "medium" });

    const when = new Date(Date.now() + 2 * 3600_000);
    const decided = await decideVariantApproval(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision, decision: "approve", note: "Looks good", scheduledFor: when });
    expect(decided.status).toBe("scheduled");
    expect(decided.approvedByUserId).toBe(ownerId);
    expect(decided.scheduledFor?.getTime()).toBe(when.getTime());
    const [approvalAfter] = await db.select().from(agentApprovalRequests).where(eq(agentApprovalRequests.id, v.approvalRequestId!));
    expect(approvalAfter.status).toBe("approved");

    const [job] = await db.select().from(socialPublishJobs).where(eq(socialPublishJobs.contentVariantId, v.id));
    expect(job).toMatchObject({ status: "queued", channelAccountId: account.id, platform: "facebook", idempotencyKey: `social_publish:${job.id}` });
    const [runtime] = await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.id, job.runtimeJobId!), eq(runtimeJobs.organizationId, orgId)));
    expect(runtime).toMatchObject({ jobType: "social_publish", status: "queued", idempotencyKey: job.idempotencyKey });
    expect(runtime.availableAt.getTime()).toBe(when.getTime());
    expect(await itemStatus(item.id)).toBe("scheduled");

    // An approved+scheduled post cannot be edited in place.
    await expect(updateVariant(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: decided.revision, changes: { body: "edit" } })).rejects.toBeInstanceOf(InvalidSocialTransitionError);

    // Archiving the item cancels the queued publish.
    const fresh = await getContentItemForUser(db, { organizationId: orgId, contentItemId: item.id, actorUserId: ownerId });
    const archived = await archiveContentItem(db, { organizationId: orgId, contentItemId: item.id, actorUserId: ownerId, expectedRevision: fresh.revision });
    expect(archived.status).toBe("archived");
    const [jobAfter] = await db.select().from(socialPublishJobs).where(eq(socialPublishJobs.id, job.id));
    expect(jobAfter.status).toBe("cancelled");
    const [runtimeAfter] = await db.select().from(runtimeJobs).where(eq(runtimeJobs.id, job.runtimeJobId!));
    expect(runtimeAfter.status).toBe("cancelled");
  });

  it("request_changes → back to draft → edit → resubmit; editing an awaiting-review post resets it", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    await makeConnectedAccount(orgId, brand.id, "linkedin");
    const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Iterate", brief: brief(), platforms: ["linkedin"] });
    let v = await updateVariant(db, { organizationId: orgId, contentVariantId: item.variants[0].id, actorUserId: ownerId, expectedRevision: item.variants[0].revision, changes: { body: "First take" } });
    v = await submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision });
    const firstApproval = v.approvalRequestId!;

    v = await decideVariantApproval(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision, decision: "request_changes", note: "Shorter please" });
    expect(v.status).toBe("changes_requested");
    expect(v.reviewNote).toBe("Shorter please");
    const [a1] = await db.select().from(agentApprovalRequests).where(eq(agentApprovalRequests.id, firstApproval));
    expect(a1.status).toBe("revision_requested");
    expect(await itemStatus(item.id)).toBe("draft");

    v = await returnVariantToDraft(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision });
    expect(v.status).toBe("draft");
    v = await updateVariant(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision, changes: { body: "Short" } });
    v = await submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision });
    expect(v.status).toBe("ready_for_review");
    expect(v.approvalRequestId).not.toBe(firstApproval);

    // Editing while awaiting review sends it back to draft and closes the pending approval.
    const secondApproval = v.approvalRequestId!;
    v = await updateVariant(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision, changes: { body: "Shorter" } });
    expect(v.status).toBe("draft");
    expect(v.approvalRequestId).toBeNull();
    const [a2] = await db.select().from(agentApprovalRequests).where(eq(agentApprovalRequests.id, secondApproval));
    expect(a2.status).toBe("revision_requested");

    v = await submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision });
    v = await decideVariantApproval(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision, decision: "approve", scheduledFor: null });
    expect(v.status).toBe("approved");
    expect(await itemStatus(item.id)).toBe("approved");

    // Editing an approved post drops the approval — it must be approved again.
    v = await updateVariant(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision, changes: { callToAction: "DM us" } });
    expect(v.status).toBe("draft");
    expect(v.approvedAt).toBeNull();
    expect(await itemStatus(item.id)).toBe("draft");
  });

  it("seeds the Social Media Manager agent lazily, once", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    await makeConnectedAccount(orgId, brand.id, "linkedin");
    const { agents } = await import("@/db/schema");
    for (const title of ["one", "two"]) {
      const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title, brief: brief(), platforms: ["linkedin"] });
      const v = await updateVariant(db, { organizationId: orgId, contentVariantId: item.variants[0].id, actorUserId: ownerId, expectedRevision: item.variants[0].revision, changes: { body: `Post ${title}` } });
      await submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision });
    }
    const rows = await db.select().from(agents).where(and(eq(agents.organizationId, orgId), eq(agents.name, SOCIAL_MANAGER_AGENT_NAME)));
    expect(rows).toHaveLength(1);
    expect(rows[0].lifecycleStage).toBe("deployment");
  });
});
