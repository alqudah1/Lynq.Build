import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agents } from "@/db/schema";
import { registerAgent, resolveAgentById, type Agent } from "@/lib/agents/agents";
import { advanceAgentLifecycleStage, changeAgentPermissionLevel } from "@/lib/agents/lifecycle";
import { createExecution, resolveExecutionById, type AgentExecution } from "@/lib/agent-runtime/executions";
import { assignExecution, startExecution, advanceExecution, completeExecution } from "@/lib/agent-runtime/lifecycle";
import { createPlan, completePlanStep } from "@/lib/agent-runtime/plans";
import { createArtifact, type AgentArtifact } from "@/lib/agent-runtime/artifacts";
import { createCheckpoint } from "@/lib/agent-runtime/checkpoints";
import { requestApproval, type AgentApprovalRequest } from "@/lib/agent-runtime/approvals";
import { recordAuditEvent } from "@/lib/audit";
import { marketingApprovalLinks } from "@/db/schema";
import { resolveMarketingAuthContext, requireMarketingManageContentAuthority } from "./authz";
import { getCampaignForUser, resolveCampaignById } from "./campaigns";
import { getAudienceForUser } from "./audiences";
import { MarketingAgentNotSeededError } from "./errors";
import { registerAgentTaskHandler, resolveReportArtifactTaskState, InvalidAgentTaskInputError } from "@/lib/agent-runtime/task-handlers";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Marketing OS agents — Module 15
 * ============================================================================
 * Three narrow agents, not one unrestricted "Marketing AI." Each is
 * registered through the real Agent Registry lifecycle exactly like
 * Company Knowledge Analyst and the two Sales agents (Module 8/13's
 * forward-only stage sequence, permission raised back to `assistant` as
 * its own explicit step), and reads Marketing OS data through the SAME
 * human-authorized read functions (`getCampaignForUser`, `getAudienceForUser`)
 * an ordinary request would use — the launching human's own Marketing OS
 * authority is what gates the read, never a separate agent-specific grant,
 * mirroring exactly how Sales OS's two agents reuse `getLeadForUser`/
 * `getOpportunityForUser`. No agent here ever activates a campaign,
 * modifies CRM, publishes content, or contacts a customer — every output
 * is a real Runtime artifact, mechanically traceable to real Marketing
 * OS/CRM-reference data, never fabricated performance or generated
 * "creative" copy — deterministic structural assembly only, the same
 * evidence-bounded discipline Knowledge Analyst and the Sales agents use.
 */
export const CAMPAIGN_BRIEF_ASSISTANT_NAME = "Campaign Brief Assistant";
export const CONTENT_DRAFT_ASSISTANT_NAME = "Content Draft Assistant";
export const CAMPAIGN_SUMMARY_ASSISTANT_NAME = "Campaign Summary Assistant";

async function seedOneMarketingAgent(db: Db, input: { organizationId: string; name: string; humanOwnerUserId: string; actorUserId: string; anatomy: Parameters<typeof registerAgent>[1] extends infer T ? Omit<T, "organizationId" | "name" | "humanOwnerUserId" | "permissionLevel" | "actorUserId"> : never }): Promise<Agent> {
  const [existingRow] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, input.organizationId), eq(agents.name, input.name)));

  if (existingRow) return (await resolveAgentById(db, existingRow.id))!;

  const agent = await registerAgent(db, { organizationId: input.organizationId, name: input.name, humanOwnerUserId: input.humanOwnerUserId, permissionLevel: "assistant", actorUserId: input.actorUserId, ...input.anatomy });
  for (const toStage of ["specification", "development", "testing", "approval", "deployment"] as const) {
    await advanceAgentLifecycleStage(db, { organizationId: input.organizationId, agentId: agent.id, toStage, actorUserId: input.actorUserId });
  }
  await changeAgentPermissionLevel(db, { organizationId: input.organizationId, agentId: agent.id, newPermissionLevel: "assistant", reason: "Marketing OS (Module 15) — 'assistant' is the minimum permission level artifact creation requires.", actorUserId: input.actorUserId });
  return agent;
}

