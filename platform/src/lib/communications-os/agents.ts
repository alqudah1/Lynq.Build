import "server-only";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agents, agentExecutions, communicationApprovalLinks, communicationMessages } from "@/db/schema";
import { registerAgent, resolveAgentById, type Agent } from "@/lib/agents/agents";
import { advanceAgentLifecycleStage, changeAgentPermissionLevel } from "@/lib/agents/lifecycle";
import { createExecution, resolveExecutionById, type AgentExecution } from "@/lib/agent-runtime/executions";
import { assignExecution, startExecution, advanceExecution } from "@/lib/agent-runtime/lifecycle";
import { createPlan, completePlanStep } from "@/lib/agent-runtime/plans";
import { createArtifact, listArtifactsForExecution, type AgentArtifact } from "@/lib/agent-runtime/artifacts";
import { requestApproval, type AgentApprovalRequest } from "@/lib/agent-runtime/approvals";
import { recordAuditEvent } from "@/lib/audit";
import { registerAgentTaskHandler, InvalidAgentTaskInputError, type AgentTaskState } from "@/lib/agent-runtime/task-handlers";
import { getConversationForUser, resolveConversationById } from "./conversations";
import { CommunicationsAgentNotSeededError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Communications OS agents — Module 16
 * ============================================================================
 * One narrow agent, two task types (`communications_draft_reply`,
 * `communications_draft_follow_up`) — both draft only, driven synchronously
 * through the real Agent Runtime execution lifecycle exactly like Sales/
 * Marketing OS's own agents. Neither task type can send a message, override
 * suppression, approve its own draft, change CRM ownership/stage, or invent
 * a recipient — a draft's recipient is always derived from the conversation
 * it belongs to, never supplied by the agent. This same agent also hosts
 * message-send approval requests (`requestMessageSendApproval`) — reusing
 * one registered identity for both jobs, exactly the way Sales OS's own
 * agents double as their domain's approval host.
 */
export const COMMUNICATIONS_ASSISTANT_NAME = "Communications Assistant";

export async function seedCommunicationsAgent(db: Db, input: { organizationId: string; humanOwnerUserId: string; actorUserId: string }): Promise<Agent> {
  const [existingRow] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, input.organizationId), eq(agents.name, COMMUNICATIONS_ASSISTANT_NAME)));
  if (existingRow) return (await resolveAgentById(db, existingRow.id))!;

  const agent = await registerAgent(db, {
    organizationId: input.organizationId,
    name: COMMUNICATIONS_ASSISTANT_NAME,
    humanOwnerUserId: input.humanOwnerUserId,
    permissionLevel: "assistant",
    actorUserId: input.actorUserId,
    department: "marketing_and_brand",
    purpose: "Draft bounded reply/follow-up message text for a real conversation, and host human approval decisions for outbound sends — never send a message itself.",
    responsibilities: "Given a conversation id (and for follow-ups, a reason), read that conversation's own message history via the launching human's own Communications authority, and produce a structured draft message plus a deterministic missing-information checklist. Recipient is always the conversation's own resolved counterpart — never agent-supplied.",
    goals: "Every draft is mechanically traceable to real conversation data it was permitted to read during that same execution.",
    inputs: "A conversation id, and for follow-ups a reason/context string.",
    outputs: "One draft_text artifact plus one new communication_messages row in draft status.",
    successCriteria: "The draft artifact and message are created and the execution reaches completed.",
    failureCriteria: "The conversation cannot be resolved, or the launching human lacks Communications view authority for it.",
    retirementCriteria: "Superseded by a broader communications drafting agent, or Communications OS agent drafting is retired.",
  });

  for (const toStage of ["specification", "development", "testing", "approval", "deployment"] as const) {
    await advanceAgentLifecycleStage(db, { organizationId: input.organizationId, agentId: agent.id, toStage, actorUserId: input.actorUserId });
  }
  await changeAgentPermissionLevel(db, { organizationId: input.organizationId, agentId: agent.id, newPermissionLevel: "assistant", reason: "Communications OS (Module 16) — 'assistant' is the minimum permission level artifact creation requires.", actorUserId: input.actorUserId });
  return agent;
}

