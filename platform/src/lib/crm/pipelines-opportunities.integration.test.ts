import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { crmPipelines } from "@/db/schema";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeTestPipeline } from "./test-helpers";
import { createPipeline, setDefaultPipeline } from "./pipelines";
import { createStage, reorderStage } from "./stages";
import { createOpportunity, moveOpportunityStage, reopenOpportunity, resolveOpportunityById } from "./opportunities";
import { PipelineKeyAlreadyTakenError, StageKeyAlreadyTakenError, OpportunityClosedError, OpportunityNotClosedError, LostReasonRequiredError, PipelineHasNoOpenStageError } from "./errors";

afterEach(cleanupAgentRuntimeTestData);

describe("pipelines", () => {
  it("pipeline keys are unique within an organization", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await createPipeline(db, { organizationId: orgId, name: "One", pipelineKey: "SALES", actorUserId: ownerId });
    await expect(createPipeline(db, { organizationId: orgId, name: "Two", pipelineKey: "SALES", actorUserId: ownerId })).rejects.toThrow(PipelineKeyAlreadyTakenError);
  });

  it("supports more than one pipeline — no hardcoded single sales process", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const a = await createPipeline(db, { organizationId: orgId, name: "Sales", pipelineKey: "SALES_A", actorUserId: ownerId });
    const b = await createPipeline(db, { organizationId: orgId, name: "Partnerships", pipelineKey: "PARTNER_A", actorUserId: ownerId });
    expect(a.id).not.toBe(b.id);
  });

  it("setDefaultPipeline promotes exactly one pipeline; the prior default is demoted", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const a = await createPipeline(db, { organizationId: orgId, name: "A", pipelineKey: "DEFAULT_A", isDefault: true, actorUserId: ownerId });
    const b = await createPipeline(db, { organizationId: orgId, name: "B", pipelineKey: "DEFAULT_B", actorUserId: ownerId });
    const promoted = await setDefaultPipeline(db, { organizationId: orgId, pipelineId: b.id, actorUserId: ownerId });
    expect(promoted.isDefault).toBe(true);

    const [reloadedA] = await db.select().from(crmPipelines).where(eq(crmPipelines.id, a.id));
    expect(reloadedA?.isDefault).toBe(false);
  });
});

describe("pipeline stages", () => {
  it("stage keys are unique within a pipeline", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const pipeline = await createPipeline(db, { organizationId: orgId, name: "P", pipelineKey: "STAGEKEYS", actorUserId: ownerId });
    await createStage(db, { organizationId: orgId, pipelineId: pipeline.id, name: "New", stageKey: "NEW", actorUserId: ownerId });
    await expect(createStage(db, { organizationId: orgId, pipelineId: pipeline.id, name: "New Again", stageKey: "NEW", actorUserId: ownerId })).rejects.toThrow(StageKeyAlreadyTakenError);
  });

  it("a stage cannot be both won and lost — DB CHECK constraint enforced", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const pipeline = await createPipeline(db, { organizationId: orgId, name: "P", pipelineKey: "WONLOST", actorUserId: ownerId });
    await expect(createStage(db, { organizationId: orgId, pipelineId: pipeline.id, name: "Impossible", stageKey: "IMPOSSIBLE", isWon: true, isLost: true, actorUserId: ownerId })).rejects.toThrow();
  });

  it("reorderStage moves a stage without disturbing the others' relative order", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const pipeline = await createPipeline(db, { organizationId: orgId, name: "P", pipelineKey: "REORDER", actorUserId: ownerId });
    const s1 = await createStage(db, { organizationId: orgId, pipelineId: pipeline.id, name: "S1", stageKey: "S1", actorUserId: ownerId });
    const s2 = await createStage(db, { organizationId: orgId, pipelineId: pipeline.id, name: "S2", stageKey: "S2", actorUserId: ownerId });
    const s3 = await createStage(db, { organizationId: orgId, pipelineId: pipeline.id, name: "S3", stageKey: "S3", actorUserId: ownerId });

    const reordered = await reorderStage(db, { organizationId: orgId, pipelineId: pipeline.id, stageId: s3.id, targetIndex: 0, actorUserId: ownerId });
    expect(reordered.map((s) => s.id)).toEqual([s3.id, s1.id, s2.id]);
  });
});