export async function seedMarketingAgents(db: Db, input: { organizationId: string; humanOwnerUserId: string; actorUserId: string }): Promise<{ campaignBriefAgent: Agent; contentDraftAgent: Agent; campaignSummaryAgent: Agent }> {
  const campaignBriefAgent = await seedOneMarketingAgent(db, {
    organizationId: input.organizationId,
    name: CAMPAIGN_BRIEF_ASSISTANT_NAME,
    humanOwnerUserId: input.humanOwnerUserId,
    actorUserId: input.actorUserId,
    anatomy: {
      department: "marketing_and_brand",
      purpose: "Assemble a bounded campaign brief artifact from real campaign and audience data, to help a marketing team move from objective to execution faster.",
      responsibilities: "Given a campaign id, read the campaign's own objective/targets/dates/audience metadata (via the launching human's own Marketing OS authority) and produce a structured brief identifying objective, audience, timeline, and missing planning information.",
      goals: "Every fact in its brief is mechanically traceable to a real Marketing OS record it was permitted to read during that same execution.",
      inputs: "A Marketing OS campaign id.",
      outputs: "One `report` artifact: objective, targets, audience summary, timeline, and a deterministic missing-information checklist.",
      successCriteria: "The brief artifact is created and the execution reaches `completed` through the real Runtime completion gate.",
      failureCriteria: "The campaign cannot be resolved, or the launching human lacks Marketing OS view authority for it.",
      retirementCriteria: "Superseded by a broader campaign planning agent, or Marketing OS campaign briefs are retired.",
    },
  });

  const contentDraftAgent = await seedOneMarketingAgent(db, {
    organizationId: input.organizationId,
    name: CONTENT_DRAFT_ASSISTANT_NAME,
    humanOwnerUserId: input.humanOwnerUserId,
    actorUserId: input.actorUserId,
    anatomy: {
      department: "marketing_and_brand",
      purpose: "Assemble a bounded, deterministic draft-structure artifact for one Marketing OS content item, to give a contributor a real starting point rather than a blank page.",
      responsibilities: "Given a content item id (and optionally a campaign brief artifact id for context), produce a structured draft outline — never fabricated 'creative' copy — plus a deterministic missing-information checklist, and attach it as the content item's newest version.",
      goals: "Every section of its draft is mechanically traceable to real campaign/content data it was permitted to read during that same execution.",
      inputs: "A Marketing OS content item id, and an optional campaign brief artifact id.",
      outputs: "One `draft_text` artifact, attached to the content item as a new version.",
      successCriteria: "The draft artifact is created, attached to the content item, and the execution reaches `completed` through the real Runtime completion gate.",
      failureCriteria: "The content item cannot be resolved, or the launching human lacks Marketing OS content-management authority for it.",
      retirementCriteria: "Superseded by a broader content generation agent, or Marketing OS content drafting is retired.",
    },
  });

  const campaignSummaryAgent = await seedOneMarketingAgent(db, {
    organizationId: input.organizationId,
    name: CAMPAIGN_SUMMARY_ASSISTANT_NAME,
    humanOwnerUserId: input.humanOwnerUserId,
    actorUserId: input.actorUserId,
    anatomy: {
      department: "marketing_and_brand",
      purpose: "Summarize real campaign operational data into a bounded report artifact — status, content, approvals, budget — never fabricated channel performance.",
      responsibilities: "Given a campaign id, read its own real operational data (via the launching human's own Marketing OS authority) and produce a structured summary highlighting missing data and unresolved tasks.",
      goals: "Every figure in its summary is mechanically traceable to a real Marketing OS record read during that same execution — never impressions/reach/clicks/CPC/CTR/ROAS, which this module has no real channel integration to source.",
      inputs: "A Marketing OS campaign id.",
      outputs: "One `report` artifact: campaign status, content-by-status counts, pending approvals, budget planned vs. recorded spend, and unresolved-task highlights.",
      successCriteria: "The summary artifact is created and the execution reaches `completed` through the real Runtime completion gate.",
      failureCriteria: "The campaign cannot be resolved, or the launching human lacks Marketing OS view authority for it.",
      retirementCriteria: "Superseded by a broader marketing analytics agent, or Marketing OS campaign summarization is retired.",
    },
  });

  return { campaignBriefAgent, contentDraftAgent, campaignSummaryAgent };
}