export async function resolveCommunicationsAssistantAgent(db: Db, organizationId: string): Promise<Agent> {
  const [row] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, organizationId), eq(agents.name, COMMUNICATIONS_ASSISTANT_NAME)));
  if (!row) throw new CommunicationsAgentNotSeededError();
  return (await resolveAgentById(db, row.id))!;
}

/** Mirrors Sales/Marketing OS's own `driveThroughToExecuting` exactly. */
export async function driveThroughToExecuting(db: Db, organizationId: string, executionId: string, assignedAgentId: string, actorUserId: string, planSteps: string[]): Promise<{ execution: AgentExecution; planId: string }> {
  await assignExecution(db, { organizationId, executionId, assignedAgentId, actorUserId });
  await startExecution(db, { organizationId, executionId, actorUserId });
  await advanceExecution(db, { organizationId, executionId, toStatus: "planning", actorAgentId: assignedAgentId });
  const { plan } = await createPlan(db, { organizationId, executionId, steps: planSteps, actorAgentId: assignedAgentId });
  await advanceExecution(db, { organizationId, executionId, toStatus: "reasoning", actorAgentId: assignedAgentId });
  const execution = await advanceExecution(db, { organizationId, executionId, toStatus: "executing", actorAgentId: assignedAgentId });
  return { execution, planId: plan.id };
}

const MAX_HISTORY_MESSAGES = 10;

async function loadBoundedConversationHistory(db: Db, organizationId: string, conversationId: string): Promise<Array<{ direction: string; senderReference: string | null; recipientReference: string | null; bodyText: string | null; createdAt: Date }>> {
  const rows = await db
    .select({ direction: communicationMessages.direction, senderReference: communicationMessages.senderReference, recipientReference: communicationMessages.recipientReference, bodyText: communicationMessages.bodyText, createdAt: communicationMessages.createdAt })
    .from(communicationMessages)
    .where(and(eq(communicationMessages.organizationId, organizationId), eq(communicationMessages.conversationId, conversationId)))
    .orderBy(desc(communicationMessages.createdAt))
    .limit(MAX_HISTORY_MESSAGES);
  return rows.reverse();
}

export interface DraftTaskResult {
  execution: AgentExecution;
  artifact: AgentArtifact;
  draftMessageId: string;
}

/**
 * The Communications Assistant's `communications_draft_reply` task —
 * synchronous, bounded, evidence-backed. Recipient is always the
 * conversation's own last inbound sender (a reply always addresses whoever
 * last wrote in), never an agent-chosen value.
 */
