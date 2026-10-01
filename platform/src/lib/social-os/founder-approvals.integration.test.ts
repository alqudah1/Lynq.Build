import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { agentApprovalRequests, socialAdChangeRequests, socialPublishJobs } from "@/db/schema";
import { decideFounderApproval, listFounderApprovals } from "@/lib/founder-os/approval-center";
import { db, makeSocialOrg, makeConnectedAccount, cleanupAgentRuntimeTestData } from "./test-helpers";
import { createContentItem, getVariantForUser, submitVariantForReview, updateVariant } from "./content";
import { proposeAdChange, submitAdChangeForApproval } from "./advertising";
import { InvalidSocialTransitionError } from "./errors";
import { socialContentBriefSchema } from "./validation";

const brief = socialContentBriefSchema.parse({ topic: "Founder-decided post", callToAction: "Book a call" });

async function submittedVariant(scheduledFor?: Date) {
  const { orgId, ownerId, brand } = await makeSocialOrg();
  await makeConnectedAccount(orgId, brand.id, "facebook");
  const item = await createContentItem(db, { organizationId: orgId, actorUserId: ownerId, brandProfileId: brand.id, title: "Founder", brief, platforms: ["facebook"] });
  let v = item.variants[0];
  v = await updateVariant(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision, changes: { body: "Decided from the Founder Approval Center.", ...(scheduledFor ? { scheduledFor } : {}) } });
  v = await submitVariantForReview(db, { organizationId: orgId, contentVariantId: v.id, actorUserId: ownerId, expectedRevision: v.revision });
  return { orgId, ownerId, brand, variant: v };
}

describe("Founder Approval Center decisions on Social approvals (integration)", () => {
  afterEach(cleanupAgentRuntimeTestData);

  it("approving a social post there moves the variant too (and schedules its planned date)", async () => {
    const when = new Date(Date.now() + 2 * 86400_000);
    const { orgId, ownerId, variant } = await submittedVariant(when);
    const listed = await listFounderApprovals(db, { organizationId: orgId, actorUserId: ownerId });
    expect(listed.find((a) => a.id === variant.approvalRequestId)).toMatchObject({ requestingSystem: "marketing", linkedEntityType: "content_variant", linkedEntityId: variant.id });

    const decided = await decideFounderApproval(db, { organizationId: orgId, approvalId: variant.approvalRequestId!, decision: "approve", actorUserId: ownerId });
    expect(decided.status).toBe("approved");
    const after = await getVariantForUser(db, { organizationId: orgId, contentVariantId: variant.id, actorUserId: ownerId });
    expect(after.status).toBe("scheduled");
    const [job] = await db.select().from(socialPublishJobs).where(eq(socialPublishJobs.contentVariantId, variant.id));
    expect(job.status).toBe("queued");
  });

  it("request revision there sends the post back as changes requested", async () => {
    const { orgId, ownerId, variant } = await submittedVariant();
    await decideFounderApproval(db, { organizationId: orgId, approvalId: variant.approvalRequestId!, decision: "request_revision", decisionNote: "Shorter please", actorUserId: ownerId });
    const after = await getVariantForUser(db, { organizationId: orgId, contentVariantId: variant.id, actorUserId: ownerId });
    expect(after.status).toBe("changes_requested");
    const [approval] = await db.select().from(agentApprovalRequests).where(and(eq(agentApprovalRequests.id, variant.approvalRequestId!), eq(agentApprovalRequests.organizationId, orgId)));
    expect(approval.status).toBe("revision_requested");
  });

  it("approving an ad change there queues its execution; revision is refused", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const { account } = await makeConnectedAccount(orgId, brand.id, "meta_ads", { externalAccountId: `act_${Math.floor(Math.random() * 1e9)}` });
    const proposed = await proposeAdChange(db, { organizationId: orgId, channelAccountId: account.id, actorUserId: ownerId, changeType: "pause_campaign", title: "Pause", payload: { externalCampaignId: "c1" } });
    const submitted = await submitAdChangeForApproval(db, { organizationId: orgId, changeRequestId: proposed.id, actorUserId: ownerId, expectedRevision: proposed.revision });
    await expect(decideFounderApproval(db, { organizationId: orgId, approvalId: submitted.approvalRequestId!, decision: "request_revision", actorUserId: ownerId })).rejects.toBeInstanceOf(InvalidSocialTransitionError);
    await decideFounderApproval(db, { organizationId: orgId, approvalId: submitted.approvalRequestId!, decision: "approve", actorUserId: ownerId });
    const [row] = await db.select().from(socialAdChangeRequests).where(eq(socialAdChangeRequests.id, proposed.id));
    expect(row.status).toBe("approved");
    expect(row.runtimeJobId).toBeTruthy();
  });
});
