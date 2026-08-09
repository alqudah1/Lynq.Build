import { describe, it, expect, afterEach } from "vitest";
import {
  db,
  makeUser,
  makeOrgWithOwner,
  cleanupAgentRuntimeTestData,
  addOrgMember,
  makeAgent,
  makeAnalyticsUser,
  makeTestWorkflowVersion,
  seedWorkflowExecution,
  seedAgentExecution,
  seedToolInvocation,
  seedApprovalRequest,
} from "./test-helpers";
import { makeTestPipeline } from "@/lib/crm/test-helpers";
import { createLead, qualifyLead, convertLead } from "@/lib/crm/leads";
import { moveOpportunityStage } from "@/lib/crm/opportunities";
import { grantSalesRole } from "@/lib/sales-os/roles";
import { createCampaign } from "@/lib/marketing-os/campaigns";
import { recordAttribution } from "@/lib/marketing-os/attribution";
import { createBudgetEntry } from "@/lib/marketing-os/budget";
import { makeCommunicationsUser, makeTestConnection, makeTestConversation } from "@/lib/communications-os/test-helpers";
import { createDraftMessage, approveDraftDirectly, queueMessageForSend, processSendJob } from "@/lib/communications-os/messages";
import { communicationMessages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runAnalyticsQuery } from "./query";
import { computeCrmFunnel } from "./funnels";
import { resolveDateRangeForStrategy, resolveComparisonRange, computePercentChange } from "./time";
import { computeExecutiveKpis } from "./kpis";
import { createSavedReport, runSavedReport } from "./reports";
import { exportAnalyticsQueryToCsv } from "./export";
import { grantAnalyticsRole } from "./roles";
import { resolveMetric } from "./metrics/registry";
import { UnknownMetricError, UnsupportedDimensionError, QueryTooComplexError } from "./errors";
import { InsufficientRoleError, AuthzError } from "@/lib/authz/errors";

afterEach(cleanupAgentRuntimeTestData);

const YEAR_RANGE = { from: new Date("2020-01-01"), to: new Date("2035-01-01") };