export async function createDraftReplyTask(db: Db, input: { organizationId: string; conversationId: string; actorUserId: string }): Promise<DraftTaskResult> {
  const conversation = await getConversationForUser(db, { organizationId: input.organizationId, conversationId: input.conversationId, actorUserId: input.actorUserId });
  const agent = await resolveCommunicationsAssistantAgent(db, input.organizationId);
  const history = await loadBoundedConversationHistory(db, input.organizationId, input.conversationId);

  const lastInbound = [...history].reverse().find((m) => m.direction === "inbound");
  const recipientReference = lastInbound?.senderReference ?? null;

  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId: conversation.workspaceId ?? undefined,
    ownerUserId: input.actorUserId,
    goal: `Draft a reply for conversation ${conversation.id}`,
    successCriteria: "A structured draft is produced and attached as a new message",
    failureCriteria: "The conversation cannot be resolved",
    domainsRequested: [],
    actorUserId: input.actorUserId,
  });
  const { planId } = await driveThroughToExecuting(db, input.organizationId, execution.id, agent.id, input.actorUserId, ["Read conversation history", "Produce structured reply draft"]);
  await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId, stepNumber: 1, actorAgentId: agent.id });

  const missing: string[] = [];
  if (!recipientReference) missing.push("No inbound message found to reply to — recipient could not be determined");
  if (history.length === 0) missing.push("No conversation history available");

  const historySummary = history.map((m) => `[${m.direction}] ${m.bodyText ?? "(no body)"}`).join("\n");
  const draftBody = missing.length > 0
    ? "Unable to draft a reply: " + missing.join("; ")
    : `Draft reply (structural placeholder — review and personalize before sending):\n\nHi,\n\nThanks for your message. [Draft continues based on conversation context below.]\n\n---\nConversation context:\n${historySummary}`;

  const artifact = await createArtifact(db, {
    organizationId: input.organizationId,
    executionId: execution.id,
    artifactType: "draft_text",
    title: `Reply draft — conversation ${conversation.id}`,
    content: JSON.stringify({ conversationId: conversation.id, recipientReference, draftBody, missingInformation: missing, generatedAt: new Date().toISOString() }),
    actorAgentId: agent.id,
  });

  const [draftMessage] = recipientReference
    ? await db
        .insert(communicationMessages)
        .values({
          organizationId: input.organizationId,
          conversationId: conversation.id,
          direction: "outbound",
          channel: conversation.channel,
          integrationConnectionId: conversation.integrationConnectionId,
          senderReference: null,
          recipientReference,
          bodyText: draftBody,
          contentArtifactId: artifact.id,
          status: "draft",
          idempotencyKey: `agent-draft-reply:${execution.id}`,
          createdByAgentId: agent.id,
        })
        .returning()
    : [];

  if (draftMessage) {
    await recordAuditEvent(db, { eventType: "communication_agent_draft_created", actorAgentId: agent.id, organizationId: input.organizationId, targetType: "communication_message", targetId: draftMessage.id, metadata: { conversationId: conversation.id, taskType: "communications_draft_reply" } });
  }

  const finalExecution = await resolveExecutionById(db, input.organizationId, execution.id);
  return { execution: finalExecution, artifact, draftMessageId: draftMessage?.id ?? "" };
}

/** The Communications Assistant's `communications_draft_follow_up` task — same bounded shape, oriented at initiating contact rather than replying to one. */
export async function createDraftFollowUpTask(db: Db, input: { organizationId: string; conversationId: string; reason: string; actorUserId: string }): Promise<DraftTaskResult> {
  const conversation = await getConversationForUser(db, { organizationId: input.organizationId, conversationId: input.conversationId, actorUserId: input.actorUserId });
  const agent = await resolveCommunicationsAssistantAgent(db, input.organizationId);
  const history = await loadBoundedConversationHistory(db, input.organizationId, input.conversationId);

  // A follow-up addresses whoever the ORG has been corresponding with on this thread — the counterpart of the most recent message in either direction, never an agent-invented recipient.
  const lastMessage = history[history.length - 1];
  const recipientReference = lastMessage ? (lastMessage.direction === "inbound" ? lastMessage.senderReference : lastMessage.recipientReference) : null;

  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId: conversation.workspaceId ?? undefined,
    ownerUserId: input.actorUserId,
    goal: `Draft a follow-up for conversation ${conversation.id}`,
    successCriteria: "A structured draft is produced and attached as a new message",
    failureCriteria: "The conversation cannot be resolved",
    domainsRequested: [],
    actorUserId: input.actorUserId,
  });
  const { planId } = await driveThroughToExecuting(db, input.organizationId, execution.id, agent.id, input.actorUserId, ["Read conversation history", "Produce structured follow-up draft"]);
  await completePlanStep(db, { organizationId: input.organizationId, executionId: execution.id, planId, stepNumber: 1, actorAgentId: agent.id });

  const missing: string[] = [];
  if (!recipientReference) missing.push("No prior message found on this conversation — recipient could not be determined");

  const draftBody = missing.length > 0
    ? "Unable to draft a follow-up: " + missing.join("; ")
    : `Follow-up draft (structural placeholder — review and personalize before sending):\n\nHi,\n\nFollowing up on our conversation. Reason: ${input.reason}\n\n[Draft continues.]`;

  const artifact = await createArtifact(db, {
    organizationId: input.organizationId,
    executionId: execution.id,
    artifactType: "draft_text",
    title: `Follow-up draft — conversation ${conversation.id}`,
    content: JSON.stringify({ conversationId: conversation.id, recipientReference, reason: input.reason, draftBody, missingInformation: missing, generatedAt: new Date().toISOString() }),
    actorAgentId: agent.id,
  });

  const [draftMessage] = recipientReference
    ? await db
        .insert(communicationMessages)
        .values({
          organizationId: input.organizationId,
          conversationId: conversation.id,
          direction: "outbound",
          channel: conversation.channel,
          integrationConnectionId: conversation.integrationConnectionId,
          senderReference: null,
          recipientReference,
          bodyText: draftBody,
          contentArtifactId: artifact.id,
          status: "draft",
          idempotencyKey: `agent-draft-follow-up:${execution.id}`,
          createdByAgentId: agent.id,
        })
        .returning()
    : [];

  if (draftMessage) {
    await recordAuditEvent(db, { eventType: "communication_agent_draft_created", actorAgentId: agent.id, organizationId: input.organizationId, targetType: "communication_message", targetId: draftMessage.id, metadata: { conversationId: conversation.id, taskType: "communications_draft_follow_up" } });
  }

  const finalExecution = await resolveExecutionById(db, input.organizationId, execution.id);
  return { execution: finalExecution, artifact, draftMessageId: draftMessage?.id ?? "" };
}

