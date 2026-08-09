import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { and, eq, lt, isNotNull, gte, lte, sql, count, desc } from "drizzle-orm";
import {
  crmOpportunities,
  crmFollowUps,
  projects,
  projectMilestones,
  workflowExecutions,
  runtimeJobs,
  agentApprovalRequests,
  agentExecutions,
  marketingCampaigns,
  marketingContentItems,
  communicationMessages,
  communicationConversations,
  integrationConnections,
  salesTargets,
} from "@/db/schema";
import { resolveCrmAuthContext, requireCrmViewAuthority } from "@/lib/crm/authz";
import { resolveSalesAuthContext, requireSalesViewAuthority } from "@/lib/sales-os/authz";
import { resolveMarketingAuthContext, requireMarketingViewAuthority } from "@/lib/marketing-os/authz";
import { resolveCommunicationAuthContext, requireCommunicationsViewAuthority } from "@/lib/communications-os/authz";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { workspaceScopeCondition } from "@/lib/analytics-os/query-support";
import { resolveFounderAuthContext, requireFounderViewAuthority, hasFounderCapability } from "./authz";
import { MAX_ATTENTION_ITEMS } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export type AttentionSeverity = "info" | "attention" | "urgent";

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  domain: "crm" | "sales" | "marketing" | "delivery" | "operations" | "communications" | "agents";
  reasonCode: string;
  title: string;
  explanation: string;
  recordType: string;
  recordId: string;
  dueAt: string | null;
  recommendedActionType: string;
  drilldown: { metricKey: string | null; recordType: string; recordId: string };
}

const SEVERITY_WEIGHT: Record<AttentionSeverity, number> = { urgent: 3, attention: 2, info: 1 };

interface EngineContext {
  db: Db;
  organizationId: string;
  workspaceId: string | null;
  actorUserId: string;
  now: Date;
}

/**
 * ============================================================================
 * Executive attention engine — Module 18
 * ============================================================================
 * NOT LLM reasoning — a fixed, deterministic set of rule functions, each
 * reading one real canonical table with a fixed threshold. Every item names
 * the real record behind it (never an opaque score). Each rule
 * independently re-checks its own SOURCE module's aggregate-safe view
 * authority (the identical dual gate every Analytics OS metric already
 * uses) — a caller missing one domain's authority simply loses that
 * domain's rules, never a hard failure for the whole engine.
 *
 * Workspace scope: every rule applies the identical `workspaceScopeCondition`
 * policy Analytics OS's own workspace-isolation hardening established (see
 * `MODULE_17_ANALYTICS_WORKSPACE_ISOLATION.md`) — a workspace-scoped query
 * only ever includes that workspace's own tagged rows, joining to a parent
 * table for record types with no `workspaceId` column of their own. CRM
 * follow-ups are the one documented exception: they carry no workspace
 * column anywhere in the chain, so `overdue_critical_follow_up` items stay
 * organization-wide even under a workspace-scoped query — consistent with
 * CRM leads/follow-ups' own established organization-scoped-by-design
 * status.
 */
