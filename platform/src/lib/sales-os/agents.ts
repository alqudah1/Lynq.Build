import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agents } from "@/db/schema";
import { registerAgent, resolveAgentById, type Agent } from "@/lib/agents/agents";
import { advanceAgentLifecycleStage, changeAgentPermissionLevel } from "@/lib/agents/lifecycle";
import type { AgentPrincipal } from "@/lib/agents/authentication";
import { createExecution, resolveExecutionById, type AgentExecution } from "@/lib/agent-runtime/executions";
import { assignExecution, startExecution, advanceExecution, completeExecution } from "@/lib/agent-runtime/lifecycle";
import { createPlan, completePlanStep } from "@/lib/agent-runtime/plans";
import { createArtifact, type AgentArtifact } from "@/lib/agent-runtime/artifacts";
import { createCheckpoint } from "@/lib/agent-runtime/checkpoints";
import { requestApproval, type AgentApprovalRequest } from "@/lib/agent-runtime/approvals";
import { grantCrmAgentPermission } from "@/lib/crm/agent-permissions";
import type { CrmAgentPermission } from "@/lib/crm/validation";
import { getContactForAgent, getCompanyForAgent, listActivitiesForAgent, listNotesForAgent } from "@/lib/crm/agent-reads";
import { getLeadForUser } from "@/lib/crm/leads";
import { getOpportunityForUser } from "@/lib/crm/opportunities";
import { recordAuditEvent } from "@/lib/audit";
import { salesApprovalLinks } from "@/db/schema";
import { computeOpportunityHealth } from "./health";
import { resolveSalesAuthContext, requireSalesLeadWorkAuthority, requireSalesOpportunityWorkAuthority } from "./authz";
import { SalesAgentNotSeededError } from "./errors";
import { registerAgentTaskHandler, resolveReportArtifactTaskState, InvalidAgentTaskInputError } from "@/lib/agent-runtime/task-handlers";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Sales OS agents — narrow, CRM-read-only, never a general "Sales AI"
 * ============================================================================
 * Both agents are registered through the real Agent Registry lifecycle
 * exactly like Company Knowledge Analyst (§2's forward-only stage
 * sequence, permission raised back to `assistant` as its own explicit
 * step), and read CRM data exclusively through the existing narrow,
 * default-deny `crm_agent_permission_grants` mechanism (Module 12) — never
 * a new grants table, never a Tool Runtime registration (no `crm.*` tool
 * exists by design; see Module 8's tool registry comment).
 *
 * Their work is driven synchronously in one call rather than through the
 * Runtime job queue/worker: `src/lib/runtime/worker.ts`'s `execution_run`
 * handler is hard-wired to `continueKnowledgeAnalystExecution` regardless
 * of which agent owns the job, so enqueueing a real job for these agents
 * would be picked up by the wrong driver. Both tasks are bounded,
 * single-shot CRM reads with no external tool latency to hide behind a
 * queue, so running the full create→assign→start→plan→execute→verify→
 * complete lifecycle inline is both safe and honest — every state
 * transition is still the real one, just not deferred to a worker tick.
 * Neither agent may qualify/disqualify a lead, move an opportunity stage,
 * assign ownership, or write to any `crm_*` table — both only ever call
 * the read-only `agent-reads.ts` functions and then `createArtifact`.
 */
export const LEAD_RESEARCH_ASSISTANT_NAME = "Lead Research Assistant";
export const OPPORTUNITY_SUMMARY_ASSISTANT_NAME = "Opportunity Summary Assistant";

const LEAD_RESEARCH_CRM_PERMISSIONS: CrmAgentPermission[] = ["crm_contact_read", "crm_company_read", "crm_lead_read", "crm_activity_read", "crm_note_read"];
const OPPORTUNITY_SUMMARY_CRM_PERMISSIONS: CrmAgentPermission[] = ["crm_contact_read", "crm_company_read", "crm_opportunity_read", "crm_activity_read", "crm_note_read"];

async function seedOneSalesAgent(db: Db, input: { organizationId: string; name: string; humanOwnerUserId: string; actorUserId: string; anatomy: Parameters<typeof registerAgent>[1] extends infer T ? Omit<T, "organizationId" | "name" | "humanOwnerUserId" | "permissionLevel" | "actorUserId"> : never; permissions: CrmAgentPermission[] }): Promise<Agent> {
  const [existingRow] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, input.organizationId), eq(agents.name, input.name)));

  let agent: Agent;
  if (existingRow) {
    agent = (await resolveAgentById(db, existingRow.id))!;
  } else {
    agent = await registerAgent(db, { organizationId: input.organizationId, name: input.name, humanOwnerUserId: input.humanOwnerUserId, permissionLevel: "assistant", actorUserId: input.actorUserId, ...input.anatomy });
    for (const toStage of ["specification", "development", "testing", "approval", "deployment"] as const) {
      await advanceAgentLifecycleStage(db, { organizationId: input.organizationId, agentId: agent.id, toStage, actorUserId: input.actorUserId });
    }
    await changeAgentPermissionLevel(db, { organizationId: input.organizationId, agentId: agent.id, newPermissionLevel: "assistant", reason: "Sales OS (Module 13) — 'assistant' is the minimum permission level artifact.create_report requires.", actorUserId: input.actorUserId });
  }

  for (const permission of input.permissions) {
    try {
      await grantCrmAgentPermission(db, { organizationId: input.organizationId, agentId: agent.id, permission, actorUserId: input.actorUserId });
    } catch {
      // DuplicateAgentGrantError — already granted from a prior seed call; idempotent no-op.
    }
  }

  return agent;
}