export async function resolveCampaignBriefAssistantAgent(db: Db, organizationId: string): Promise<Agent> {
  const [row] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, organizationId), eq(agents.name, CAMPAIGN_BRIEF_ASSISTANT_NAME)));
  if (!row) throw new MarketingAgentNotSeededError(CAMPAIGN_BRIEF_ASSISTANT_NAME);
  return (await resolveAgentById(db, row.id))!;
}

export async function resolveContentDraftAssistantAgent(db: Db, organizationId: string): Promise<Agent> {
  const [row] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, organizationId), eq(agents.name, CONTENT_DRAFT_ASSISTANT_NAME)));
  if (!row) throw new MarketingAgentNotSeededError(CONTENT_DRAFT_ASSISTANT_NAME);
  return (await resolveAgentById(db, row.id))!;
}

export async function resolveCampaignSummaryAssistantAgent(db: Db, organizationId: string): Promise<Agent> {
  const [row] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, organizationId), eq(agents.name, CAMPAIGN_SUMMARY_ASSISTANT_NAME)));
  if (!row) throw new MarketingAgentNotSeededError(CAMPAIGN_SUMMARY_ASSISTANT_NAME);
  return (await resolveAgentById(db, row.id))!;
}

/** Mirrors `sales-os/agents.ts`'s own `driveThroughToExecuting` exactly — the same synchronous shell-execution pattern, since these tasks are bounded, single-shot reads with no external tool latency to hide behind the job queue. */
export async function driveThroughToExecuting(db: Db, organizationId: string, executionId: string, assignedAgentId: string, actorUserId: string, planSteps: string[]): Promise<{ execution: AgentExecution; planId: string }> {
  await assignExecution(db, { organizationId, executionId, assignedAgentId, actorUserId });
  await startExecution(db, { organizationId, executionId, actorUserId });
  await advanceExecution(db, { organizationId, executionId, toStatus: "planning", actorAgentId: assignedAgentId });
  const { plan } = await createPlan(db, { organizationId, executionId, steps: planSteps, actorAgentId: assignedAgentId });
  await advanceExecution(db, { organizationId, executionId, toStatus: "reasoning", actorAgentId: assignedAgentId });
  const execution = await advanceExecution(db, { organizationId, executionId, toStatus: "executing", actorAgentId: assignedAgentId });
  return { execution, planId: plan.id };
}

export interface CampaignBriefTaskResult {
  execution: AgentExecution;
  artifact: AgentArtifact;
}

