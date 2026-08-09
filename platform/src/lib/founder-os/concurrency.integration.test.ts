import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, addOrgMember } from "./test-helpers";
import { createFounderDecision, updateFounderDecision, supersedeFounderDecision } from "./decisions";
import { createFounderGoal, updateFounderGoal } from "./goals";
import { upsertFounderWorkspaceConfiguration } from "./configuration";
import { grantFounderRole, revokeFounderRole } from "./roles";
import { seedFounderAnalystAgent, launchFounderCompanyBriefTask } from "./founder-analyst";
import { computeCompanyPulse } from "./company-pulse";
import { StaleFounderUpdateError, DecisionAlreadySupersededError } from "./errors";
import { AuthzError } from "@/lib/authz/errors";

afterEach(cleanupAgentRuntimeTestData);

describe("Founder Workspace concurrency guarantees", () => {
  it("concurrent goal updates with the same expectedRevision: exactly one wins", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const goal = await createFounderGoal(db, { organizationId: orgId, title: "Race Goal", metricKey: "crm_leads_open", targetValue: 10, periodStart: new Date("2020-01-01"), periodEnd: new Date("2035-01-01"), ownerUserId: ownerId, actorUserId: ownerId });

    const results = await Promise.allSettled([
      updateFounderGoal(db, { organizationId: orgId, goalId: goal.id, expectedRevision: goal.revision, title: "Renamed A", actorUserId: ownerId }),
      updateFounderGoal(db, { organizationId: orgId, goalId: goal.id, expectedRevision: goal.revision, title: "Renamed B", actorUserId: ownerId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(StaleFounderUpdateError);
  });

  it("concurrent decision updates with the same expectedRevision: exactly one wins", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const decision = await createFounderDecision(db, { organizationId: orgId, title: "Race Decision", decision: "Initial", decisionOwnerUserId: ownerId, actorUserId: ownerId });

    const results = await Promise.allSettled([
      updateFounderDecision(db, { organizationId: orgId, decisionId: decision.id, expectedRevision: decision.revision, title: "Renamed A", actorUserId: ownerId }),
      updateFounderDecision(db, { organizationId: orgId, decisionId: decision.id, expectedRevision: decision.revision, title: "Renamed B", actorUserId: ownerId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(results.filter((r) => r.status === "rejected").length).toBe(1);
  });

  it("superseding a decision is single-use — concurrent supersede attempts: exactly one wins", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const original = await createFounderDecision(db, { organizationId: orgId, title: "Original", decision: "We do X", decisionOwnerUserId: ownerId, actorUserId: ownerId });
    const replacementA = await createFounderDecision(db, { organizationId: orgId, title: "Replacement A", decision: "We do Y instead", decisionOwnerUserId: ownerId, actorUserId: ownerId });
    const replacementB = await createFounderDecision(db, { organizationId: orgId, title: "Replacement B", decision: "We do Z instead", decisionOwnerUserId: ownerId, actorUserId: ownerId });

    const results = await Promise.allSettled([
      supersedeFounderDecision(db, { organizationId: orgId, decisionId: original.id, expectedRevision: original.revision, supersededByDecisionId: replacementA.id, actorUserId: ownerId }),
      supersedeFounderDecision(db, { organizationId: orgId, decisionId: original.id, expectedRevision: original.revision, supersededByDecisionId: replacementB.id, actorUserId: ownerId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(results.filter((r) => r.status === "rejected").length).toBe(1);

    // A second, sequential attempt (not a race — the row is already superseded) must be rejected with the specific "already superseded" error, not merely a generic stale-update error.
    await expect(supersedeFounderDecision(db, { organizationId: orgId, decisionId: original.id, expectedRevision: original.revision + 1, supersededByDecisionId: replacementA.id, actorUserId: ownerId })).rejects.toThrow(DecisionAlreadySupersededError);
  });

  it("Founder Workspace configuration: a stale update fails", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const config = await upsertFounderWorkspaceConfiguration(db, { organizationId: orgId, actorUserId: ownerId });

    const results = await Promise.allSettled([
      upsertFounderWorkspaceConfiguration(db, { organizationId: orgId, expectedRevision: config.revision, defaultDateRangeStrategy: "last_7_days", actorUserId: ownerId }),
      upsertFounderWorkspaceConfiguration(db, { organizationId: orgId, expectedRevision: config.revision, defaultDateRangeStrategy: "month_to_date", actorUserId: ownerId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(results.filter((r) => r.status === "rejected").length).toBe(1);
  });

  it("duplicate daily brief generation within the same day is idempotent — reuses the same execution and artifact", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await seedFounderAnalystAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId });

    const first = await launchFounderCompanyBriefTask(db, { organizationId: orgId, workspaceId: null, ownerUserId: ownerId, actorUserId: ownerId });
    expect(first.reusedExisting).toBe(false);

    const second = await launchFounderCompanyBriefTask(db, { organizationId: orgId, workspaceId: null, ownerUserId: ownerId, actorUserId: ownerId });
    expect(second.reusedExisting).toBe(true);
    expect(second.execution.id).toBe(first.execution.id);
    expect(second.artifact.id).toBe(first.artifact.id);
  });

  it("permission revocation immediately affects access — a query issued right after revocation is denied", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const userId = await makeUser();
    await addOrgMember(orgId, userId, "member");
    const assignment = await grantFounderRole(db, { organizationId: orgId, userId, role: "founder_viewer", actorUserId: ownerId });

    await computeCompanyPulse(db, { organizationId: orgId, workspaceId: null, actorUserId: userId });

    await revokeFounderRole(db, { organizationId: orgId, roleAssignmentId: assignment.id, expectedRevision: assignment.revision, actorUserId: ownerId });

    await expect(computeCompanyPulse(db, { organizationId: orgId, workspaceId: null, actorUserId: userId })).rejects.toThrow(AuthzError);
  });
});