export async function seedSalesAgents(db: Db, input: { organizationId: string; humanOwnerUserId: string; actorUserId: string }): Promise<{ leadResearchAgent: Agent; opportunitySummaryAgent: Agent }> {
  const leadResearchAgent = await seedOneSalesAgent(db, {
    organizationId: input.organizationId,
    name: LEAD_RESEARCH_ASSISTANT_NAME,
    humanOwnerUserId: input.humanOwnerUserId,
    actorUserId: input.actorUserId,
    permissions: LEAD_RESEARCH_CRM_PERMISSIONS,
    anatomy: {
      department: "sales_and_bizdev",
      purpose: "Assemble a bounded research artifact for one CRM lead, using only explicitly permitted CRM data, to help a rep qualify it faster.",
      responsibilities: "Given a lead id, read the lead and its linked contact/company/activities/notes it is permitted to read, and produce a structured research artifact identifying missing qualification data and recommended next questions.",
      goals: "Every fact in its report is mechanically traceable to a real CRM record it was permitted to read during that same execution.",
      inputs: "A CRM lead id.",
      outputs: "One `report` artifact: lead summary, linked contact/company summary, recent activity, and a deterministic missing-information checklist.",
      successCriteria: "The report artifact is created and the execution reaches `completed` through the real Runtime completion gate.",
      failureCriteria: "It lacks a permitted CRM grant for a field the task requires, or the lead cannot be resolved.",
      retirementCriteria: "Superseded by a broader sales research agent, or Sales OS lead research is retired.",
    },
  });

  const opportunitySummaryAgent = await seedOneSalesAgent(db, {
    organizationId: input.organizationId,
    name: OPPORTUNITY_SUMMARY_ASSISTANT_NAME,
    humanOwnerUserId: input.humanOwnerUserId,
    actorUserId: input.actorUserId,
    permissions: OPPORTUNITY_SUMMARY_CRM_PERMISSIONS,
    anatomy: {
      department: "sales_and_bizdev",
      purpose: "Assemble a bounded summary artifact for one CRM opportunity, using only explicitly permitted CRM data, to help a rep or manager review it faster.",
      responsibilities: "Given an opportunity id, read the opportunity and its linked contact/company/activities/notes it is permitted to read, and produce a structured summary identifying open follow-ups and stalled playbook requirements using Sales OS's own deterministic health signals.",
      goals: "Every fact in its summary is mechanically traceable to a real CRM/Sales OS record it was permitted to read during that same execution.",
      inputs: "A CRM opportunity id.",
      outputs: "One `report` artifact: opportunity summary, linked contact/company summary, recent activity, and deterministic health reasons.",
      successCriteria: "The summary artifact is created and the execution reaches `completed` through the real Runtime completion gate.",
      failureCriteria: "It lacks a permitted CRM grant for a field the task requires, or the opportunity cannot be resolved.",
      retirementCriteria: "Superseded by a broader sales research agent, or Sales OS opportunity summarization is retired.",
    },
  });

  return { leadResearchAgent, opportunitySummaryAgent };
}