/** The Campaign Brief Assistant's one task type — synchronous, bounded, evidence-backed. Never activates the campaign, modifies CRM, publishes content, or contacts a customer. */
export async function createCampaignBriefTask(db: Db, input: { organizationId: string; workspaceId?: string | null; campaignId: string; actorUserId: string }): Promise<CampaignBriefTaskResult> {
  const campaign = await getCampaignForUser(db, { organizationId: input.organizationId, campaignId: input.campaignId, actorUserId: input.actorUserId });

  const agent = await resolveCampaignBriefAssistantAgent(db, input.organizationId);

  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId ?? undefined,
    ownerUserId: input.actorUserId,
    goal: `Assemble a campaign brief for campaign ${campaign.id}`,
    successCriteria: "A report artifact is created summarizing objective, targets, audience, timeline, and missing planning information",
    failureCriteria: "The campaign cannot be resolved or no permitted data covers what this task needs",
    domainsRequested: [],
    actorUserId: input.actorUserId,
  });

  await recordAuditEvent(db, { eventType: "marketing_agent_task_started", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_campaign", targetId: campaign.id, metadata: { agentId: agent.id, taskType: "marketing_campaign_brief" } });

  const { planId } = await driveThroughToExecuting(db, input.organizationId, execution.id, agent.id, input.actorUserId, ["Gather permitted campaign data", "Produce structured brief artifact"]);

  const audience = campaign.primaryAudienceId ? await getAudienceForUser(db, { organizationId: input.organizationId, audienceId: campaign.primaryAudienceId, actorUserId: input.actorUserId }).catch(() => null) : null;
  await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId, stepNumber: 1, actorAgentId: agent.id });

  const missing: string[] = [];
  if (!campaign.primaryAudienceId) missing.push("No primary audience defined");
  if (!campaign.startDate) missing.push("No start date set");
  if (!campaign.endDate) missing.push("No end date set");
  if (!campaign.budgetAmount) missing.push("No budget recorded");
  if (Object.keys(campaign.objectiveTargets ?? {}).length === 0) missing.push("No objective targets defined");

  const reportLines = [
    `Campaign ${campaign.id} — "${campaign.name}" (status: ${campaign.status})`,
    `Objective: ${campaign.objectiveType}`,
    `Targets: ${JSON.stringify(campaign.objectiveTargets ?? {})}`,
    audience ? `Primary audience: ${audience.name} (${audience.entityType}, ${audience.snapshotCount ?? "not yet evaluated"} records)` : "Primary audience: none linked",
    campaign.startDate ? `Start: ${campaign.startDate.toISOString()}` : "Start: not set",
    campaign.endDate ? `End: ${campaign.endDate.toISOString()}` : "End: not set",
    campaign.budgetAmount ? `Budget: ${campaign.budgetAmount} ${campaign.currency ?? ""}` : "Budget: not recorded",
    "",
    "Missing planning information:",
    ...(missing.length > 0 ? missing.map((m) => `- ${m}`) : ["- None — campaign has complete baseline planning information"]),
  ];

  const artifact = await createArtifact(db, { organizationId: input.organizationId, executionId: execution.id, artifactType: "report", title: `Campaign brief — ${campaign.name}`, content: reportLines.join("\n"), actorAgentId: agent.id });
  await recordAuditEvent(db, { eventType: "marketing_agent_artifact_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_campaign", targetId: campaign.id, metadata: { agentId: agent.id, artifactId: artifact.id } });

  await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId, stepNumber: 2, actorAgentId: agent.id });
  await createCheckpoint(db, { organizationId: input.organizationId, executionId: execution.id, statusAtCheckpoint: "executing", stepPosition: "artifact_created", safeStateSummary: { campaignId: campaign.id, artifactId: artifact.id } });
  await advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "verifying", actorAgentId: agent.id });
  const completed = await completeExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorAgentId: agent.id });

  return { execution: completed, artifact };
}

export interface CampaignSummaryTaskResult {
  execution: AgentExecution;
  artifact: AgentArtifact;
}

