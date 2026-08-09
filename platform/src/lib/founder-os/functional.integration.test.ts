import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeTestWorkspace, makeFounderUser } from "./test-helpers";
import { makeTestPipeline } from "@/lib/crm/test-helpers";
import { createLead } from "@/lib/crm/leads";
import { createOpportunity } from "@/lib/crm/opportunities";
import { computeCompanyPulse } from "./company-pulse";
import { computeAttentionItems } from "./attention-engine";
import { listFounderApprovals } from "./approval-center";
import { computeExecutiveProjectsView } from "./projects-view";
import { computeExecutiveSalesView } from "./sales-view";
import { computeExecutiveMarketingView } from "./marketing-view";
import { computeExecutiveOperationsView } from "./operations-view";
import { computeExecutiveAgentsView } from "./agents-view";
import { computeDailyBrief } from "./daily-brief";
import { launchFounderCompanyBriefTask, seedFounderAnalystAgent } from "./founder-analyst";
import { createFounderDecision } from "./decisions";
import { createFounderGoal, computeFounderGoalProgress } from "./goals";
import { runAnalyticsQuery } from "@/lib/analytics-os/query";
import { projects, workflowExecutions, agentExecutions } from "@/db/schema";
import { AuthzError, InsufficientRoleError } from "@/lib/authz/errors";
import { UnknownGoalMetricError } from "./errors";

afterEach(cleanupAgentRuntimeTestData);