export async function resolveLeadResearchAssistantAgent(db: Db, organizationId: string): Promise<Agent> {
  const [row] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, organizationId), eq(agents.name, LEAD_RESEARCH_ASSISTANT_NAME)));
  if (!row) throw new SalesAgentNotSeededError(LEAD_RESEARCH_ASSISTANT_NAME);
  return (await resolveAgentById(db, row.id))!;
}

export async function resolveOpportunitySummaryAssistantAgent(db: Db, organizationId: string): Promise<Agent> {
  const [row] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, organizationId), eq(agents.name, OPPORTUNITY_SUMMARY_ASSISTANT_NAME)));
  if (!row) throw new SalesAgentNotSeededError(OPPORTUNITY_SUMMARY_ASSISTANT_NAME);
  return (await resolveAgentById(db, row.id))!;
}

function principalFor(agent: Agent): AgentPrincipal {
  return { principalType: "agent", agentId: agent.id, organizationId: agent.organizationId, permissionLevel: agent.permissionLevel, department: agent.department };
}

async function driveThroughToExecuting(db: Db, organizationId: string, executionId: string, assignedAgentId: string, actorUserId: string, planSteps: string[]): Promise<{ execution: AgentExecution; planId: string }> {
  await assignExecution(db, { organizationId, executionId, assignedAgentId, actorUserId });
  await startExecution(db, { organizationId, executionId, actorUserId });
  await advanceExecution(db, { organizationId, executionId, toStatus: "planning", actorAgentId: assignedAgentId });
  const { plan } = await createPlan(db, { organizationId, executionId, steps: planSteps, actorAgentId: assignedAgentId });
  await advanceExecution(db, { organizationId, executionId, toStatus: "reasoning", actorAgentId: assignedAgentId });
  const execution = await advanceExecution(db, { organizationId, executionId, toStatus: "executing", actorAgentId: assignedAgentId });
  return { execution, planId: plan.id };
}

export interface LeadResearchTaskResult {
  execution: AgentExecution;
  artifact: AgentArtifact;
}