/**
 * Genuinely approval-gated: parks a fresh Communications Assistant
 * execution at `human_approval` and records a typed
 * `communication_approval_links` pointer to the real Runtime approval
 * request. This is the ONLY path that ever moves a message to `approved`
 * downstream (via `approveRequest`) — an agent can create the draft this
 * requests approval for, but cannot decide the approval itself (Runtime's
 * `approveRequest` requires a human `actorUserId`, structurally).
 */
export async function requestMessageSendApproval(db: Db, input: { organizationId: string; workspaceId?: string | null; messageId: string; summary: string; artifactId?: string | null; actorUserId: string }): Promise<{ execution: AgentExecution; approval: AgentApprovalRequest }> {
  const agent = await resolveCommunicationsAssistantAgent(db, input.organizationId);

  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId ?? undefined,
    ownerUserId: input.actorUserId,
    goal: `Request approval to send message ${input.messageId}`,
    successCriteria: "A human approval decision is recorded",
    failureCriteria: "The message cannot be resolved",
    domainsRequested: [],
    actorUserId: input.actorUserId,
  });
  await driveThroughToExecuting(db, input.organizationId, execution.id, agent.id, input.actorUserId, ["Request human approval to send this message"]);

  const { request } = await requestApproval(db, {
    organizationId: input.organizationId,
    executionId: execution.id,
    requestedAction: "send_communication_message",
    summary: input.summary,
    riskLevel: "low",
    artifactId: input.artifactId ?? null,
    actorAgentId: agent.id,
  });

  await db.insert(communicationApprovalLinks).values({ organizationId: input.organizationId, approvalRequestId: request.id, linkedEntityType: "message", linkedEntityId: input.messageId, purpose: "send_communication_message", createdByUserId: input.actorUserId });

  const parkedExecution = await resolveExecutionById(db, input.organizationId, execution.id);
  return { execution: parkedExecution, approval: request };
}

/** Same shape as `requestMessageSendApproval`, for a bulk batch's own approval gate. */
export async function requestBulkBatchApproval(db: Db, input: { organizationId: string; workspaceId?: string | null; batchId: string; summary: string; actorUserId: string }): Promise<{ execution: AgentExecution; approval: AgentApprovalRequest }> {
  const agent = await resolveCommunicationsAssistantAgent(db, input.organizationId);

  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId ?? undefined,
    ownerUserId: input.actorUserId,
    goal: `Request approval to run bulk batch ${input.batchId}`,
    successCriteria: "A human approval decision is recorded",
    failureCriteria: "The batch cannot be resolved",
    domainsRequested: [],
    actorUserId: input.actorUserId,
  });
  await driveThroughToExecuting(db, input.organizationId, execution.id, agent.id, input.actorUserId, ["Request human approval to run this bulk batch"]);

  const { request } = await requestApproval(db, {
    organizationId: input.organizationId,
    executionId: execution.id,
    requestedAction: "run_bulk_batch",
    summary: input.summary,
    riskLevel: "medium",
    actorAgentId: agent.id,
  });

  await db.insert(communicationApprovalLinks).values({ organizationId: input.organizationId, approvalRequestId: request.id, linkedEntityType: "bulk_batch", linkedEntityId: input.batchId, purpose: "run_bulk_batch", createdByUserId: input.actorUserId });

  const parkedExecution = await resolveExecutionById(db, input.organizationId, execution.id);
  return { execution: parkedExecution, approval: request };
}