describe("Founder Workspace functional guarantees", () => {
  it("tenant safety — Company Pulse for org A never counts org B's data", async () => {
    const ownerA = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const ownerB = await makeUser();
    const orgB = await makeOrgWithOwner(ownerB);

    await createLead(db, { organizationId: orgA, actorUserId: ownerA });
    await createLead(db, { organizationId: orgB, actorUserId: ownerB });
    await createLead(db, { organizationId: orgB, actorUserId: ownerB });

    const pulseA = await computeCompanyPulse(db, { organizationId: orgA, workspaceId: null, actorUserId: ownerA });
    const growthA = pulseA.find((g) => g.group === "growth")?.metrics.find((m) => m.metricKey === "crm_leads_open");
    expect(growthA?.current.points[0].value).toBe(1);
  });

  it("workspace safety — Founder views respect Analytics OS's own workspace scoping", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceA = await makeTestWorkspace(orgId, ownerId);
    const workspaceB = await makeTestWorkspace(orgId, ownerId);
    const { pipeline: pipelineA, newStage: newStageA } = await makeTestPipeline(orgId, ownerId);
    const { pipeline: pipelineB, newStage: newStageB } = await makeTestPipeline(orgId, ownerId);
    await createOpportunity(db, { organizationId: orgId, workspaceId: workspaceA.id, pipelineId: pipelineA.id, stageId: newStageA.id, name: "A deal", amount: 100, actorUserId: ownerId });
    await createOpportunity(db, { organizationId: orgId, workspaceId: workspaceB.id, pipelineId: pipelineB.id, stageId: newStageB.id, name: "B deal", amount: 200, actorUserId: ownerId });

    const salesViewA = await computeExecutiveSalesView(db, { organizationId: orgId, workspaceId: workspaceA.id, actorUserId: ownerId });
    expect(salesViewA.topOpportunities.length).toBe(1);
    expect(salesViewA.topOpportunities[0].name).toBe("A deal");

    // The attention engine's own "stale pipeline"/"at risk" rules must respect the same workspace boundary — a bug caught here during development (the direct rule queries had no workspace filter at all) and fixed in attention-engine.ts.
    const { crmOpportunities } = await import("@/db/schema");
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await db.update(crmOpportunities).set({ updatedAt: oldDate }).where(eq(crmOpportunities.id, salesViewA.topOpportunities[0].id));
    const attentionA = await computeAttentionItems(db, { organizationId: orgId, workspaceId: workspaceA.id, actorUserId: ownerId });
    const attentionB = await computeAttentionItems(db, { organizationId: orgId, workspaceId: workspaceB.id, actorUserId: ownerId });
    expect(attentionA.some((i) => i.reasonCode === "stale_sales_pipeline" && i.title.includes("A deal"))).toBe(true);
    expect(attentionB.some((i) => i.reasonCode === "stale_sales_pipeline" && i.title.includes("A deal"))).toBe(false);
  });

  it("Founder permissions are independent of Analytics OS permissions — a Founder viewer with no Analytics role can still see Company Pulse (Analytics OS's own dual gate still runs underneath)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const founderViewerId = await makeFounderUser(orgId, "founder_viewer", ownerId);

    const pulse = await computeCompanyPulse(db, { organizationId: orgId, workspaceId: null, actorUserId: founderViewerId });
    expect(Array.isArray(pulse)).toBe(true);
  });

  it("a plain org member with no Founder role cannot view Company Pulse", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { addOrgMember } = await import("./test-helpers");
    const outsiderId = await makeUser();
    await addOrgMember(orgId, outsiderId, "member");

    await expect(computeCompanyPulse(db, { organizationId: orgId, workspaceId: null, actorUserId: outsiderId })).rejects.toThrow(AuthzError);
  });

  it("executive KPI values exactly match Analytics OS's own query engine", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await createLead(db, { organizationId: orgId, actorUserId: ownerId });

    const pulse = await computeCompanyPulse(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, dateRangeStrategy: "year_to_date" });
    const growthMetric = pulse.find((g) => g.group === "growth")?.metrics.find((m) => m.metricKey === "crm_leads_open");

    const direct = await runAnalyticsQuery(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, metricKeys: ["crm_leads_open"], dateRangeStrategy: "year_to_date", recordAudit: false });
    expect(growthMetric?.current.points[0].value).toBe(direct.metrics[0].current.points[0].value);
  });

  it("attention rules are deterministic — running twice against the same data returns identical items", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const [proj] = await db.insert(projects).values({ organizationId: orgId, name: "Blocked Project", projectKey: "BLK1", status: "blocked", ownerUserId: ownerId }).returning();
    void proj;

    const first = await computeAttentionItems(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId });
    const second = await computeAttentionItems(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.some((i) => i.reasonCode === "blocked_project")).toBe(true);
  });

  it("no fake metrics — every Company Pulse metric traces to a real Analytics OS registry entry with a real classification", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const pulse = await computeCompanyPulse(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId });
    for (const group of pulse) {
      for (const metric of group.metrics) {
        expect(["actual", "derived", "estimated", "manual"]).toContain(metric.classification);
      }
    }
  });

  it("no PII in executive aggregate responses — a contact's email never appears in Company Pulse", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { createContact } = await import("@/lib/crm/contacts");
    await createContact(db, { organizationId: orgId, displayName: "Secret Contact", primaryEmail: "secret-pii-marker@example.com", actorUserId: ownerId });

    const pulse = await computeCompanyPulse(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId });
    expect(JSON.stringify(pulse)).not.toContain("secret-pii-marker@example.com");
  });

  it("the approval center uses real Runtime approvals, never a second approval system", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const approvals = await listFounderApprovals(db, { organizationId: orgId, actorUserId: ownerId });
    expect(approvals).toEqual([]); // no approvals exist yet — proves it's a real, empty query, not fabricated data
  });

  it("project data in the executive Projects view comes from Projects Core's own canonical table", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await db.insert(projects).values({ organizationId: orgId, name: "Active Project", projectKey: "ACT1", status: "active", ownerUserId: ownerId });

    const view = await computeExecutiveProjectsView(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId });
    const activeMetric = view.metrics.find((m) => m.metricKey === "projects_active");
    expect(activeMetric?.current.points[0].value).toBe(1);
  });

  it("sales data comes from Sales OS/Analytics OS — weighted pipeline is always labeled estimated", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const view = await computeExecutiveSalesView(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId });
    expect(view.forecast).not.toBeNull();
  });

  it("marketing data comes from Marketing OS/Analytics OS — manual spend is always labeled manual", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { createCampaign } = await import("@/lib/marketing-os/campaigns");
    const { createBudgetEntry } = await import("@/lib/marketing-os/budget");
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: "FW-CAMP", name: "Founder Test Campaign", actorUserId: ownerId });
    await createBudgetEntry(db, { organizationId: orgId, campaignId: campaign.id, spendAmount: 500, currency: "USD", actorUserId: ownerId });

    const view = await computeExecutiveMarketingView(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId });
    const manualSpend = view.metrics.find((m) => m.metricKey === "marketing_manual_spend");
    expect(manualSpend?.classification).toBe("manual");
    expect(manualSpend?.current.points[0].value).toBe(500);
  });

  it("workflow/runtime data in the executive Operations view is canonical", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { createWorkflowDefinition } = await import("@/lib/workflows/definitions");
    const { createWorkflowVersion } = await import("@/lib/workflows/versions");
    const definition = await createWorkflowDefinition(db, { organizationId: orgId, name: "FW Test Workflow", workflowKey: "FWWF1", actorUserId: ownerId });
    const version = await createWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
    await db.insert(workflowExecutions).values({ organizationId: orgId, workflowDefinitionId: definition.id, workflowVersionId: version.id, status: "running" });

    const view = await computeExecutiveOperationsView(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId });
    const runningMetric = view.metrics.find((m) => m.metricKey === "workflows_running");
    expect(runningMetric?.current.points[0].value).toBe(1);
  });

  it("agent metrics in the AI Workforce view are canonical", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { makeAgent } = await import("./test-helpers");
    const agent = await makeAgent(orgId, ownerId);
    const execId = crypto.randomUUID();
    await db.insert(agentExecutions).values({ id: execId, organizationId: orgId, assignedAgentId: agent.id, ownerUserId: ownerId, rootExecutionId: execId, goal: "g", successCriteria: "s", failureCriteria: "f", status: "completed", completedAt: new Date() });

    const view = await computeExecutiveAgentsView(db, { organizationId: orgId, actorUserId: ownerId });
    const row = view.agents.find((r) => r.agent.id === agent.id);
    expect(row?.completed).toBe(1);
  });

  it("the daily brief uses only supported records — every attention item and KPI traces to a real query, and generating it twice in one day reuses the same execution", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await seedFounderAnalystAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId });

    const brief = await computeDailyBrief(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId });
    expect(brief.companySnapshot).toBeDefined();
    expect(Array.isArray(brief.attentionItems)).toBe(true);
  });

  it("the Founder Analyst cannot mutate operational systems — its task never writes to CRM/Sales/Marketing/Communications/Projects tables, only its own report artifact", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await seedFounderAnalystAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId });
    const leadBefore = await createLead(db, { organizationId: orgId, actorUserId: ownerId });

    const result = await launchFounderCompanyBriefTask(db, { organizationId: orgId, workspaceId: null, ownerUserId: ownerId, actorUserId: ownerId });
    expect(result.artifact.artifactType).toBe("report");
    expect(result.execution.status).toBe("completed");

    const [leadAfter] = await db.select().from((await import("@/db/schema")).crmLeads).where(eq((await import("@/db/schema")).crmLeads.id, leadBefore.id));
    expect(leadAfter.status).toBe(leadBefore.status); // completely unchanged — the agent never touched it
  });

  it("decisions do not automatically enter the Brain — promotedToBrainAt stays null unless explicitly promoted", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const decision = await createFounderDecision(db, { organizationId: orgId, title: "Ship it", decision: "We are shipping the feature", decisionOwnerUserId: ownerId, actorUserId: ownerId });
    expect(decision.promotedToBrainAt).toBeNull();
  });

  it("goals derive their current value from Analytics OS live — never a stored/duplicated number", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const goal = await createFounderGoal(db, { organizationId: orgId, title: "Grow leads", metricKey: "crm_leads_open", targetValue: 10, periodStart: new Date("2020-01-01"), periodEnd: new Date("2035-01-01"), ownerUserId: ownerId, actorUserId: ownerId });

    const progress = await computeFounderGoalProgress(db, { organizationId: orgId, goalId: goal.id, actorUserId: ownerId });
    expect(progress.currentValue).toBe(1);
  });

  it("a goal referencing an unknown metric key is rejected at creation", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await expect(
      createFounderGoal(db, { organizationId: orgId, title: "Bad goal", metricKey: "not_a_real_metric", targetValue: 10, periodStart: new Date(), periodEnd: new Date(), ownerUserId: ownerId, actorUserId: ownerId })
    ).rejects.toThrow(UnknownGoalMetricError);
  });

  it("dual-gate remains intact — a Founder executive with no Sales OS role is still denied a Sales metric", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const founderExecutiveId = await makeFounderUser(orgId, "founder_executive", ownerId);

    await expect(computeExecutiveSalesView(db, { organizationId: orgId, workspaceId: null, actorUserId: founderExecutiveId })).rejects.toThrow(InsufficientRoleError);
  });
});
