import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeTestWorkspace, makeAnalyticsUser } from "./test-helpers";
import { makeTestPipeline } from "@/lib/crm/test-helpers";
import { createContact } from "@/lib/crm/contacts";
import { createOpportunity, moveOpportunityStage } from "@/lib/crm/opportunities";
import { createLead, qualifyLead } from "@/lib/crm/leads";
import { crmLeads } from "@/db/schema";
import { grantSalesRole } from "@/lib/sales-os/roles";
import { runAnalyticsQuery } from "./query";
import { runAnalyticsDrilldown } from "./drilldown";
import { computeCrmFunnel } from "./funnels";
import { computeExecutiveKpis } from "./kpis";
import { createSavedReport, runSavedReport } from "./reports";
import { AuthzError } from "@/lib/authz/errors";

afterEach(cleanupAgentRuntimeTestData);

const YEAR_RANGE = { dateRangeStrategy: "custom" as const, customFrom: new Date("2020-01-01"), customTo: new Date("2035-01-01") };

/** `convertLead` doesn't accept a workspaceId (the resulting opportunity always inherits the pipeline's own, which test pipelines don't set) — these workspace-isolation tests need a workspace-scoped WON opportunity, so they create the opportunity directly and link it to the lead by hand rather than going through the full conversion flow. */
async function linkLeadToOpportunity(leadId: string, opportunityId: string) {
  await db.update(crmLeads).set({ status: "converted", convertedAt: new Date(), convertedOpportunityId: opportunityId }).where(eq(crmLeads.id, leadId));
}

/**
 * Pre-Module-18 hardening: proves the fix for the identified gap (workspace
 * authorization succeeded while aggregate results still mixed in other
 * workspaces' data). Every test here seeds TWO real workspaces inside the
 * SAME organization and asserts a workspace-scoped query never returns the
 * other workspace's rows, an org-wide query returns both, and the one
 * documented exception (organization-scoped record types with no workspace
 * column, like CRM leads) is disclosed rather than silently narrowed.
 */