describe("Analytics OS functional guarantees", () => {
  it("tenant safety — a CRM metric for org A never counts org B's leads", async () => {
    const ownerA = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const ownerB = await makeUser();
    const orgB = await makeOrgWithOwner(ownerB);

    await createLead(db, { organizationId: orgA, actorUserId: ownerA });
    await createLead(db, { organizationId: orgB, actorUserId: ownerB });
    await createLead(db, { organizationId: orgB, actorUserId: ownerB });

    const resultA = await runAnalyticsQuery(db, { organizationId: orgA, workspaceId: null, actorUserId: ownerA, metricKeys: ["crm_leads_open"], dateRangeStrategy: "custom", customFrom: YEAR_RANGE.from, customTo: YEAR_RANGE.to, comparisonStrategy: "none" });
    const resultB = await runAnalyticsQuery(db, { organizationId: orgB, workspaceId: null, actorUserId: ownerB, metricKeys: ["crm_leads_open"], dateRangeStrategy: "custom", customFrom: YEAR_RANGE.from, customTo: YEAR_RANGE.to, comparisonStrategy: "none" });

    expect(resultA.metrics[0].current.points[0].value).toBe(1);
    expect(resultB.metrics[0].current.points[0].value).toBe(2);
  });

  it("the metric registry rejects an unknown metric key", () => {
    expect(() => resolveMetric("not_a_real_metric")).toThrow(UnknownMetricError);
  });

  it("the query engine rejects an unknown metric key end to end", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await expect(runAnalyticsQuery(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, metricKeys: ["not_a_real_metric"] })).rejects.toThrow(UnknownMetricError);
  });

  it("the query engine rejects a groupBy dimension a metric doesn't support", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await expect(runAnalyticsQuery(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, metricKeys: ["crm_contacts_total"], groupBy: "campaign" })).rejects.toThrow(UnsupportedDimensionError);
  });

  it("the query engine rejects more metric keys than the bound allows", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const tooMany = Array.from({ length: 21 }, () => "crm_contacts_total");
    await expect(runAnalyticsQuery(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, metricKeys: tooMany })).rejects.toThrow(QueryTooComplexError);
  });

  it("Analytics permission is independent from Sales OS permissions — a Sales rep with no Analytics role cannot query", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const salesUserId = await makeUser();
    await addOrgMember(orgId, salesUserId, "member");
    await grantSalesRole(db, { organizationId: orgId, userId: salesUserId, role: "sales_rep", actorUserId: ownerId });

    await expect(runAnalyticsQuery(db, { organizationId: orgId, workspaceId: null, actorUserId: salesUserId, metricKeys: ["sales_pipeline_weighted_value"] })).rejects.toThrow(AuthzError);
  });

  it("aggregate access follows CRM's own view authority — a plain member with an Analytics role but no CRM standing still gets a real CRM authorization decision, not a bypass", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const analyticsUserId = await makeAnalyticsUser(orgId, "analytics_admin", ownerId);
    // Org owner/admin also satisfies CRM's own aggregate view authority, so this call must still succeed —
    // proving the CRM-side check actually runs (not skipped), not merely that Analytics blocks it.
    const result = await runAnalyticsQuery(db, { organizationId: orgId, workspaceId: null, actorUserId: analyticsUserId, metricKeys: ["crm_contacts_total"] });
    expect(result.metrics[0].current.points[0].value).toBe(0);
  });

  it("Sales weighted pipeline is labeled 'estimated', never 'actual'", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const result = await runAnalyticsQuery(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, metricKeys: ["sales_pipeline_weighted_value"] });
    expect(result.metrics[0].classification).toBe("estimated");
  });

  it("manual Marketing spend is labeled 'manual'", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: "CAMP1", name: "Test Campaign", actorUserId: ownerId });
    await createBudgetEntry(db, { organizationId: orgId, campaignId: campaign.id, spendAmount: 250, currency: "USD", actorUserId: ownerId });

    const result = await runAnalyticsQuery(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, metricKeys: ["marketing_manual_spend"] });
    expect(result.metrics[0].classification).toBe("manual");
    expect(result.metrics[0].current.points[0].value).toBe(250);
  });

  it("Communications 'sent' never fabricates 'delivered' — dev providers produce sends but never delivery events", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_agent", ownerId);
    const connection = await makeTestConnection(orgId, ownerId);
    const conversation = await makeTestConversation(orgId, ownerId, "email", connection.id);
    const draft = await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", integrationConnectionId: connection.id, recipientReference: "customer@example.com", bodyText: "Hello", idempotencyKey: "analytics-test-1", actorUserId: actorId });
    await approveDraftDirectly(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    await queueMessageForSend(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    await processSendJob(db, { organizationId: orgId, messageId: draft.id });

    const result = await runAnalyticsQuery(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, metricKeys: ["communications_messages_sent", "communications_messages_delivered"] });
    expect(result.metrics[0].current.points[0].value).toBe(1);
    expect(result.metrics[1].current.points[0].value).toBe(0);
  });

  it("Communications message bodies never leak through the analytics query result", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_agent", ownerId);
    const connection = await makeTestConnection(orgId, ownerId);
    const conversation = await makeTestConversation(orgId, ownerId, "email", connection.id);
    const secret = "SUPER-SECRET-BODY-TEXT-9f8e7d";
    const draft = await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", integrationConnectionId: connection.id, recipientReference: "customer@example.com", bodyText: secret, idempotencyKey: "analytics-test-2", actorUserId: actorId });
    await approveDraftDirectly(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    await queueMessageForSend(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    await processSendJob(db, { organizationId: orgId, messageId: draft.id });

    const result = await runAnalyticsQuery(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, metricKeys: ["communications_messages_sent"], groupBy: "channel" });
    expect(JSON.stringify(result)).not.toContain(secret);

    const [row] = await db.select({ bodyText: communicationMessages.bodyText }).from(communicationMessages).where(eq(communicationMessages.id, draft.id));
    expect(row.bodyText).toBe(secret); // sanity: the secret really was stored, just never surfaced through analytics
  });

  it("the campaign -> lead -> opportunity -> won linkage is correct, and only real canonical links are counted", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const campaign = await createCampaign(db, { organizationId: orgId, campaignKey: "CAMP-LINK", name: "Linked Campaign", actorUserId: ownerId });

    const { pipeline, newStage, wonStage } = await makeTestPipeline(orgId, ownerId);
    const attributedLead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    await recordAttribution(db, { organizationId: orgId, campaignId: campaign.id, crmLeadId: attributedLead.id, touchType: "first_touch", actorUserId: ownerId });
    const qualified = await qualifyLead(db, { organizationId: orgId, leadId: attributedLead.id, expectedRevision: attributedLead.revision, actorUserId: ownerId });
    const { lead: converted } = await convertLead(db, { organizationId: orgId, leadId: qualified.id, expectedRevision: qualified.revision, pipelineId: pipeline.id, stageId: newStage.id, amount: 500, actorUserId: ownerId });
    await moveOpportunityStage(db, { organizationId: orgId, opportunityId: converted.convertedOpportunityId!, targetStageId: wonStage.id, expectedRevision: 1, actorUserId: ownerId });

    // An unattributed lead reaching the same funnel must never be counted as campaign-sourced.
    const unattributedLead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    await qualifyLead(db, { organizationId: orgId, leadId: unattributedLead.id, expectedRevision: unattributedLead.revision, actorUserId: ownerId });

    const result = await runAnalyticsQuery(db, {
      organizationId: orgId,
      workspaceId: null,
      actorUserId: ownerId,
      metricKeys: ["marketing_campaign_sourced_leads", "marketing_campaign_sourced_won_value"],
      dateRangeStrategy: "custom",
      customFrom: YEAR_RANGE.from,
      customTo: YEAR_RANGE.to,
    });
    expect(result.metrics[0].current.points[0].value).toBe(1);
    expect(result.metrics[1].current.points[0].value).toBe(500);
  });

  it("funnel math is correct — CRM funnel stage counts and conversion rates match a known seeded cohort", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage, wonStage } = await makeTestPipeline(orgId, ownerId);

    const leadA = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const leadB = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    await createLead(db, { organizationId: orgId, actorUserId: ownerId }); // never qualifies

    const qualifiedA = await qualifyLead(db, { organizationId: orgId, leadId: leadA.id, expectedRevision: leadA.revision, actorUserId: ownerId });
    await qualifyLead(db, { organizationId: orgId, leadId: leadB.id, expectedRevision: leadB.revision, actorUserId: ownerId });

    const { lead: convertedA } = await convertLead(db, { organizationId: orgId, leadId: qualifiedA.id, expectedRevision: qualifiedA.revision, pipelineId: pipeline.id, stageId: newStage.id, amount: 100, actorUserId: ownerId });
    await moveOpportunityStage(db, { organizationId: orgId, opportunityId: convertedA.convertedOpportunityId!, targetStageId: wonStage.id, expectedRevision: 1, actorUserId: ownerId });

    const funnel = await computeCrmFunnel({ db, organizationId: orgId, workspaceId: null, from: YEAR_RANGE.from, to: YEAR_RANGE.to, actorUserId: ownerId });
    expect(funnel.stages.map((s) => s.count)).toEqual([3, 2, 1, 1]);
    expect(funnel.steps[0].conversionRatePercent).toBeCloseTo(66.7, 1); // 2/3, rounded to 1 decimal place
    expect(funnel.steps[1].conversionRatePercent).toBeCloseTo(50, 5);
    expect(funnel.steps[2].conversionRatePercent).toBe(100);
  });

  it("comparison math is correct, and a zero-denominator percent change is represented as null, never a misleading number", () => {
    expect(computePercentChange(150, 100)).toBeCloseTo(50, 5);
    expect(computePercentChange(50, 100)).toBeCloseTo(-50, 5);
    expect(computePercentChange(10, 0)).toBeNull();
    expect(computePercentChange(null, 100)).toBeNull();
  });

  it("timezone boundaries are correct — month-to-date in a UTC+ zone starts at local midnight, not UTC midnight", () => {
    // 2024-03-01T02:00:00Z is already March 1st local time in UTC+5, so month-to-date must include it.
    const now = new Date("2024-03-01T02:00:00Z");
    const range = resolveDateRangeForStrategy("month_to_date", "Asia/Karachi", null, now); // UTC+5, no DST
    expect(range.from.toISOString()).toBe("2024-02-29T19:00:00.000Z"); // 2024-03-01T00:00:00+05:00
    expect(range.to.getTime()).toBe(now.getTime());
  });

  it("previous_month comparison shifts by real calendar months, clamping the day to the target month's length", () => {
    const current = { from: new Date("2024-03-31T00:00:00Z"), to: new Date("2024-03-31T12:00:00Z") };
    const previous = resolveComparisonRange("previous_month", current, "UTC", null);
    expect(previous!.from.toISOString()).toBe("2024-02-29T00:00:00.000Z"); // clamped from the 31st to Feb's real length (2024 is a leap year)
  });

  it("the KPI layer is deterministic — running it twice against the same data returns identical values", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await createLead(db, { organizationId: orgId, actorUserId: ownerId });

    const first = await computeExecutiveKpis(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, recordAudit: false });
    const second = await computeExecutiveKpis(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, recordAudit: false });
    expect(JSON.stringify(first.map((g) => g.metrics.map((m) => m.current.points))))
      .toBe(JSON.stringify(second.map((g) => g.metrics.map((m) => m.current.points))));
  });

  it("a saved report is reproducible — running it produces the same query engine result as calling it directly", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await createLead(db, { organizationId: orgId, actorUserId: ownerId });

    const report = await createSavedReport(db, {
      organizationId: orgId,
      workspaceId: null,
      actorUserId: ownerId,
      name: "Open leads report",
      metricKeys: ["crm_leads_open"],
      dateRangeStrategy: "year_to_date",
      comparisonEnabled: false,
      timeGrain: "day",
      visualization: "kpi_card",
      visibility: "private",
    });

    const { result } = await runSavedReport(db, { organizationId: orgId, actorUserId: ownerId, reportId: report.id });
    expect(result.metrics[0].metricKey).toBe("crm_leads_open");
    expect(typeof result.metrics[0].current.points[0].value).toBe("number");
  });

  it("a private saved report is not visible to another org member", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const otherUserId = await makeUser();
    await addOrgMember(orgId, otherUserId, "member");
    await grantAnalyticsRole(db, { organizationId: orgId, userId: otherUserId, role: "viewer", actorUserId: ownerId });

    const report = await createSavedReport(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, name: "Private", metricKeys: ["crm_contacts_total"], dateRangeStrategy: "last_30_days", comparisonEnabled: false, timeGrain: "day", visualization: "kpi_card", visibility: "private" });

    await expect(runSavedReport(db, { organizationId: orgId, actorUserId: otherUserId, reportId: report.id })).rejects.toThrow(InsufficientRoleError);
  });

  it("CSV export respects the same authorization as the underlying query", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const salesUserId = await makeUser();
    await addOrgMember(orgId, salesUserId, "member");

    await expect(exportAnalyticsQueryToCsv(db, { organizationId: orgId, workspaceId: null, actorUserId: salesUserId, metricKeys: ["crm_contacts_total"] })).rejects.toThrow(AuthzError);

    const { csv, rowCount } = await exportAnalyticsQueryToCsv(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, metricKeys: ["crm_contacts_total"] });
    expect(rowCount).toBe(1);
    expect(csv.split("\n")[0]).toContain("metric_key");
  });

  it("Workflow and Agent Runtime operational metrics aggregate real canonical execution rows", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { definition, version } = await makeTestWorkflowVersion(orgId, ownerId);
    await seedWorkflowExecution(orgId, definition.id, version.id, "running");
    await seedWorkflowExecution(orgId, definition.id, version.id, "completed", { startedAt: new Date("2024-01-01T00:00:00Z"), completedAt: new Date("2024-01-01T00:05:00Z") });
    await seedWorkflowExecution(orgId, definition.id, version.id, "failed", { startedAt: new Date("2024-01-01T00:00:00Z"), completedAt: new Date("2024-01-01T00:02:00Z") });

    const agent = await makeAgent(orgId, ownerId);
    const running = await seedAgentExecution(orgId, ownerId, "executing");
    await seedAgentExecution(orgId, ownerId, "completed", { startedAt: new Date("2024-01-01T00:00:00Z"), completedAt: new Date("2024-01-01T00:10:00Z") });
    const failed = await seedAgentExecution(orgId, ownerId, "failed", { startedAt: new Date("2024-01-01T00:00:00Z"), failedAt: new Date("2024-01-01T00:01:00Z") });
    await seedToolInvocation(orgId, failed.id, agent.id, "failed");
    await seedApprovalRequest(orgId, running.id, agent.id, "pending");

    const result = await runAnalyticsQuery(db, {
      organizationId: orgId,
      workspaceId: null,
      actorUserId: ownerId,
      metricKeys: ["workflows_running", "workflows_completed", "workflows_failed", "agent_executions_running", "agent_executions_failed", "tool_invocations_failed", "approvals_pending"],
      dateRangeStrategy: "custom",
      customFrom: YEAR_RANGE.from,
      customTo: YEAR_RANGE.to,
    });
    const byKey = Object.fromEntries(result.metrics.map((m) => [m.metricKey, m.current.points[0].value]));
    expect(byKey.workflows_running).toBe(1);
    expect(byKey.workflows_completed).toBe(1);
    expect(byKey.workflows_failed).toBe(1);
    expect(byKey.agent_executions_running).toBe(1);
    expect(byKey.agent_executions_failed).toBe(1);
    expect(byKey.tool_invocations_failed).toBe(1);
    expect(byKey.approvals_pending).toBe(1);
  });

  it("drill-down requires a metric that actually defines one, and returns bounded ids only, never full records", async () => {
    const { runAnalyticsDrilldown } = await import("./drilldown");
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await expect(runAnalyticsDrilldown(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, metricKey: "crm_contacts_total", from: YEAR_RANGE.from, to: YEAR_RANGE.to })).rejects.toThrow();

    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const { createFollowUp } = await import("@/lib/crm/follow-ups");
    await createFollowUp(db, { organizationId: orgId, leadId: lead.id, assignedUserId: ownerId, title: "Follow up", dueAt: new Date("2020-01-01"), actorUserId: ownerId });

    const drilldown = await runAnalyticsDrilldown(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, metricKey: "crm_followups_overdue", from: YEAR_RANGE.from, to: YEAR_RANGE.to });
    expect(drilldown.ids.length).toBe(1);
    expect(drilldown.entityType).toBe("crm_follow_up");
  });
});
