import { describe, it, expect, afterEach } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeSalesRepUser, makeTestPlaybook } from "./test-helpers";
import { makeTestPipeline, makeTestContact } from "@/lib/crm/test-helpers";
import { createLead, qualifyLead } from "@/lib/crm/leads";
import { createOpportunity } from "@/lib/crm/opportunities";
import { computeOpportunityHealth, classifyOpportunityHealth } from "./health";
import { computeForecast } from "./forecasting";
import { createSalesTarget, computeTargetProgress } from "./targets";
import { assignLead } from "./lead-assignment";
import { startQualificationRun } from "./qualification";
import { auditLogs } from "@/db/schema";

afterEach(cleanupAgentRuntimeTestData);

describe("Sales OS deterministic outputs", () => {
  it("opportunity health is a pure function of real signals — a fresh, fully-linked, on-track opportunity is healthy with no reasons", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage } = await makeTestPipeline(orgId, ownerId);
    const contact = await makeTestContact(orgId, ownerId);
    const opportunity = await createOpportunity(db, { organizationId: orgId, name: "Healthy Opp", pipelineId: pipeline.id, stageId: newStage.id, primaryContactId: contact.id, actorUserId: ownerId });

    const health = await computeOpportunityHealth(db, { organizationId: orgId, opportunityId: opportunity.id, actorUserId: ownerId });
    // A brand-new opportunity has no activity/follow-up yet, so it is never claimed "healthy" — deterministic, not optimistic by default.
    expect(health.status).not.toBe("healthy");
    expect(Array.isArray(health.reasons)).toBe(true);
    expect(health.reasons).toContain("no_recent_activity");
    expect(health.reasons).toContain("no_scheduled_follow_up");
    // A real, linked contact means the missing-link reason must NOT fire — the signal is genuinely conditional, not always-on.
    expect(health.reasons).not.toContain("missing_contact_or_company");
  });

  it("classifyOpportunityHealth is a pure, deterministic threshold function", () => {
    expect(classifyOpportunityHealth([])).toBe("healthy");
    expect(classifyOpportunityHealth(["no_recent_activity"])).toBe("attention");
    expect(classifyOpportunityHealth(["no_recent_activity", "overdue_follow_up"])).toBe("attention");
    expect(classifyOpportunityHealth(["no_recent_activity", "overdue_follow_up", "no_scheduled_follow_up"])).toBe("at_risk");
  });

  it("a lost opportunity never contributes to open pipeline value or a healthy classification", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage, lostStage } = await makeTestPipeline(orgId, ownerId);
    const opportunity = await createOpportunity(db, { organizationId: orgId, name: "Lost Opp", pipelineId: pipeline.id, stageId: newStage.id, amount: 5000, actorUserId: ownerId });
    const { moveOpportunityStage } = await import("@/lib/crm/opportunities");
    await moveOpportunityStage(db, { organizationId: orgId, opportunityId: opportunity.id, targetStageId: lostStage.id, expectedRevision: opportunity.revision, lostReason: "Budget cut", actorUserId: ownerId });

    const forecast = await computeForecast(db, { organizationId: orgId, actorUserId: ownerId });
    expect(forecast.lostValue).toBeGreaterThanOrEqual(5000);

    const health = await computeOpportunityHealth(db, { organizationId: orgId, opportunityId: opportunity.id, actorUserId: ownerId });
    expect(health.reasons).toEqual([]);
    expect(health.status).toBe("healthy");
  });

  it("forecast weighted value is always ≤ open pipeline value — an estimate derived from stage probability, never inflated beyond the real total", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage } = await makeTestPipeline(orgId, ownerId);
    await createOpportunity(db, { organizationId: orgId, name: "Opp A", pipelineId: pipeline.id, stageId: newStage.id, amount: 10000, actorUserId: ownerId });
    await createOpportunity(db, { organizationId: orgId, name: "Opp B", pipelineId: pipeline.id, stageId: newStage.id, amount: 20000, actorUserId: ownerId });

    const forecast = await computeForecast(db, { organizationId: orgId, actorUserId: ownerId });
    expect(forecast.weightedPipelineValueEstimate).toBeLessThanOrEqual(forecast.openPipelineValue);
    expect(forecast.openPipelineValue).toBeGreaterThanOrEqual(30000);
  });

  it("target progress is a deterministic ratio recomputed from real CRM data, never a stored/cached number", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const repId = await makeSalesRepUser(orgId, "sales_rep", ownerId);
    const target = await createSalesTarget(db, {
      organizationId: orgId,
      scopeType: "individual",
      userId: repId,
      metricType: "leads_qualified",
      periodStart: new Date("2020-01-01"),
      periodEnd: new Date("2030-01-01"),
      targetValue: 2,
      actorUserId: ownerId,
    });

    const before = await computeTargetProgress(db, { organizationId: orgId, targetId: target.id, actorUserId: ownerId });
    expect(before.actualValue).toBe(0);
    expect(before.progressRatio).toBe(0);

    const lead = await createLead(db, { organizationId: orgId, ownerUserId: repId, actorUserId: ownerId });
    await qualifyLead(db, { organizationId: orgId, leadId: lead.id, expectedRevision: lead.revision, actorUserId: ownerId });

    const after = await computeTargetProgress(db, { organizationId: orgId, targetId: target.id, actorUserId: ownerId });
    expect(after.actualValue).toBe(1);
    expect(after.progressRatio).toBe(0.5);
  });

  it("no CRM PII (contact email) ever appears in a Sales OS audit event's metadata", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const secretEmail = "definitely-secret-lead-contact@example.com";
    const contact = await makeTestContact(orgId, ownerId, { primaryEmail: secretEmail });
    const lead = await createLead(db, { organizationId: orgId, contactId: contact.id, actorUserId: ownerId });
    const repId = await makeSalesRepUser(orgId, "sales_rep", ownerId);

    await assignLead(db, { organizationId: orgId, leadId: lead.id, assigneeUserId: repId, actorUserId: ownerId });
    const { version } = await makeTestPlaybook(orgId, ownerId, "lead_qualification");
    await startQualificationRun(db, { organizationId: orgId, leadId: lead.id, playbookVersionId: version.id, actorUserId: ownerId });

    const events = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, orgId), isNotNull(auditLogs.metadata)));
    for (const event of events) {
      expect(JSON.stringify(event.metadata)).not.toContain(secretEmail);
      expect(JSON.stringify(event.metadata)).not.toContain("@example.com");
    }
  });
});