/** The Campaign Summary Assistant's one task type — reuses real operational data only; never fabricates impressions/reach/clicks/CPC/CTR/ROAS. */
export async function createCampaignSummaryTask(db: Db, input: { organizationId: string; workspaceId?: string | null; campaignId: string; actorUserId: string }): Promise<CampaignSummaryTaskResult> {
  const campaign = await getCampaignForUser(db, { organizationId: input.organizationId, campaignId: input.campaignId, actorUserId: input.actorUserId });
  const agent = await resolveCampaignSummaryAssistantAgent(db, input.organizationId);

  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId ?? undefined,
    ownerUserId: input.actorUserId,
    goal: `Summarize campaign ${campaign.id} operational data`,
    successCriteria: "A report artifact is created summarizing real campaign operational data and unresolved tasks",
    failureCriteria: "The campaign cannot be resolved or no permitted data covers what this task needs",
    domainsRequested: [],
    actorUserId: input.actorUserId,
  });

  await recordAuditEvent(db, { eventType: "marketing_agent_task_started", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_campaign", targetId: campaign.id, metadata: { agentId: agent.id, taskType: "marketing_campaign_summary" } });

  const { planId } = await driveThroughToExecuting(db, input.organizationId, execution.id, agent.id, input.actorUserId, ["Gather permitted campaign operational data", "Produce structured summary artifact"]);

  const { listContentItemsForCampaign } = await import("./content");
  const { listCampaignRunsForCampaign } = await import("./campaign-runs");
  const { listBudgetEntriesForCampaign } = await import("./budget");
  const [contentItems, runs, budgetEntries] = await Promise.all([
    listContentItemsForCampaign(db, { organizationId: input.organizationId, campaignId: campaign.id, actorUserId: input.actorUserId }),
    listCampaignRunsForCampaign(db, { organizationId: input.organizationId, campaignId: campaign.id, actorUserId: input.actorUserId }),
    listBudgetEntriesForCampaign(db, { organizationId: input.organizationId, campaignId: campaign.id, actorUserId: input.actorUserId }),
  ]);
  await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId, stepNumber: 1, actorAgentId: agent.id });

  const contentByStatus = contentItems.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {});
  const plannedBudget = budgetEntries.reduce((sum, b) => sum + (b.plannedAmount ? Number(b.plannedAmount) : 0), 0);
  const recordedSpend = budgetEntries.reduce((sum, b) => sum + (b.spendAmount ? Number(b.spendAmount) : 0), 0);
  const activeRun = runs.find((r) => r.status === "in_progress" || r.status === "waiting");

  const reportLines = [
    `Campaign ${campaign.id} — "${campaign.name}" (status: ${campaign.status})`,
    `Content items: ${contentItems.length} total — ${JSON.stringify(contentByStatus)}`,
    `Campaign runs: ${runs.length} total${activeRun ? `, one active (missing: ${activeRun.missingRequirements.join(", ") || "none"})` : ""}`,
    `Budget: planned ${plannedBudget}, manually recorded spend ${recordedSpend} (${campaign.currency ?? "no currency set"})`,
    "",
    "Note: this summary reflects real Marketing OS operational data only — no external channel metrics (impressions, reach, clicks, CPC, CTR, ROAS) are available in this module.",
  ];

  const artifact = await createArtifact(db, { organizationId: input.organizationId, executionId: execution.id, artifactType: "report", title: `Campaign summary — ${campaign.name}`, content: reportLines.join("\n"), actorAgentId: agent.id });
  await recordAuditEvent(db, { eventType: "marketing_agent_artifact_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_campaign", targetId: campaign.id, metadata: { agentId: agent.id, artifactId: artifact.id } });

  await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId, stepNumber: 2, actorAgentId: agent.id });
  await createCheckpoint(db, { organizationId: input.organizationId, executionId: execution.id, statusAtCheckpoint: "executing", stepPosition: "artifact_created", safeStateSummary: { campaignId: campaign.id, artifactId: artifact.id } });
  await advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "verifying", actorAgentId: agent.id });
  const completed = await completeExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorAgentId: agent.id });

  return { execution: completed, artifact };
}

export interface ContentDraftTaskResult {
  execution: AgentExecution;
  artifact: AgentArtifact;
}