/** The Lead Research Assistant's one task type — synchronous, bounded, evidence-backed. */
export async function createLeadResearchTask(db: Db, input: { organizationId: string; workspaceId?: string | null; leadId: string; actorUserId: string }): Promise<LeadResearchTaskResult> {
  const lead = await getLeadForUser(db, { organizationId: input.organizationId, leadId: input.leadId, actorUserId: input.actorUserId });
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesLeadWorkAuthority(db, ctx, lead);

  const agent = await resolveLeadResearchAssistantAgent(db, input.organizationId);
  const principal = principalFor(agent);

  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId ?? undefined,
    ownerUserId: input.actorUserId,
    goal: `Research CRM lead ${lead.id} and produce a structured research artifact`,
    successCriteria: "A report artifact is created summarizing the lead, linked contact/company, recent activity, and missing qualification data",
    failureCriteria: "The lead cannot be resolved or no permitted CRM grant covers the data this task needs",
    domainsRequested: [],
    actorUserId: input.actorUserId,
  });

  await recordAuditEvent(db, { eventType: "sales_agent_task_enqueued", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_lead", targetId: lead.id, metadata: { agentId: agent.id, taskType: "lead_research" } });

  const { planId } = await driveThroughToExecuting(db, input.organizationId, execution.id, agent.id, input.actorUserId, ["Gather permitted CRM data for this lead", "Produce structured research artifact"]);

  const [contact, company, activities, notes] = await Promise.all([
    lead.contactId ? getContactForAgent(db, principal, lead.contactId) : Promise.resolve(null),
    lead.companyId ? getCompanyForAgent(db, principal, lead.companyId) : Promise.resolve(null),
    listActivitiesForAgent(db, principal, { leadId: lead.id }),
    listNotesForAgent(db, principal, { leadId: lead.id }),
  ]);
  await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId, stepNumber: 1, actorAgentId: agent.id });

  const missing: string[] = [];
  if (!lead.contactId) missing.push("No linked contact");
  if (!lead.companyId) missing.push("No linked company");
  if (!contact?.primaryEmail) missing.push("No contact email on file");
  if (!contact?.primaryPhone) missing.push("No contact phone on file");
  if (activities.length === 0) missing.push("No recorded activity yet");
  if (!lead.estimatedValueAmount) missing.push("No estimated value recorded");

  const reportLines = [
    `Lead ${lead.id} — status: ${lead.status}${lead.score !== null ? `, score: ${lead.score}` : ""}`,
    contact ? `Contact: ${contact.displayName}${contact.jobTitle ? ` (${contact.jobTitle})` : ""}` : "Contact: none linked",
    company ? `Company: ${company.name}${company.industry ? ` — ${company.industry}` : ""}` : "Company: none linked",
    `Recent activity: ${activities.length} recorded event(s)`,
    `Internal notes: ${notes.length} recorded note(s)`,
    lead.qualificationNotes ? `Qualification notes: ${lead.qualificationNotes}` : "",
    "",
    "Missing information / recommended next questions:",
    ...(missing.length > 0 ? missing.map((m) => `- ${m}`) : ["- None — lead has complete baseline information"]),
  ].filter(Boolean);

  const artifact = await createArtifact(db, { organizationId: input.organizationId, executionId: execution.id, artifactType: "report", title: `Lead research — ${lead.id}`, content: reportLines.join("\n"), actorAgentId: agent.id });
  await recordAuditEvent(db, { eventType: "sales_agent_artifact_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_lead", targetId: lead.id, metadata: { agentId: agent.id, artifactId: artifact.id } });

  await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId, stepNumber: 2, actorAgentId: agent.id });
  await createCheckpoint(db, { organizationId: input.organizationId, executionId: execution.id, statusAtCheckpoint: "executing", stepPosition: "artifact_created", safeStateSummary: { leadId: lead.id, artifactId: artifact.id } });
  await advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "verifying", actorAgentId: agent.id });
  const completed = await completeExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorAgentId: agent.id });

  return { execution: completed, artifact };
}

export interface OpportunitySummaryTaskResult {
  execution: AgentExecution;
  artifact: AgentArtifact;
}

