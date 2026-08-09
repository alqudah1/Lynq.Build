import { describe, it, expect, afterEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeSalesRepUser, makeTestPlaybook } from "./test-helpers";
import { createLead, resolveLeadById } from "@/lib/crm/leads";
import { assignLead } from "./lead-assignment";
import { createSalesTeam, addSalesTeamMember } from "./teams";
import { startQualificationRun, listQualificationItems, completeQualificationItem, qualifyLeadViaRun, disqualifyLeadViaRun } from "./qualification";
import { QualificationChecklistIncompleteError } from "./errors";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { StaleCrmUpdateError } from "@/lib/crm/errors";
import { auditLogs } from "@/db/schema";

afterEach(cleanupAgentRuntimeTestData);

async function setUpLeadWithRun(orgId: string, ownerId: string, assigneeUserId: string) {
  const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
  await assignLead(db, { organizationId: orgId, leadId: lead.id, assigneeUserId, actorUserId: ownerId });
  const { version } = await makeTestPlaybook(orgId, ownerId, "lead_qualification");
  const { run } = await startQualificationRun(db, { organizationId: orgId, leadId: lead.id, playbookVersionId: version.id, actorUserId: ownerId });
  return { lead, run };
}

async function completeAllItems(orgId: string, runId: string, actorUserId: string) {
  const items = await listQualificationItems(db, orgId, runId);
  for (const item of items) {
    await completeQualificationItem(db, { organizationId: orgId, itemId: item.id, status: "complete", actorUserId });
  }
}

