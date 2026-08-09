import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeSalesRepUser, makeTestPlaybook, makeTestSequence } from "./test-helpers";
import { createLead, resolveLeadById } from "@/lib/crm/leads";
import { createOpportunity, resolveOpportunityById, moveOpportunityStage } from "@/lib/crm/opportunities";
import { makeTestPipeline } from "@/lib/crm/test-helpers";
import { assignLead, autoAssignLead } from "./lead-assignment";
import { startQualificationRun, qualifyLeadViaRun, listQualificationItems, completeQualificationItem } from "./qualification";
import { publishPlaybookVersion, addPlaybookStep } from "./playbooks";
import { createSalesTarget, updateSalesTarget } from "./targets";
import { enrollInSequence, advanceDueSequences } from "./sequences";
import { revokeCrmAgentPermission } from "@/lib/crm/agent-permissions";
import { getLeadForAgent } from "@/lib/crm/agent-reads";
import { salesSequenceStepRuns, salesSequenceEnrollments, crmAgentPermissionGrants, salesApprovalLinks, agentApprovalRequests } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { StaleCrmUpdateError } from "@/lib/crm/errors";
import { DuplicateActiveRunError, PlaybookVersionImmutableError, DuplicateActiveEnrollmentError, StaleSalesUpdateError } from "./errors";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { resolveLeadResearchAssistantAgent, seedSalesAgents, requestLeadReviewApproval } from "./agents";

afterEach(cleanupAgentRuntimeTestData);