/** The Opportunity Summary Assistant's one task type — reuses Sales OS's own deterministic opportunity-health signals as evidence, never a separate ad hoc scoring pass. */
export async function createOpportunitySummaryTask(db: Db, input: { organizationId: string; workspaceId?: string | null; opportunityId: string; actorUserId: string }): Promise<OpportunitySummaryTaskResult> {
  const opportunity = await getOpportunityForUser(db, { organizationId: input.organizationId, opportunityId: input.opportunityId, actorUserId: input.actorUserId });
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesOpportunityWorkAuthority(db, ctx, opportunity);

  const agent = await resolveOpportunitySummaryAssistantAgent(db, input.organizationId);
  const principal = principalFor(agent);

  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId ?? undefined,
    ownerUserId: input.actorUserId,
    goal: `Summarize CRM opportunity ${opportunity.id} and produce a structured summary artifact`,
    successCriteria: "A report artifact is created summarizing the opportunity, linked contact/company, recent activity, and deterministic health reasons",
    failureCriteria: "The opportunity cannot be resolved or no permitted CRM grant covers the data this task needs",
    domainsRequested: [],
    actorUserId: input.actorUserId,
  });

  await recordAuditEvent(db, { eventType: "sales_agent_task_enqueued", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_opportunity", targetId: opportunity.id, metadata: { agentId: agent.id, taskType: "opportunity_summary" } });

  const { planId } = await driveThroughToExecuting(db, input.organizationId, execution.id, agent.id, input.actorUserId, ["Gather permitted CRM data for this opportunity", "Produce structured summary artifact"]);

  const [contact, company, activities, notes, health] = await Promise.all([
    opportunity.primaryContactId ? getContactForAgent(db, principal, opportunity.primaryContactId) : Promise.resolve(null),
    opportunity.companyId ? getCompanyForAgent(db, principal, opportunity.companyId) : Promise.resolve(null),
    listActivitiesForAgent(db, principal, { opportunityId: opportunity.id }),
    listNotesForAgent(db, principal, { opportunityId: opportunity.id }),
    computeOpportunityHealth(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, opportunityId: opportunity.id, actorUserId: input.actorUserId }),
  ]);
  await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId, stepNumber: 1, actorAgentId: agent.id });

  const reportLines = [
    `Opportunity ${opportunity.id} — status: ${opportunity.status}${opportunity.amount ? `, amount: ${opportunity.amount} ${opportunity.currency ?? ""}` : ""}`,
    contact ? `Primary contact: ${contact.displayName}` : "Primary contact: none linked",
    company ? `Company: ${company.name}` : "Company: none linked",
    `Recent activity: ${activities.length} recorded event(s)`,
    `Internal notes: ${notes.length} recorded note(s)`,
    "",
    `Health: ${health.status}`,
    ...(health.reasons.length > 0 ? health.reasons.map((r) => `- ${r.replace(/_/g, " ")}`) : ["- No risk signals detected"]),
  ];

  const artifact = await createArtifact(db, { organizationId: input.organizationId, executionId: execution.id, artifactType: "report", title: `Opportunity summary — ${opportunity.id}`, content: reportLines.join("\n"), actorAgentId: agent.id });
  await recordAuditEvent(db, { eventType: "sales_agent_artifact_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_opportunity", targetId: opportunity.id, metadata: { agentId: agent.id, artifactId: artifact.id } });

  await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId, stepNumber: 2, actorAgentId: agent.id });
  await createCheckpoint(db, { organizationId: input.organizationId, executionId: execution.id, statusAtCheckpoint: "executing", stepPosition: "artifact_created", safeStateSummary: { opportunityId: opportunity.id, artifactId: artifact.id } });
  await advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "verifying", actorAgentId: agent.id });
  const completed = await completeExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorAgentId: agent.id });

  return { execution: completed, artifact };
}

/**
 * A genuinely approval-gated sales action: parks the Opportunity Summary
 * Assistant's execution at `human_approval` (never auto-completes) and
 * records a typed `sales_approval_links` pointer to the real Runtime
 * approval request — never a duplicate approval record.
 */
export async function requestOpportunityContinuationApproval(db: Db, input: { organizationId: string; workspaceId?: string | null; opportunityId: string; summary: string; actorUserId: string }): Promise<{ execution: AgentExecution; approval: AgentApprovalRequest }> {
  const opportunity = await getOpportunityForUser(db, { organizationId: input.organizationId, opportunityId: input.opportunityId, actorUserId: input.actorUserId });
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesOpportunityWorkAuthority(db, ctx, opportunity);

  const agent = await resolveOpportunitySummaryAssistantAgent(db, input.organizationId);

  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId ?? undefined,
    ownerUserId: input.actorUserId,
    goal: `Request approval to continue pursuing opportunity ${opportunity.id}`,
    successCriteria: "A human approval decision is recorded",
    failureCriteria: "The opportunity cannot be resolved",
    domainsRequested: [],
    actorUserId: input.actorUserId,
  });

  await driveThroughToExecuting(db, input.organizationId, execution.id, agent.id, input.actorUserId, ["Request human approval to continue pursuing this opportunity"]);

  const { request } = await requestApproval(db, {
    organizationId: input.organizationId,
    executionId: execution.id,
    requestedAction: "continue_pursuing_opportunity",
    summary: input.summary,
    riskLevel: "low",
    actorAgentId: agent.id,
  });

  await db.insert(salesApprovalLinks).values({ organizationId: input.organizationId, approvalRequestId: request.id, linkedEntityType: "opportunity", linkedEntityId: opportunity.id, purpose: "continue_pursuing_opportunity", createdByUserId: input.actorUserId });
  await recordAuditEvent(db, { eventType: "sales_approval_linked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_opportunity", targetId: opportunity.id, metadata: { approvalRequestId: request.id } });

  const parkedExecution = await resolveExecutionById(db, input.organizationId, execution.id);
  return { execution: parkedExecution, approval: request };
}