async function crmRules(ctx: EngineContext): Promise<AttentionItem[]> {
  const crmCtx = await resolveCrmAuthContext(ctx.db, { organizationId: ctx.organizationId, workspaceId: ctx.workspaceId, actorUserId: ctx.actorUserId });
  await requireCrmViewAuthority(ctx.db, crmCtx, "crm_opportunity", "founder_attention");

  const items: AttentionItem[] = [];

  // CRM follow-ups have no `workspaceId` column anywhere in their chain — organization-wide by data model (see module doc comment above).
  const overdueFollowUps = await ctx.db
    .select({ id: crmFollowUps.id, title: crmFollowUps.title, dueAt: crmFollowUps.dueAt, priority: crmFollowUps.priority })
    .from(crmFollowUps)
    .where(and(eq(crmFollowUps.organizationId, ctx.organizationId), eq(crmFollowUps.status, "open"), isNotNull(crmFollowUps.dueAt), lt(crmFollowUps.dueAt, ctx.now), sql`${crmFollowUps.priority} IN ('high','urgent')`))
    .orderBy(crmFollowUps.dueAt)
    .limit(20);
  for (const row of overdueFollowUps) {
    items.push({
      id: `crm_followup_overdue:${row.id}`,
      severity: "urgent",
      domain: "crm",
      reasonCode: "overdue_critical_follow_up",
      title: `Overdue ${row.priority}-priority follow-up: ${row.title}`,
      explanation: `This follow-up was due ${row.dueAt!.toISOString().slice(0, 10)} and is still open.`,
      recordType: "crm_follow_up",
      recordId: row.id,
      dueAt: row.dueAt!.toISOString(),
      recommendedActionType: "complete_or_reassign_follow_up",
      drilldown: { metricKey: "crm_followups_overdue", recordType: "crm_follow_up", recordId: row.id },
    });
  }

  return items;
}