/** The Content Draft Assistant's one task type — a deterministic structural draft, never fabricated "creative" copy. Attaches the resulting artifact to the content item as its newest version. */
export async function createContentDraftTask(db: Db, input: { organizationId: string; workspaceId?: string | null; contentItemId: string; briefArtifactId?: string | null; actorUserId: string }): Promise<ContentDraftTaskResult> {
  const { getContentItemForUser, attachArtifactVersion } = await import("./content");
  const contentItem = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: input.contentItemId, actorUserId: input.actorUserId });
  const campaign = await resolveCampaignById(db, input.organizationId, contentItem.campaignId);
  const agent = await resolveContentDraftAssistantAgent(db, input.organizationId);

  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId ?? undefined,
    ownerUserId: input.actorUserId,
    goal: `Draft structure for content item ${contentItem.id}`,
    successCriteria: "A draft_text artifact is created and attached to the content item as its newest version",
    failureCriteria: "The content item cannot be resolved or no permitted data covers what this task needs",
    domainsRequested: [],
    actorUserId: input.actorUserId,
  });

  await recordAuditEvent(db, { eventType: "marketing_agent_task_started", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_content_item", targetId: contentItem.id, metadata: { agentId: agent.id, taskType: "marketing_content_draft" } });

  const { planId } = await driveThroughToExecuting(db, input.organizationId, execution.id, agent.id, input.actorUserId, ["Gather permitted campaign/content context", "Produce structured draft artifact"]);
  await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId, stepNumber: 1, actorAgentId: agent.id });

  const missing: string[] = [];
  if (!contentItem.intendedChannel) missing.push("No intended channel set");
  if (!contentItem.plannedPublishAt) missing.push("No planned publish date set");
  if (!input.briefArtifactId) missing.push("No campaign brief referenced — draft based on campaign fields only");

  const draftLines = [
    `Draft outline — ${contentItem.title} (${contentItem.contentType})`,
    `Campaign: ${campaign.name} (objective: ${campaign.objectiveType})`,
    contentItem.intendedChannel ? `Channel: ${contentItem.intendedChannel}` : "Channel: not set",
    contentItem.plannedPublishAt ? `Planned publish: ${contentItem.plannedPublishAt.toISOString()}` : "Planned publish: not set",
    input.briefArtifactId ? `Referenced brief artifact: ${input.briefArtifactId}` : "",
    "",
    "Structure:",
    "1. Hook / opening",
    "2. Core message (tie to campaign objective)",
    "3. Supporting detail",
    "4. Call to action",
    "",
    "Missing information / recommended next steps:",
    ...(missing.length > 0 ? missing.map((m) => `- ${m}`) : ["- None — content item has complete baseline information"]),
  ].filter(Boolean);

  const artifact = await createArtifact(db, { organizationId: input.organizationId, executionId: execution.id, artifactType: "draft_text", title: `Draft — ${contentItem.title}`, content: draftLines.join("\n"), actorAgentId: agent.id });
  await recordAuditEvent(db, { eventType: "marketing_agent_artifact_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_content_item", targetId: contentItem.id, metadata: { agentId: agent.id, artifactId: artifact.id } });

  await attachArtifactVersion(db, { organizationId: input.organizationId, contentItemId: contentItem.id, artifactId: artifact.id, actorUserId: input.actorUserId, createdByAgentId: agent.id });

  await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId, stepNumber: 2, actorAgentId: agent.id });
  await createCheckpoint(db, { organizationId: input.organizationId, executionId: execution.id, statusAtCheckpoint: "executing", stepPosition: "artifact_created", safeStateSummary: { contentItemId: contentItem.id, artifactId: artifact.id } });
  await advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "verifying", actorAgentId: agent.id });
  const completed = await completeExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorAgentId: agent.id });

  return { execution: completed, artifact };
}

/**
 * Content review approvals are hosted through the Content Draft Assistant's
 * own shell execution — mirroring exactly how Sales OS's
 * `requestOpportunityContinuationApproval`/`requestLeadReviewApproval` host
 * their approvals through a real Sales agent identity. The actual approval
 * DECISION always requires a real human `actorUserId` — the Agent Runtime's
 * `approveRequest`/`rejectRequest` have no agent-callable path at all, so
 * "an agent cannot approve its own output" already holds structurally; this
 * function only creates the request, never decides it.
 */
export async function requestContentReviewApproval(db: Db, input: { organizationId: string; workspaceId?: string | null; contentItemId: string; summary: string; actorUserId: string }): Promise<{ execution: AgentExecution; approval: AgentApprovalRequest }> {
  const { getContentItemForUser } = await import("./content");
  const contentItem = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: input.contentItemId, actorUserId: input.actorUserId });
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_content_item", contentItem.id);

  const agent = await resolveContentDraftAssistantAgent(db, input.organizationId);

  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId ?? undefined,
    ownerUserId: input.actorUserId,
    goal: `Request approval to review content item ${contentItem.id}`,
    successCriteria: "A human approval decision is recorded",
    failureCriteria: "The content item cannot be resolved",
    domainsRequested: [],
    actorUserId: input.actorUserId,
  });

  await driveThroughToExecuting(db, input.organizationId, execution.id, agent.id, input.actorUserId, ["Request human approval to review this content item"]);

  const { request } = await requestApproval(db, { organizationId: input.organizationId, executionId: execution.id, requestedAction: "review_content", summary: input.summary, riskLevel: "low", actorAgentId: agent.id });

  await db.insert(marketingApprovalLinks).values({ organizationId: input.organizationId, approvalRequestId: request.id, linkedEntityType: "content_item", linkedEntityId: contentItem.id, purpose: "review_content", createdByUserId: input.actorUserId });
  await recordAuditEvent(db, { eventType: "marketing_approval_linked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_content_item", targetId: contentItem.id, metadata: { approvalRequestId: request.id } });

  const parkedExecution = await resolveExecutionById(db, input.organizationId, execution.id);
  return { execution: parkedExecution, approval: request };
}