describe("Module 14 — CRM/Sales dual-gate lead qualification authorization", () => {
  it("a rep may qualify a lead assigned to them once the checklist is complete — CRM's canonical lead transitions, attributed to Sales OS", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const repId = await makeSalesRepUser(orgId, "sales_rep", ownerId);
    const { lead, run } = await setUpLeadWithRun(orgId, ownerId, repId);
    await completeAllItems(orgId, run.id, repId);

    const { lead: qualifiedLead } = await qualifyLeadViaRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, actorUserId: repId });
    expect(qualifiedLead.status).toBe("qualified");

    const canonical = await resolveLeadById(db, orgId, lead.id);
    expect(canonical.status).toBe("qualified");

    const [auditRow] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.eventType, "crm_lead_qualified_via_sales"), eq(auditLogs.targetId, lead.id)))
      .orderBy(auditLogs.createdAt);
    expect(auditRow).toBeTruthy();
    expect(auditRow.actorUserId).toBe(repId);
    expect((auditRow.metadata as { sourceSubsystem?: string; qualificationRunId?: string })?.sourceSubsystem).toBe("sales_os");
    expect((auditRow.metadata as { qualificationRunId?: string })?.qualificationRunId).toBe(run.id);

    // No duplicate of the admin-path event for this same transition.
    const [adminPathEvent] = await db.select().from(auditLogs).where(and(eq(auditLogs.eventType, "crm_lead_qualified"), eq(auditLogs.targetId, lead.id)));
    expect(adminPathEvent).toBeUndefined();
  });

  it("a rep may NOT qualify or disqualify a lead assigned to someone else — denied on both the Sales gate and its own specific audit event", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const repA = await makeSalesRepUser(orgId, "sales_rep", ownerId);
    const repB = await makeSalesRepUser(orgId, "sales_rep", ownerId);
    const { run } = await setUpLeadWithRun(orgId, ownerId, repA);
    await completeAllItems(orgId, run.id, repA);

    await expect(qualifyLeadViaRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, actorUserId: repB })).rejects.toThrow(InsufficientRoleError);

    const [deniedEvent] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.eventType, "sales_qualification_permission_denied"), eq(auditLogs.actorUserId, repB)))
      .orderBy(auditLogs.createdAt);
    expect(deniedEvent).toBeTruthy();
  });

  it("a sales manager may qualify a lead assigned to a rep on their own real Sales team", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const managerId = await makeSalesRepUser(orgId, "sales_manager", ownerId);
    const repId = await makeSalesRepUser(orgId, "sales_rep", ownerId);

    const team = await createSalesTeam(db, { organizationId: orgId, name: "Team A", teamKey: "TEAM_A", actorUserId: ownerId });
    await addSalesTeamMember(db, { organizationId: orgId, teamId: team.id, userId: managerId, teamRole: "manager", actorUserId: ownerId });
    await addSalesTeamMember(db, { organizationId: orgId, teamId: team.id, userId: repId, teamRole: "rep", actorUserId: ownerId });

    const { lead, run } = await setUpLeadWithRun(orgId, ownerId, repId);
    await completeAllItems(orgId, run.id, repId);

    const { lead: qualifiedLead } = await qualifyLeadViaRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, actorUserId: managerId });
    expect(qualifiedLead.status).toBe("qualified");
    expect((await resolveLeadById(db, orgId, lead.id)).status).toBe("qualified");
  });

  it("a sales manager may NOT qualify a lead assigned to a rep who is not on their team — never org-wide", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const managerId = await makeSalesRepUser(orgId, "sales_manager", ownerId);
    const repId = await makeSalesRepUser(orgId, "sales_rep", ownerId);

    const teamA = await createSalesTeam(db, { organizationId: orgId, name: "Team A", teamKey: "TEAM_A2", actorUserId: ownerId });
    await addSalesTeamMember(db, { organizationId: orgId, teamId: teamA.id, userId: managerId, teamRole: "manager", actorUserId: ownerId });
    const teamB = await createSalesTeam(db, { organizationId: orgId, name: "Team B", teamKey: "TEAM_B2", actorUserId: ownerId });
    await addSalesTeamMember(db, { organizationId: orgId, teamId: teamB.id, userId: repId, teamRole: "rep", actorUserId: ownerId });

    const { run } = await setUpLeadWithRun(orgId, ownerId, repId);
    await completeAllItems(orgId, run.id, repId);

    await expect(qualifyLeadViaRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, actorUserId: managerId })).rejects.toThrow(InsufficientRoleError);
  });

  it("a sales manager may NOT qualify an unassigned lead — no rep to check team membership against, requires an explicit org-admin decision", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const managerId = await makeSalesRepUser(orgId, "sales_manager", ownerId);

    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const { version } = await makeTestPlaybook(orgId, ownerId, "lead_qualification");
    const { run } = await startQualificationRun(db, { organizationId: orgId, leadId: lead.id, playbookVersionId: version.id, actorUserId: ownerId });
    await completeAllItems(orgId, run.id, ownerId);

    await expect(qualifyLeadViaRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, actorUserId: managerId })).rejects.toThrow(InsufficientRoleError);

    // The org owner/admin path still works for the same unassigned lead.
    const { lead: qualifiedLead } = await qualifyLeadViaRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, actorUserId: ownerId });
    expect(qualifiedLead.status).toBe("qualified");
  });

  it("qualifying fails deterministically while required checklist items remain incomplete — disqualifying has no such gate", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const repId = await makeSalesRepUser(orgId, "sales_rep", ownerId);
    const { run } = await setUpLeadWithRun(orgId, ownerId, repId);

    await expect(qualifyLeadViaRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, actorUserId: repId })).rejects.toThrow(QualificationChecklistIncompleteError);

    // Disqualify does not require checklist completion.
    const { lead: disqualifiedLead } = await disqualifyLeadViaRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, reason: "Not a fit", actorUserId: repId });
    expect(disqualifiedLead.status).toBe("disqualified");
  });

  it("two concurrent qualify/disqualify attempts on one run — exactly one wins, the other fails on the canonical CRM lead's own revision guard", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const repId = await makeSalesRepUser(orgId, "sales_rep", ownerId);
    const { lead, run } = await setUpLeadWithRun(orgId, ownerId, repId);
    await completeAllItems(orgId, run.id, repId);

    const results = await Promise.allSettled([
      qualifyLeadViaRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, actorUserId: repId }),
      disqualifyLeadViaRun(db, { organizationId: orgId, runId: run.id, expectedRevision: run.revision, actorUserId: repId }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // Both racers read the same starting lead revision; CRM Core's own
    // revision-guarded UPDATE (not the qualification run's) is what
    // actually decides the winner — one source of truth, exactly as the
    // dual-gate design requires.
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(StaleCrmUpdateError);

    // The lead's own final status is exactly one of the two outcomes — never left in an intermediate or inconsistent state.
    const finalLead = await resolveLeadById(db, orgId, lead.id);
    expect(["qualified", "disqualified"]).toContain(finalLead.status);
  });
});