async function salesRules(ctx: EngineContext): Promise<AttentionItem[]> {
  const salesCtx = await resolveSalesAuthContext(ctx.db, { organizationId: ctx.organizationId, actorUserId: ctx.actorUserId });
  await requireSalesViewAuthority(ctx.db, salesCtx, "crm_opportunity", "founder_attention");

  const items: AttentionItem[] = [];
  const opportunityWorkspace = workspaceScopeCondition(crmOpportunities.workspaceId, ctx.workspaceId);

  const atRiskOpps = await ctx.db
    .select({ id: crmOpportunities.id, name: crmOpportunities.name, amount: crmOpportunities.amount, expectedCloseDate: crmOpportunities.expectedCloseDate, updatedAt: crmOpportunities.updatedAt })
    .from(crmOpportunities)
    .where(and(eq(crmOpportunities.organizationId, ctx.organizationId), eq(crmOpportunities.status, "open"), isNotNull(crmOpportunities.expectedCloseDate), lt(crmOpportunities.expectedCloseDate, ctx.now), isNotNull(crmOpportunities.amount), opportunityWorkspace))
    .orderBy(desc(crmOpportunities.amount))
    .limit(10);
  for (const row of atRiskOpps) {
    items.push({
      id: `sales_opp_at_risk:${row.id}`,
      severity: "urgent",
      domain: "sales",
      reasonCode: "high_value_opportunity_at_risk",
      title: `${row.name} is past its expected close date`,
      explanation: `Amount ${row.amount ?? "—"}, expected to close ${row.expectedCloseDate!.toISOString().slice(0, 10)}.`,
      recordType: "crm_opportunity",
      recordId: row.id,
      dueAt: row.expectedCloseDate!.toISOString(),
      recommendedActionType: "review_opportunity",
      drilldown: { metricKey: "sales_opportunities_at_risk", recordType: "crm_opportunity", recordId: row.id },
    });
  }

  const staleThreshold = new Date(ctx.now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const stalePipeline = await ctx.db
    .select({ id: crmOpportunities.id, name: crmOpportunities.name, updatedAt: crmOpportunities.updatedAt })
    .from(crmOpportunities)
    .where(and(eq(crmOpportunities.organizationId, ctx.organizationId), eq(crmOpportunities.status, "open"), lt(crmOpportunities.updatedAt, staleThreshold), opportunityWorkspace))
    .orderBy(crmOpportunities.updatedAt)
    .limit(10);
  for (const row of stalePipeline) {
    items.push({
      id: `sales_stale_pipeline:${row.id}`,
      severity: "info",
      domain: "sales",
      reasonCode: "stale_sales_pipeline",
      title: `${row.name} has had no recorded update in 14+ days`,
      explanation: `Last updated ${row.updatedAt.toISOString().slice(0, 10)} — a real proxy for staleness (last write to the record), not a richer activity-recency signal.`,
      recordType: "crm_opportunity",
      recordId: row.id,
      dueAt: null,
      recommendedActionType: "review_opportunity",
      drilldown: { metricKey: "crm_opportunities_open", recordType: "crm_opportunity", recordId: row.id },
    });
  }

  const targets = await ctx.db
    .select({ id: salesTargets.id, targetValue: salesTargets.targetValue, periodStart: salesTargets.periodStart, periodEnd: salesTargets.periodEnd })
    .from(salesTargets)
    .where(and(eq(salesTargets.organizationId, ctx.organizationId), lte(salesTargets.periodStart, ctx.now), gte(salesTargets.periodEnd, ctx.now), workspaceScopeCondition(salesTargets.workspaceId, ctx.workspaceId)));
  for (const target of targets) {
    const totalMs = target.periodEnd.getTime() - target.periodStart.getTime();
    const elapsedMs = ctx.now.getTime() - target.periodStart.getTime();
    const expectedProgress = totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 0;
    // A real, bounded proxy actual value (won opportunity value in-period) — never the full computeTargetProgress team-resolution machinery, to keep this rule a single query; the Sales executive view uses the full real function for the authoritative number.
    const [wonRow] = await ctx.db
      .select({ value: sql<number>`coalesce(sum(${crmOpportunities.amount}), 0)::float` })
      .from(crmOpportunities)
      .where(and(eq(crmOpportunities.organizationId, ctx.organizationId), eq(crmOpportunities.status, "won"), isNotNull(crmOpportunities.wonAt), gte(crmOpportunities.wonAt, target.periodStart), lte(crmOpportunities.wonAt, target.periodEnd), opportunityWorkspace));
    const actualProgress = Number(target.targetValue) > 0 ? wonRow.value / Number(target.targetValue) : 0;
    if (expectedProgress > 0.25 && actualProgress < expectedProgress - 0.25) {
      items.push({
        id: `sales_target_behind:${target.id}`,
        severity: "attention",
        domain: "sales",
        reasonCode: "target_far_behind_schedule",
        title: "A Sales target is significantly behind schedule",
        explanation: `${Math.round(actualProgress * 100)}% of target reached with ${Math.round(expectedProgress * 100)}% of the period elapsed.`,
        recordType: "sales_target",
        recordId: target.id,
        dueAt: target.periodEnd.toISOString(),
        recommendedActionType: "review_sales_target",
        drilldown: { metricKey: null, recordType: "sales_target", recordId: target.id },
      });
    }
  }

  return items;
}

async function marketingRules(ctx: EngineContext): Promise<AttentionItem[]> {
  const marketingCtx = await resolveMarketingAuthContext(ctx.db, { organizationId: ctx.organizationId, actorUserId: ctx.actorUserId });
  await requireMarketingViewAuthority(ctx.db, marketingCtx, "marketing_campaign", "founder_attention");

  const items: AttentionItem[] = [];

  const soonWindow = new Date(ctx.now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const startingSoonDraft = await ctx.db
    .select({ id: marketingCampaigns.id, name: marketingCampaigns.name, startDate: marketingCampaigns.startDate })
    .from(marketingCampaigns)
    .where(
      and(
        eq(marketingCampaigns.organizationId, ctx.organizationId),
        eq(marketingCampaigns.status, "draft"),
        isNotNull(marketingCampaigns.startDate),
        lte(marketingCampaigns.startDate, soonWindow),
        gte(marketingCampaigns.startDate, ctx.now),
        workspaceScopeCondition(marketingCampaigns.workspaceId, ctx.workspaceId)
      )
    );
  for (const row of startingSoonDraft) {
    items.push({
      id: `marketing_campaign_not_ready:${row.id}`,
      severity: "attention",
      domain: "marketing",
      reasonCode: "campaign_starting_with_missing_requirements",
      title: `${row.name} starts within 7 days but is still in draft`,
      explanation: `Start date ${row.startDate!.toISOString().slice(0, 10)}, status still draft (never transitioned to ready/active).`,
      recordType: "marketing_campaign",
      recordId: row.id,
      dueAt: row.startDate!.toISOString(),
      recommendedActionType: "review_campaign_readiness",
      drilldown: { metricKey: "marketing_campaigns_active", recordType: "marketing_campaign", recordId: row.id },
    });
  }

  const activeCampaignsWithOverdueContent = await ctx.db
    .select({ campaignId: marketingCampaigns.id, campaignName: marketingCampaigns.name, overdueCount: count() })
    .from(marketingContentItems)
    .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingContentItems.campaignId))
    .where(
      and(
        eq(marketingContentItems.organizationId, ctx.organizationId),
        sql`${marketingCampaigns.status} IN ('active','ready')`,
        isNotNull(marketingContentItems.plannedPublishAt),
        lt(marketingContentItems.plannedPublishAt, ctx.now),
        sql`${marketingContentItems.status} NOT IN ('published','archived')`,
        workspaceScopeCondition(marketingCampaigns.workspaceId, ctx.workspaceId)
      )
    )
    .groupBy(marketingCampaigns.id, marketingCampaigns.name);
  for (const row of activeCampaignsWithOverdueContent) {
    items.push({
      id: `marketing_campaign_at_risk:${row.campaignId}`,
      severity: "attention",
      domain: "marketing",
      reasonCode: "campaign_at_risk",
      title: `${row.campaignName} has ${row.overdueCount} overdue content item(s)`,
      explanation: "An active campaign with content past its planned publish date — a real, bounded proxy for at-risk, not a broader health score.",
      recordType: "marketing_campaign",
      recordId: row.campaignId,
      dueAt: null,
      recommendedActionType: "review_campaign_content",
      drilldown: { metricKey: "marketing_content_overdue", recordType: "marketing_campaign", recordId: row.campaignId },
    });
  }

  return items;
}