// ---------------------------------------------------------------------------
// Module 14 generic agent task handler registration.
// ---------------------------------------------------------------------------

/**
 * Both Communications OS task types produce a `draft_text` artifact (a
 * message draft is not a "report") — the shared `resolveReportArtifactTaskState`
 * helper only ever looks for `artifactType === "report"`, so it would never
 * find this evidence. This is the `draft_text` counterpart, otherwise
 * identical: a live check of the linked execution, never a cached status.
 */
async function resolveDraftArtifactTaskState(db: Db, taskType: "communications_draft_reply" | "communications_draft_follow_up", input: { organizationId: string; runtimeExecutionId: string }): Promise<AgentTaskState> {
  const [row] = await db.select().from(agentExecutions).where(and(eq(agentExecutions.id, input.runtimeExecutionId), eq(agentExecutions.organizationId, input.organizationId)));
  if (!row) return { status: "pending" };

  if (row.status === "completed") {
    const artifacts = await listArtifactsForExecution(db, input.organizationId, row.id);
    const draft = artifacts.filter((a) => a.artifactType === "draft_text").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return {
      status: "succeeded",
      evidence: {
        runtimeExecutionId: row.id,
        taskType,
        status: "succeeded",
        primaryArtifactId: draft?.id ?? null,
        artifactIds: draft ? [draft.id] : [],
        structuredOutput: { draftArtifactId: draft?.id ?? null },
        completedAt: row.completedAt ?? new Date(),
      },
    };
  }
  if (row.status === "failed" || row.status === "cancelled") {
    return { status: "failed", failureClassification: row.status === "cancelled" ? "cancelled" : "runtime_execution_failed", message: `linked agent execution ${row.status}` };
  }
  return { status: "pending" };
}

registerAgentTaskHandler({
  taskType: "communications_draft_reply",
  expectedAgentName: COMMUNICATIONS_ASSISTANT_NAME,
  isAgentEligible: (agent) => agent.name === COMMUNICATIONS_ASSISTANT_NAME && agent.lifecycleStage !== "retired",
  launch: async (db, input) => {
    const conversationId = input.taskInput?.conversationId;
    if (typeof conversationId !== "string") throw new InvalidAgentTaskInputError("communications_draft_reply", "conversationId is required and must be a string");
    await resolveConversationById(db, input.organizationId, conversationId);
    const result = await createDraftReplyTask(db, { organizationId: input.organizationId, conversationId, actorUserId: input.actorUserId });
    return { runtimeExecutionId: result.execution.id };
  },
  resolveState: (db, input) => resolveDraftArtifactTaskState(db as Db, "communications_draft_reply", input),
});

registerAgentTaskHandler({
  taskType: "communications_draft_follow_up",
  expectedAgentName: COMMUNICATIONS_ASSISTANT_NAME,
  isAgentEligible: (agent) => agent.name === COMMUNICATIONS_ASSISTANT_NAME && agent.lifecycleStage !== "retired",
  launch: async (db, input) => {
    const conversationId = input.taskInput?.conversationId;
    const reason = input.taskInput?.reason;
    if (typeof conversationId !== "string") throw new InvalidAgentTaskInputError("communications_draft_follow_up", "conversationId is required and must be a string");
    if (typeof reason !== "string") throw new InvalidAgentTaskInputError("communications_draft_follow_up", "reason is required and must be a string");
    await resolveConversationById(db, input.organizationId, conversationId);
    const result = await createDraftFollowUpTask(db, { organizationId: input.organizationId, conversationId, reason, actorUserId: input.actorUserId });
    return { runtimeExecutionId: result.execution.id };
  },
  resolveState: (db, input) => resolveDraftArtifactTaskState(db as Db, "communications_draft_follow_up", input),
});