/**
 * Module 15 — registers all three Marketing agents as generic agent task
 * handlers (`marketing_campaign_brief`, `marketing_content_draft`,
 * `marketing_campaign_summary`) so the Workflow Engine's `agent_execution`
 * node can drive them through the exact same bounded contract Module 14
 * established — no hardcoded marketing agent path in the Workflow Engine.
 */
registerAgentTaskHandler({
  taskType: "marketing_campaign_brief",
  expectedAgentName: CAMPAIGN_BRIEF_ASSISTANT_NAME,
  isAgentEligible: (agent) => agent.name === CAMPAIGN_BRIEF_ASSISTANT_NAME && agent.lifecycleStage !== "retired",
  async launch(db, input) {
    const campaignId = typeof input.taskInput.campaignId === "string" ? input.taskInput.campaignId : null;
    if (!campaignId) throw new InvalidAgentTaskInputError("marketing_campaign_brief", "campaignId is required");
    const { execution } = await createCampaignBriefTask(db as Db, { organizationId: input.organizationId, workspaceId: input.workspaceId, campaignId, actorUserId: input.actorUserId });
    return { runtimeExecutionId: execution.id };
  },
  resolveState: (db, input) => resolveReportArtifactTaskState(db as Db, "marketing_campaign_brief", input),
});

registerAgentTaskHandler({
  taskType: "marketing_content_draft",
  expectedAgentName: CONTENT_DRAFT_ASSISTANT_NAME,
  isAgentEligible: (agent) => agent.name === CONTENT_DRAFT_ASSISTANT_NAME && agent.lifecycleStage !== "retired",
  async launch(db, input) {
    const contentItemId = typeof input.taskInput.contentItemId === "string" ? input.taskInput.contentItemId : null;
    if (!contentItemId) throw new InvalidAgentTaskInputError("marketing_content_draft", "contentItemId is required");
    const briefArtifactId = typeof input.taskInput.briefArtifactId === "string" ? input.taskInput.briefArtifactId : null;
    const { execution } = await createContentDraftTask(db as Db, { organizationId: input.organizationId, workspaceId: input.workspaceId, contentItemId, briefArtifactId, actorUserId: input.actorUserId });
    return { runtimeExecutionId: execution.id };
  },
  resolveState: (db, input) => resolveReportArtifactTaskState(db as Db, "marketing_content_draft", input),
});

registerAgentTaskHandler({
  taskType: "marketing_campaign_summary",
  expectedAgentName: CAMPAIGN_SUMMARY_ASSISTANT_NAME,
  isAgentEligible: (agent) => agent.name === CAMPAIGN_SUMMARY_ASSISTANT_NAME && agent.lifecycleStage !== "retired",
  async launch(db, input) {
    const campaignId = typeof input.taskInput.campaignId === "string" ? input.taskInput.campaignId : null;
    if (!campaignId) throw new InvalidAgentTaskInputError("marketing_campaign_summary", "campaignId is required");
    const { execution } = await createCampaignSummaryTask(db as Db, { organizationId: input.organizationId, workspaceId: input.workspaceId, campaignId, actorUserId: input.actorUserId });
    return { runtimeExecutionId: execution.id };
  },
  resolveState: (db, input) => resolveReportArtifactTaskState(db as Db, "marketing_campaign_summary", input),
});