async function deliveryRules(ctx: EngineContext): Promise<AttentionItem[]> {
  await requireOrganizationMembership(ctx.db, ctx.organizationId, ctx.actorUserId);
  const items: AttentionItem[] = [];

  const blocked = await ctx.db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.organizationId, ctx.organizationId), eq(projects.status, "blocked"), workspaceScopeCondition(projects.workspaceId, ctx.workspaceId)))
    .limit(20);
  for (const row of blocked) {
    items.push({
      id: `project_blocked:${row.id}`,
      severity: "urgent",
      domain: "delivery",
      reasonCode: "blocked_project",
      title: `${row.name} is blocked`,
      explanation: "This project's own status is blocked.",
      recordType: "project",
      recordId: row.id,
      dueAt: null,
      recommendedActionType: "unblock_project",
      drilldown: { metricKey: "projects_blocked", recordType: "project", recordId: row.id },
    });
  }

  const overdueMilestones = await ctx.db
    .select({ id: projectMilestones.id, title: projectMilestones.title, targetDate: projectMilestones.targetDate, projectId: projectMilestones.projectId })
    .from(projectMilestones)
    .innerJoin(projects, eq(projects.id, projectMilestones.projectId))
    .where(and(eq(projectMilestones.organizationId, ctx.organizationId), isNotNull(projectMilestones.targetDate), lt(projectMilestones.targetDate, ctx.now), sql`${projectMilestones.status} NOT IN ('completed','cancelled')`, workspaceScopeCondition(projects.workspaceId, ctx.workspaceId)))
    .orderBy(projectMilestones.targetDate)
    .limit(20);
  for (const row of overdueMilestones) {
    items.push({
      id: `project_milestone_overdue:${row.id}`,
      severity: "attention",
      domain: "delivery",
      reasonCode: "overdue_project_milestone",
      title: `Milestone overdue: ${row.title}`,
      explanation: `Target date was ${row.targetDate!.toISOString().slice(0, 10)}.`,
      recordType: "project_milestone",
      recordId: row.id,
      dueAt: row.targetDate!.toISOString(),
      recommendedActionType: "review_milestone",
      drilldown: { metricKey: null, recordType: "project_milestone", recordId: row.id },
    });
  }

  return items;
}