describe("Analytics OS workspace isolation hardening", () => {
  it("Workspace A analytics exclude Workspace B data, and Workspace B analytics exclude Workspace A data", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceA = await makeTestWorkspace(orgId, ownerId);
    const workspaceB = await makeTestWorkspace(orgId, ownerId);

    await createContact(db, { organizationId: orgId, workspaceId: workspaceA.id, displayName: "A Contact", actorUserId: ownerId });
    await createContact(db, { organizationId: orgId, workspaceId: workspaceB.id, displayName: "B Contact 1", actorUserId: ownerId });
    await createContact(db, { organizationId: orgId, workspaceId: workspaceB.id, displayName: "B Contact 2", actorUserId: ownerId });

    const resultA = await runAnalyticsQuery(db, { organizationId: orgId, workspaceId: workspaceA.id, actorUserId: ownerId, metricKeys: ["crm_contacts_total"], ...YEAR_RANGE });
    const resultB = await runAnalyticsQuery(db, { organizationId: orgId, workspaceId: workspaceB.id, actorUserId: ownerId, metricKeys: ["crm_contacts_total"], ...YEAR_RANGE });

    expect(resultA.metrics[0].current.points[0].value).toBe(1);
    expect(resultB.metrics[0].current.points[0].value).toBe(2);
  });

  it("organization-wide analytics include both workspaces for an authorized org-wide caller", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceA = await makeTestWorkspace(orgId, ownerId);
    const workspaceB = await makeTestWorkspace(orgId, ownerId);

    await createContact(db, { organizationId: orgId, workspaceId: workspaceA.id, displayName: "A Contact", actorUserId: ownerId });
    await createContact(db, { organizationId: orgId, workspaceId: workspaceB.id, displayName: "B Contact", actorUserId: ownerId });

    const orgWide = await runAnalyticsQuery(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, metricKeys: ["crm_contacts_total"], ...YEAR_RANGE });
    expect(orgWide.metrics[0].current.points[0].value).toBe(2);
  });

  it("CRM leads (an organization-scoped record type with no workspace column) stay organization-wide even under a workspace-scoped query — a disclosed exception, not leakage", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceA = await makeTestWorkspace(orgId, ownerId);
    await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    await createLead(db, { organizationId: orgId, actorUserId: ownerId });

    const scoped = await runAnalyticsQuery(db, { organizationId: orgId, workspaceId: workspaceA.id, actorUserId: ownerId, metricKeys: ["crm_leads_open"], ...YEAR_RANGE });
    const orgWide = await runAnalyticsQuery(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, metricKeys: ["crm_leads_open"], ...YEAR_RANGE });
    expect(scoped.metrics[0].current.points[0].value).toBe(2);
    expect(scoped.metrics[0].current.points[0].value).toBe(orgWide.metrics[0].current.points[0].value);
  });

  it("a workspace-scoped saved report cannot widen to organization scope — running it always returns only its own stored workspace's data", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceA = await makeTestWorkspace(orgId, ownerId);
    const workspaceB = await makeTestWorkspace(orgId, ownerId);
    await createContact(db, { organizationId: orgId, workspaceId: workspaceA.id, displayName: "A Contact", actorUserId: ownerId });
    await createContact(db, { organizationId: orgId, workspaceId: workspaceB.id, displayName: "B Contact 1", actorUserId: ownerId });
    await createContact(db, { organizationId: orgId, workspaceId: workspaceB.id, displayName: "B Contact 2", actorUserId: ownerId });

    const report = await createSavedReport(db, {
      organizationId: orgId,
      workspaceId: workspaceA.id,
      actorUserId: ownerId,
      name: "Workspace A contacts",
      metricKeys: ["crm_contacts_total"],
      dateRangeStrategy: "custom",
      customStartDate: YEAR_RANGE.customFrom,
      customEndDate: YEAR_RANGE.customTo,
      comparisonEnabled: false,
      timeGrain: "day",
      visualization: "kpi_card",
      visibility: "private",
    });

    const { result } = await runSavedReport(db, { organizationId: orgId, actorUserId: ownerId, reportId: report.id });
    expect(result.metrics[0].current.points[0].value).toBe(1); // workspace A's own single contact, never B's 2
  });

  it("a workspace-scoped drill-down cannot cross into another workspace", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceA = await makeTestWorkspace(orgId, ownerId);
    const workspaceB = await makeTestWorkspace(orgId, ownerId);
    const { pipeline: pipelineA, newStage: newStageA } = await makeTestPipeline(orgId, ownerId);
    const { pipeline: pipelineB, newStage: newStageB } = await makeTestPipeline(orgId, ownerId);

    const oppA = await createOpportunity(db, { organizationId: orgId, workspaceId: workspaceA.id, pipelineId: pipelineA.id, stageId: newStageA.id, name: "A deal", expectedCloseDate: new Date("2020-06-01"), actorUserId: ownerId });
    await createOpportunity(db, { organizationId: orgId, workspaceId: workspaceB.id, pipelineId: pipelineB.id, stageId: newStageB.id, name: "B deal", expectedCloseDate: new Date("2020-06-01"), actorUserId: ownerId });

    const drilldownA = await runAnalyticsDrilldown(db, { organizationId: orgId, workspaceId: workspaceA.id, actorUserId: ownerId, metricKey: "sales_opportunities_at_risk", from: YEAR_RANGE.customFrom, to: YEAR_RANGE.customTo });
    expect(drilldownA.ids).toEqual([oppA.id]);
  });

  it("funnels remain workspace-safe — a won opportunity outside the requested workspace is never counted", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceA = await makeTestWorkspace(orgId, ownerId);
    const workspaceB = await makeTestWorkspace(orgId, ownerId);
    const { pipeline: pipelineA, newStage: newStageA, wonStage: wonStageA } = await makeTestPipeline(orgId, ownerId);
    const { pipeline: pipelineB, newStage: newStageB, wonStage: wonStageB } = await makeTestPipeline(orgId, ownerId);

    const leadA = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    await qualifyLead(db, { organizationId: orgId, leadId: leadA.id, expectedRevision: leadA.revision, actorUserId: ownerId });
    const oppA = await createOpportunity(db, { organizationId: orgId, workspaceId: workspaceA.id, pipelineId: pipelineA.id, stageId: newStageA.id, name: "A deal", amount: 100, actorUserId: ownerId });
    await linkLeadToOpportunity(leadA.id, oppA.id);
    await moveOpportunityStage(db, { organizationId: orgId, opportunityId: oppA.id, targetStageId: wonStageA.id, expectedRevision: 1, actorUserId: ownerId });

    const leadB = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    await qualifyLead(db, { organizationId: orgId, leadId: leadB.id, expectedRevision: leadB.revision, actorUserId: ownerId });
    const oppB = await createOpportunity(db, { organizationId: orgId, workspaceId: workspaceB.id, pipelineId: pipelineB.id, stageId: newStageB.id, name: "B deal", amount: 200, actorUserId: ownerId });
    await linkLeadToOpportunity(leadB.id, oppB.id);
    await moveOpportunityStage(db, { organizationId: orgId, opportunityId: oppB.id, targetStageId: wonStageB.id, expectedRevision: 1, actorUserId: ownerId });

    const funnelA = await computeCrmFunnel({ db, organizationId: orgId, workspaceId: workspaceA.id, from: YEAR_RANGE.customFrom, to: YEAR_RANGE.customTo, actorUserId: ownerId });
    expect(funnelA.stages.find((s) => s.key === "opportunity_won")!.count).toBe(1);
  });

  it("executive KPIs remain workspace-safe", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceA = await makeTestWorkspace(orgId, ownerId);
    const workspaceB = await makeTestWorkspace(orgId, ownerId);
    const { pipeline: pipelineA, newStage: newStageA } = await makeTestPipeline(orgId, ownerId);
    const { pipeline: pipelineB, newStage: newStageB } = await makeTestPipeline(orgId, ownerId);
    await createOpportunity(db, { organizationId: orgId, workspaceId: workspaceA.id, pipelineId: pipelineA.id, stageId: newStageA.id, name: "A deal", actorUserId: ownerId });
    await createOpportunity(db, { organizationId: orgId, workspaceId: workspaceB.id, pipelineId: pipelineB.id, stageId: newStageB.id, name: "B deal 1", actorUserId: ownerId });
    await createOpportunity(db, { organizationId: orgId, workspaceId: workspaceB.id, pipelineId: pipelineB.id, stageId: newStageB.id, name: "B deal 2", actorUserId: ownerId });

    const kpisA = await computeExecutiveKpis(db, { organizationId: orgId, workspaceId: workspaceA.id, actorUserId: ownerId, dateRangeStrategy: "year_to_date", recordAudit: false });
    const openOppMetricA = kpisA.find((g) => g.group === "sales")?.metrics.find((m) => m.metricKey === "crm_opportunities_open");
    expect(openOppMetricA?.current.points[0].value).toBe(1);

    const kpisB = await computeExecutiveKpis(db, { organizationId: orgId, workspaceId: workspaceB.id, actorUserId: ownerId, dateRangeStrategy: "year_to_date", recordAudit: false });
    const openOppMetricB = kpisB.find((g) => g.group === "sales")?.metrics.find((m) => m.metricKey === "crm_opportunities_open");
    expect(openOppMetricB?.current.points[0].value).toBe(2);
  }, 45000); // computeExecutiveKpis issues one real query per metric across every KPI group, twice (once per workspace) — genuinely many sequential Neon round trips, the same narrow per-test timeout relief already applied elsewhere in this module for equally Runtime/DB-round-trip-heavy tests.

  it("the CRM/Sales/Marketing/Communications dual-gate behavior remains intact after workspace hardening — Analytics/workspace access alone still never substitutes for Sales OS's own view authority", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceA = await makeTestWorkspace(orgId, ownerId);
    // An Analytics admin — passes the CENTRAL `analytics_view`/`analytics_view_sales` gate outright — but never granted a Sales OS role of their own.
    const analyticsAdminId = await makeAnalyticsUser(orgId, "analytics_admin", ownerId);
    void grantSalesRole; // Sales role intentionally NOT granted — proves the SOURCE-MODULE dual gate, not the central Analytics capability, is what actually blocks this call.

    await expect(runAnalyticsQuery(db, { organizationId: orgId, workspaceId: workspaceA.id, actorUserId: analyticsAdminId, metricKeys: ["sales_pipeline_weighted_value"], ...YEAR_RANGE })).rejects.toThrow(AuthzError);
  });
});