/** The lead-side counterpart to `requestOpportunityContinuationApproval`, via the Lead Research Assistant. */
export async function requestLeadReviewApproval(db: Db, input: { organizationId: string; workspaceId?: string | null; leadId: string; summary: string; actorUserId: string }): Promise<{ execution: AgentExecution; approval: AgentApprovalRequest }> {
  const lead = await getLeadForUser(db, { organizationId: input.organizationId, leadId: input.leadId, actorUserId: input.actorUserId });
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesLeadWorkAuthority(db, ctx, lead);

  const agent = await resolveLeadResearchAssistantAgent(db, input.organizationId);

  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId ?? undefined,
    ownerUserId: input.actorUserId,
    goal: `Request approval to review lead ${lead.id}`,
    successCriteria: "A human approval decision is recorded",
    failureCriteria: "The lead cannot be resolved",
    domainsRequested: [],
    actorUserId: input.actorUserId,
  });

  await driveThroughToExecuting(db, input.organizationId, execution.id, agent.id, input.actorUserId, ["Request human approval to review this lead"]);

  const { request } = await requestApproval(db, { organizationId: input.organizationId, executionId: execution.id, requestedAction: "review_lead", summary: input.summary, riskLevel: "low", actorAgentId: agent.id });

  await db.insert(salesApprovalLinks).values({ organizationId: input.organizationId, approvalRequestId: request.id, linkedEntityType: "lead", linkedEntityId: lead.id, purpose: "review_lead", createdByUserId: input.actorUserId });
  await recordAuditEvent(db, { eventType: "sales_approval_linked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_lead", targetId: lead.id, metadata: { approvalRequestId: request.id } });

  const parkedExecution = await resolveExecutionById(db, input.organizationId, execution.id);
  return { execution: parkedExecution, approval: request };
}

/**
 * Module 14 — registers both Sales agents as generic agent task handlers
 * (`sales_lead_research`, `sales_opportunity_summary`) so the Workflow
 * Engine's `agent_execution` node can drive them through the same bounded
 * contract as Company Knowledge Analyst, instead of only being reachable
 * via their own direct-launch APIs. Additive only — `createLeadResearchTask`/
 * `createOpportunitySummaryTask` and the direct-launch APIs are unchanged;
 * this just gives the workflow engine a second, generic way to reach the
 * exact same functions, still enforcing the same CRM-read-only, default-deny
 * Sales OS authority checks those functions already perform internally.
 */
registerAgentTaskHandler({
  taskType: "sales_lead_research",
  expectedAgentName: LEAD_RESEARCH_ASSISTANT_NAME,
  isAgentEligible: (agent) => agent.name === LEAD_RESEARCH_ASSISTANT_NAME && agent.lifecycleStage !== "retired",
  async launch(db, input) {
    const leadId = typeof input.taskInput.leadId === "string" ? input.taskInput.leadId : null;
    if (!leadId) throw new InvalidAgentTaskInputError("sales_lead_research", "leadId is required");
    const { execution } = await createLeadResearchTask(db as Db, { organizationId: input.organizationId, workspaceId: input.workspaceId, leadId, actorUserId: input.actorUserId });
    return { runtimeExecutionId: execution.id };
  },
  resolveState: (db, input) => resolveReportArtifactTaskState(db as Db, "sales_lead_research", input),
});

registerAgentTaskHandler({
  taskType: "sales_opportunity_summary",
  expectedAgentName: OPPORTUNITY_SUMMARY_ASSISTANT_NAME,
  isAgentEligible: (agent) => agent.name === OPPORTUNITY_SUMMARY_ASSISTANT_NAME && agent.lifecycleStage !== "retired",
  async launch(db, input) {
    const opportunityId = typeof input.taskInput.opportunityId === "string" ? input.taskInput.opportunityId : null;
    if (!opportunityId) throw new InvalidAgentTaskInputError("sales_opportunity_summary", "opportunityId is required");
    const { execution } = await createOpportunitySummaryTask(db as Db, { organizationId: input.organizationId, workspaceId: input.workspaceId, opportunityId, actorUserId: input.actorUserId });
    return { runtimeExecutionId: execution.id };
  },
  resolveState: (db, input) => resolveReportArtifactTaskState(db as Db, "sales_opportunity_summary", input),
});