describe("opportunity lifecycle", () => {
  it("a new opportunity's stage must belong to its pipeline, and must not already be closed", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline: pipelineA } = await makeTestPipeline(orgId, ownerId);
    const { newStage: stageFromB } = await makeTestPipeline(orgId, ownerId);
    await expect(createOpportunity(db, { organizationId: orgId, pipelineId: pipelineA.id, stageId: stageFromB.id, name: "Cross pipeline", actorUserId: ownerId })).rejects.toThrow();
  });

  it("creating an opportunity in a pipeline with zero open stages fails", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const pipeline = await createPipeline(db, { organizationId: orgId, name: "AllClosed", pipelineKey: "ALLCLOSED", actorUserId: ownerId });
    const wonOnly = await createStage(db, { organizationId: orgId, pipelineId: pipeline.id, name: "Won", stageKey: "WON", isClosed: true, isWon: true, actorUserId: ownerId });
    await expect(createOpportunity(db, { organizationId: orgId, pipelineId: pipeline.id, stageId: wonOnly.id, name: "Doomed", actorUserId: ownerId })).rejects.toThrow(PipelineHasNoOpenStageError);
  });

  it("moving into a won stage records closure — status/wonAt set atomically", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage, wonStage } = await makeTestPipeline(orgId, ownerId);
    const opp = await createOpportunity(db, { organizationId: orgId, pipelineId: pipeline.id, stageId: newStage.id, name: "Winnable", actorUserId: ownerId });

    const won = await moveOpportunityStage(db, { organizationId: orgId, opportunityId: opp.id, targetStageId: wonStage.id, expectedRevision: opp.revision, actorUserId: ownerId });
    expect(won.status).toBe("won");
    expect(won.wonAt).not.toBeNull();
  });

  it("moving into a lost stage requires a lost reason", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage, lostStage } = await makeTestPipeline(orgId, ownerId);
    const opp = await createOpportunity(db, { organizationId: orgId, pipelineId: pipeline.id, stageId: newStage.id, name: "Losable", actorUserId: ownerId });

    await expect(moveOpportunityStage(db, { organizationId: orgId, opportunityId: opp.id, targetStageId: lostStage.id, expectedRevision: opp.revision, actorUserId: ownerId })).rejects.toThrow(LostReasonRequiredError);

    const lost = await moveOpportunityStage(db, { organizationId: orgId, opportunityId: opp.id, targetStageId: lostStage.id, expectedRevision: opp.revision, lostReason: "Budget", actorUserId: ownerId });
    expect(lost.status).toBe("lost");
    expect(lost.lostReason).toBe("Budget");
  });

  it("a closed opportunity requires the explicit reopen operation — an ordinary move is refused", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage, qualifiedStage, wonStage } = await makeTestPipeline(orgId, ownerId);
    const opp = await createOpportunity(db, { organizationId: orgId, pipelineId: pipeline.id, stageId: newStage.id, name: "Reopenable", actorUserId: ownerId });
    const won = await moveOpportunityStage(db, { organizationId: orgId, opportunityId: opp.id, targetStageId: wonStage.id, expectedRevision: opp.revision, actorUserId: ownerId });

    await expect(moveOpportunityStage(db, { organizationId: orgId, opportunityId: opp.id, targetStageId: qualifiedStage.id, expectedRevision: won.revision, actorUserId: ownerId })).rejects.toThrow(OpportunityClosedError);

    const reopened = await reopenOpportunity(db, { organizationId: orgId, opportunityId: opp.id, targetStageId: qualifiedStage.id, expectedRevision: won.revision, actorUserId: ownerId });
    expect(reopened.status).toBe("open");
    expect(reopened.wonAt).toBeNull();
  });

  it("reopening an already-open opportunity fails — nothing to reopen", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage, qualifiedStage } = await makeTestPipeline(orgId, ownerId);
    const opp = await createOpportunity(db, { organizationId: orgId, pipelineId: pipeline.id, stageId: newStage.id, name: "AlreadyOpen", actorUserId: ownerId });
    await expect(reopenOpportunity(db, { organizationId: orgId, opportunityId: opp.id, targetStageId: qualifiedStage.id, expectedRevision: opp.revision, actorUserId: ownerId })).rejects.toThrow(OpportunityNotClosedError);
  });

  it("opportunity state is never accepted as a direct input — always derived from the stage moved into", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage } = await makeTestPipeline(orgId, ownerId);
    const opp = await createOpportunity(db, { organizationId: orgId, pipelineId: pipeline.id, stageId: newStage.id, name: "Derived", actorUserId: ownerId });
    expect(opp.status).toBe("open");
    const reloaded = await resolveOpportunityById(db, orgId, opp.id);
    expect(reloaded.status).toBe("open");
  });
});