describe("Sales OS concurrency and idempotency guarantees", () => {
  it("a lead cannot receive two conflicting concurrent assignments — one wins, the other loses deterministically", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const repA = await makeSalesRepUser(orgId, "sales_rep", ownerId);
    const repB = await makeSalesRepUser(orgId, "sales_rep", ownerId);

    const results = await Promise.allSettled([
      assignLead(db, { organizationId: orgId, leadId: lead.id, assigneeUserId: repA, actorUserId: ownerId }),
      assignLead(db, { organizationId: orgId, leadId: lead.id, assigneeUserId: repB, actorUserId: ownerId }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(StaleCrmUpdateError);

    const finalLead = await resolveLeadById(db, orgId, lead.id);
    expect([repA, repB]).toContain(finalLead.ownerUserId);
  });

  it("round-robin assignment picks the least-recently-assigned eligible rep, deterministically", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const repA = await makeSalesRepUser(orgId, "sales_rep", ownerId);
    const repB = await makeSalesRepUser(orgId, "sales_rep", ownerId);

    const leadOne = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const firstAssigned = await autoAssignLead(db, { organizationId: orgId, leadId: leadOne.id, strategy: "round_robin", actorUserId: ownerId });
    expect([repA, repB]).toContain(firstAssigned.ownerUserId);

    const leadTwo = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const secondAssigned = await autoAssignLead(db, { organizationId: orgId, leadId: leadTwo.id, strategy: "round_robin", actorUserId: ownerId });

    // The rep who was NOT just assigned the first lead must get the second — real rotation, not a repeat.
    expect(secondAssigned.ownerUserId).not.toBe(firstAssigned.ownerUserId);
  });

  it("a lead cannot have two active qualification runs at once", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const { version } = await makeTestPlaybook(orgId, ownerId, "lead_qualification");

    await startQualificationRun(db, { organizationId: orgId, leadId: lead.id, playbookVersionId: version.id, actorUserId: ownerId });
    await expect(startQualificationRun(db, { organizationId: orgId, leadId: lead.id, playbookVersionId: version.id, actorUserId: ownerId })).rejects.toThrow(DuplicateActiveRunError);
  });

  it("qualifying a lead through a Sales OS run uses CRM's own canonical qualify transition", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const { version } = await makeTestPlaybook(orgId, ownerId, "lead_qualification");
    const { run } = await startQualificationRun(db, { organizationId: orgId, leadId: lead.id, playbookVersionId: version.id, actorUserId: ownerId });
    const items = await listQualificationItems(db, orgId, run.id);
    await completeQualificationItem(db, { organizationId: orgId, itemId: items[0].id, status: "complete", actorUserId: ownerId });

    const { lead: qualifiedLead } = await qualifyLeadViaRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, actorUserId: ownerId });
    expect(qualifiedLead.status).toBe("qualified");
    expect(qualifiedLead.qualifiedAt).not.toBeNull();

    const canonical = await resolveLeadById(db, orgId, lead.id);
    expect(canonical.status).toBe("qualified");
  });

  it("a published playbook version is immutable — no further steps may be added", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { version } = await makeTestPlaybook(orgId, ownerId, "lead_qualification");

    await expect(
      addPlaybookStep(db, { organizationId: orgId, playbookVersionId: version.id, stepKey: "EXTRA", stepType: "checklist", name: "Extra step", sequence: 1, actorUserId: ownerId })
    ).rejects.toThrow(PlaybookVersionImmutableError);
  });

  it("publishing a second version onto an already-published playbook is revision-guarded", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { playbook, version } = await makeTestPlaybook(orgId, ownerId, "lead_qualification");

    await expect(publishPlaybookVersion(db, { organizationId: orgId, playbookId: playbook.id, versionId: version.id, expectedRevision: 1, actorUserId: ownerId })).rejects.toThrow(StaleSalesUpdateError);
  });

  it("a target cannot be a duplicate active enrollment for the same lead", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const { sequence } = await makeTestSequence(orgId, ownerId, "lead");

    await enrollInSequence(db, { organizationId: orgId, sequenceId: sequence.id, targetType: "lead", targetId: lead.id, actorUserId: ownerId });
    await expect(enrollInSequence(db, { organizationId: orgId, sequenceId: sequence.id, targetType: "lead", targetId: lead.id, actorUserId: ownerId })).rejects.toThrow(DuplicateActiveEnrollmentError);
  });

  it("advancing a sequence twice for the same due step creates exactly one follow-up — safe under a simulated worker restart", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const { sequence } = await makeTestSequence(orgId, ownerId, "lead");
    const enrollment = await enrollInSequence(db, { organizationId: orgId, sequenceId: sequence.id, targetType: "lead", targetId: lead.id, actorUserId: ownerId });

    const first = await advanceDueSequences(db, { organizationId: orgId, systemActorUserId: ownerId });
    expect(first.executedSteps).toBe(1);

    // Simulate the sweep re-running after a restart, before the (single, day-0) step's next occurrence would ever be due again.
    const second = await advanceDueSequences(db, { organizationId: orgId, systemActorUserId: ownerId });
    expect(second.executedSteps).toBe(0);

    const stepRuns = await db.select().from(salesSequenceStepRuns).where(eq(salesSequenceStepRuns.enrollmentId, enrollment.id));
    expect(stepRuns.length).toBe(1);
  });

  it("qualifying a lead stops its active follow-up sequence enrollment on the next sweep", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const { sequence } = await makeTestSequence(orgId, ownerId, "lead");
    await enrollInSequence(db, { organizationId: orgId, sequenceId: sequence.id, targetType: "lead", targetId: lead.id, actorUserId: ownerId });
    await advanceDueSequences(db, { organizationId: orgId, systemActorUserId: ownerId });

    const { version: qualificationPlaybookVersion } = await makeTestPlaybook(orgId, ownerId, "lead_qualification");
    const { run } = await startQualificationRun(db, { organizationId: orgId, leadId: lead.id, playbookVersionId: qualificationPlaybookVersion.id, actorUserId: ownerId });
    const qualItems = await listQualificationItems(db, orgId, run.id);
    await completeQualificationItem(db, { organizationId: orgId, itemId: qualItems[0].id, status: "complete", actorUserId: ownerId });
    await qualifyLeadViaRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, actorUserId: ownerId });

    const swept = await advanceDueSequences(db, { organizationId: orgId, systemActorUserId: ownerId, now: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000) });
    expect(swept.processedEnrollments).toBe(0);
  });

  it("closing an opportunity stops its active follow-up sequence enrollment on the next sweep", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage, wonStage } = await makeTestPipeline(orgId, ownerId);
    const opportunity = await createOpportunity(db, { organizationId: orgId, name: "Test Opp", pipelineId: pipeline.id, stageId: newStage.id, actorUserId: ownerId });
    const { sequence } = await makeTestSequence(orgId, ownerId, "opportunity");
    await enrollInSequence(db, { organizationId: orgId, sequenceId: sequence.id, targetType: "opportunity", targetId: opportunity.id, actorUserId: ownerId });

    await moveOpportunityStage(db, { organizationId: orgId, opportunityId: opportunity.id, targetStageId: wonStage.id, expectedRevision: opportunity.revision, actorUserId: ownerId });

    // The enrollment is still "due" (it shows up in the sweep's candidate set), but its target is no longer
    // eligible — the sweep must stop it rather than execute the step, so zero steps actually run.
    const swept = await advanceDueSequences(db, { organizationId: orgId, systemActorUserId: ownerId });
    expect(swept.executedSteps).toBe(0);

    const enrollmentRow = await db.select().from(salesSequenceEnrollments).where(eq(salesSequenceEnrollments.targetId, opportunity.id));
    expect(enrollmentRow[0]?.status).toBe("stopped");

    const closed = await resolveOpportunityById(db, orgId, opportunity.id);
    expect(closed.status).toBe("won");
  });

  it("target value updates are revision-guarded", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const repId = await makeSalesRepUser(orgId, "sales_rep", ownerId);
    const target = await createSalesTarget(db, {
      organizationId: orgId,
      scopeType: "individual",
      userId: repId,
      metricType: "won_revenue",
      periodStart: new Date("2026-01-01"),
      periodEnd: new Date("2026-03-31"),
      targetValue: 100000,
      actorUserId: ownerId,
    });

    await expect(updateSalesTarget(db, { organizationId: orgId, targetId: target.id, expectedRevision: target.revision + 5, targetValue: 200000, actorUserId: ownerId })).rejects.toThrow(StaleSalesUpdateError);
  });

  it("revoking an agent's CRM grant stops its next read immediately", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const { leadResearchAgent } = await seedSalesAgents(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId });
    const agent = await resolveLeadResearchAssistantAgent(db, orgId);
    expect(agent.id).toBe(leadResearchAgent.id);

    const principal = { principalType: "agent" as const, agentId: agent.id, organizationId: orgId, permissionLevel: agent.permissionLevel, department: agent.department };
    const readable = await getLeadForAgent(db, principal, lead.id);
    expect(readable?.id).toBe(lead.id);

    const [grant] = await db
      .select()
      .from(crmAgentPermissionGrants)
      .where(and(eq(crmAgentPermissionGrants.organizationId, orgId), eq(crmAgentPermissionGrants.agentId, agent.id), eq(crmAgentPermissionGrants.permission, "crm_lead_read")));
    await revokeCrmAgentPermission(db, { organizationId: orgId, grantId: grant.id, expectedRevision: grant.revision, actorUserId: ownerId });

    await expect(getLeadForAgent(db, principal, lead.id)).rejects.toThrow(InsufficientRoleError);
  });

  // Regression test for Module 16's hardening fix: sales_approval_links.approvalRequestId
  // previously had no onDelete behavior on its FK to agent_approval_requests (defaulting to
  // RESTRICT), which blocked deleting an approval request that still had a linked sales
  // approval — the exact bug pattern Module 15 found and fixed for marketing_approval_links.
  it("deleting the linked approval request cascades to its sales_approval_links row, not a FK violation", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    await seedSalesAgents(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId });

    const { approval } = await requestLeadReviewApproval(db, { organizationId: orgId, leadId: lead.id, summary: "Regression test approval", actorUserId: ownerId });

    const linksBefore = await db.select().from(salesApprovalLinks).where(eq(salesApprovalLinks.approvalRequestId, approval.id));
    expect(linksBefore).toHaveLength(1);

    // Prior to the fix, this delete would throw a foreign key violation instead of cascading.
    await db.delete(agentApprovalRequests).where(eq(agentApprovalRequests.id, approval.id));

    const linksAfter = await db.select().from(salesApprovalLinks).where(eq(salesApprovalLinks.approvalRequestId, approval.id));
    expect(linksAfter).toHaveLength(0);
  });
});