async function operationsRules(ctx: EngineContext): Promise<AttentionItem[]> {
  await requireOrganizationMembership(ctx.db, ctx.organizationId, ctx.actorUserId);
  const items: AttentionItem[] = [];

  const recentWindow = new Date(ctx.now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const failedWorkflows = await ctx.db
    .select({ id: workflowExecutions.id, completedAt: workflowExecutions.completedAt })
    .from(workflowExecutions)
    .where(and(eq(workflowExecutions.organizationId, ctx.organizationId), eq(workflowExecutions.status, "failed"), isNotNull(workflowExecutions.completedAt), gte(workflowExecutions.completedAt, recentWindow), workspaceScopeCondition(workflowExecutions.workspaceId, ctx.workspaceId)))
    .orderBy(desc(workflowExecutions.completedAt))
    .limit(20);
  for (const row of failedWorkflows) {
    items.push({
      id: `workflow_failed:${row.id}`,
      severity: "urgent",
      domain: "operations",
      reasonCode: "failed_workflow",
      title: "A workflow execution failed",
      explanation: `Failed ${row.completedAt!.toISOString().slice(0, 10)}.`,
      recordType: "workflow_execution",
      recordId: row.id,
      dueAt: null,
      recommendedActionType: "review_workflow_failure",
      drilldown: { metricKey: "workflows_failed", recordType: "workflow_execution", recordId: row.id },
    });
  }

  const deadLettered = await ctx.db
    .select({ id: runtimeJobs.id, jobType: runtimeJobs.jobType })
    .from(runtimeJobs)
    .where(and(eq(runtimeJobs.organizationId, ctx.organizationId), eq(runtimeJobs.status, "dead_lettered"), workspaceScopeCondition(runtimeJobs.workspaceId, ctx.workspaceId)))
    .limit(20);
  for (const row of deadLettered) {
    items.push({
      id: `runtime_dead_letter:${row.id}`,
      severity: "urgent",
      domain: "operations",
      reasonCode: "dead_lettered_runtime_job",
      title: `A ${row.jobType} Runtime job was dead-lettered`,
      explanation: "This job exhausted its retry budget and requires human review.",
      recordType: "runtime_job",
      recordId: row.id,
      dueAt: null,
      recommendedActionType: "review_dead_letter_queue",
      drilldown: { metricKey: null, recordType: "runtime_job", recordId: row.id },
    });
  }

  return items;
}

async function communicationsRules(ctx: EngineContext): Promise<AttentionItem[]> {
  const commsCtx = await resolveCommunicationAuthContext(ctx.db, { organizationId: ctx.organizationId, actorUserId: ctx.actorUserId });
  await requireCommunicationsViewAuthority(ctx.db, commsCtx, "communication_message", "founder_attention");
  const items: AttentionItem[] = [];

  // `communication_messages` has no `workspaceId` of its own — scoped through its own conversation's real workspaceId via a join, the identical policy Analytics OS's own communications metrics use.
  const recentWindow = new Date(ctx.now.getTime() - 24 * 60 * 60 * 1000);
  const conversationWorkspace = workspaceScopeCondition(communicationConversations.workspaceId, ctx.workspaceId);
  const [sentRow] = await ctx.db
    .select({ value: count() })
    .from(communicationMessages)
    .innerJoin(communicationConversations, eq(communicationConversations.id, communicationMessages.conversationId))
    .where(and(eq(communicationMessages.organizationId, ctx.organizationId), eq(communicationMessages.direction, "outbound"), isNotNull(communicationMessages.sentAt), gte(communicationMessages.sentAt, recentWindow), conversationWorkspace));
  const [failedRow] = await ctx.db
    .select({ value: count() })
    .from(communicationMessages)
    .innerJoin(communicationConversations, eq(communicationConversations.id, communicationMessages.conversationId))
    .where(and(eq(communicationMessages.organizationId, ctx.organizationId), eq(communicationMessages.status, "failed"), isNotNull(communicationMessages.failedAt), gte(communicationMessages.failedAt, recentWindow), conversationWorkspace));
  const attempted = sentRow.value + failedRow.value;
  if (attempted >= 5 && failedRow.value / attempted >= 0.3) {
    items.push({
      id: `communications_high_failure_rate:${ctx.organizationId}`,
      severity: "attention",
      domain: "communications",
      reasonCode: "high_message_failure_rate",
      title: `${Math.round((failedRow.value / attempted) * 100)}% of messages failed in the last 24 hours`,
      explanation: `${failedRow.value} of ${attempted} outbound attempts failed.`,
      recordType: "organization",
      recordId: ctx.organizationId,
      dueAt: null,
      recommendedActionType: "review_communications_failures",
      drilldown: { metricKey: "communications_messages_failed", recordType: "organization", recordId: ctx.organizationId },
    });
  }

  const disabledWithStuckSends = await ctx.db
    .select({ id: integrationConnections.id, displayName: integrationConnections.displayName, stuckCount: count() })
    .from(integrationConnections)
    .innerJoin(communicationConversations, eq(communicationConversations.integrationConnectionId, integrationConnections.id))
    .innerJoin(communicationMessages, eq(communicationMessages.conversationId, communicationConversations.id))
    .where(and(eq(integrationConnections.organizationId, ctx.organizationId), eq(integrationConnections.status, "disabled"), sql`${communicationMessages.status} IN ('queued','sending')`, workspaceScopeCondition(integrationConnections.workspaceId, ctx.workspaceId)))
    .groupBy(integrationConnections.id, integrationConnections.displayName);
  for (const row of disabledWithStuckSends) {
    items.push({
      id: `integration_disabled_blocking:${row.id}`,
      severity: "urgent",
      domain: "communications",
      reasonCode: "disabled_integration_required_by_active_workflow",
      title: `${row.displayName} is disabled with ${row.stuckCount} message(s) stuck queued`,
      explanation: "A real, direct signal: this connection is disabled while messages that reference it remain queued/sending.",
      recordType: "integration_connection",
      recordId: row.id,
      dueAt: null,
      recommendedActionType: "re_enable_or_reroute_connection",
      drilldown: { metricKey: null, recordType: "integration_connection", recordId: row.id },
    });
  }

  return items;
}

async function agentsRules(ctx: EngineContext): Promise<AttentionItem[]> {
  await requireOrganizationMembership(ctx.db, ctx.organizationId, ctx.actorUserId);
  const items: AttentionItem[] = [];

  // `agent_approval_requests` has no `workspaceId` of its own — scoped through its own execution's real workspaceId via a join.
  const soonWindow = new Date(ctx.now.getTime() + 4 * 60 * 60 * 1000);
  const nearingExpiry = await ctx.db
    .select({ id: agentApprovalRequests.id, requestedAction: agentApprovalRequests.requestedAction, expiresAt: agentApprovalRequests.expiresAt })
    .from(agentApprovalRequests)
    .innerJoin(agentExecutions, eq(agentExecutions.id, agentApprovalRequests.executionId))
    .where(and(eq(agentApprovalRequests.organizationId, ctx.organizationId), eq(agentApprovalRequests.status, "pending"), lte(agentApprovalRequests.expiresAt, soonWindow), gte(agentApprovalRequests.expiresAt, ctx.now), workspaceScopeCondition(agentExecutions.workspaceId, ctx.workspaceId)))
    .limit(20);
  for (const row of nearingExpiry) {
    items.push({
      id: `approval_nearing_expiry:${row.id}`,
      severity: "attention",
      domain: "agents",
      reasonCode: "pending_approval_nearing_expiry",
      title: `Approval nearing expiry: ${row.requestedAction}`,
      explanation: `Expires ${row.expiresAt.toISOString()}.`,
      recordType: "agent_approval_request",
      recordId: row.id,
      dueAt: row.expiresAt.toISOString(),
      recommendedActionType: "decide_approval",
      drilldown: { metricKey: "approvals_pending", recordType: "agent_approval_request", recordId: row.id },
    });
  }

  const recentWindow = new Date(ctx.now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const repeatedFailures = await ctx.db
    .select({ agentId: agentExecutions.assignedAgentId, failureCount: count() })
    .from(agentExecutions)
    .where(and(eq(agentExecutions.organizationId, ctx.organizationId), eq(agentExecutions.status, "failed"), isNotNull(agentExecutions.assignedAgentId), isNotNull(agentExecutions.failedAt), gte(agentExecutions.failedAt, recentWindow), workspaceScopeCondition(agentExecutions.workspaceId, ctx.workspaceId)))
    .groupBy(agentExecutions.assignedAgentId)
    .having(sql`count(*) >= 3`);
  for (const row of repeatedFailures) {
    if (!row.agentId) continue;
    items.push({
      id: `agent_repeated_failure:${row.agentId}`,
      severity: "urgent",
      domain: "agents",
      reasonCode: "repeated_agent_execution_failure",
      title: `An agent has failed ${row.failureCount} execution(s) in the last 7 days`,
      explanation: "Three or more failed executions for the same agent within 7 days.",
      recordType: "agent",
      recordId: row.agentId,
      dueAt: null,
      recommendedActionType: "review_agent_health",
      drilldown: { metricKey: "agent_executions_failed", recordType: "agent", recordId: row.agentId },
    });
  }

  return items;
}

export interface AttentionEngineInput {
  organizationId: string;
  workspaceId: string | null;
  actorUserId: string;
}

/** Runs every rule the caller is authorized for, in parallel, tolerating individual domain denials (mirrors the KPI layer's own graceful-degradation pattern) — never a hard failure for the whole engine because one domain is inaccessible. Sorted deterministically: severity first, then earliest due date, then most-overdue. Capped at `MAX_ATTENTION_ITEMS`. */
export async function computeAttentionItems(db: Db, input: AttentionEngineInput): Promise<AttentionItem[]> {
  const founderCtx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, founderCtx, "founder_attention", input.organizationId);

  const ctx: EngineContext = { db, organizationId: input.organizationId, workspaceId: input.workspaceId, actorUserId: input.actorUserId, now: new Date() };

  const domainRuleSets: Array<[string, () => Promise<AttentionItem[]>]> = [
    ["founder_workspace_view", () => crmRules(ctx)],
    ["founder_workspace_view_sales", () => salesRules(ctx)],
    ["founder_workspace_view_marketing", () => marketingRules(ctx)],
    ["founder_workspace_view_operations", () => deliveryRules(ctx)],
    ["founder_workspace_view_operations", () => operationsRules(ctx)],
    ["founder_workspace_view_operations", () => communicationsRules(ctx)],
    ["founder_workspace_view_agents", () => agentsRules(ctx)],
  ];

  const results = await Promise.all(
    domainRuleSets.map(async ([capability, run]) => {
      if (!hasFounderCapability(founderCtx, capability as Parameters<typeof hasFounderCapability>[1])) return [];
      try {
        return await run();
      } catch {
        return [];
      }
    })
  );

  const items = results.flat();
  items.sort((a, b) => {
    const severityDiff = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
    if (severityDiff !== 0) return severityDiff;
    if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return 0;
  });

  return items.slice(0, MAX_ATTENTION_ITEMS);
}
