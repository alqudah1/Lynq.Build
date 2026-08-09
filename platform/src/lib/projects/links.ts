import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { projectArtifactLinks, projectApprovalLinks, projectExecutionLinks, agentArtifacts, agentApprovalRequests, agentExecutions } from "@/db/schema";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveProjectById } from "./projects";
import { resolveTaskById } from "./tasks";
import { resolveProjectAuthContext, requireProjectContentAuthority, requireProjectViewAuthority, requireLaunchAgentExecutionAuthority } from "./authz";
import { recordProjectEvent } from "./events";
import { DuplicateArtifactLinkError, DuplicateApprovalLinkError, ActiveExecutionAlreadyLinkedError } from "./errors";
import { resolveKnowledgeAnalystAgent, createKnowledgeAnalystTask } from "@/lib/agents/knowledge-analyst";
import { resolveAgentById } from "@/lib/agents/agents";
import { createExecution } from "@/lib/agent-runtime/executions";
import { assignExecution, startExecution } from "@/lib/agent-runtime/lifecycle";
import { advanceExecution } from "@/lib/agent-runtime/lifecycle";
import { createPlan } from "@/lib/agent-runtime/plans";
import { createCheckpoint } from "@/lib/agent-runtime/checkpoints";
import { enqueueJob } from "@/lib/runtime/queue";
import type { KnowledgeDomain } from "@/lib/brain/knowledge-items";
import type { ProjectLinkedEntityType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

const NON_TERMINAL_EXECUTION_STATUSES = ["queued", "assigned", "gathering_context", "planning", "reasoning", "waiting", "executing", "delegating", "human_approval", "verifying", "paused"] as const;

// ---------------------------------------------------------------------------
// Artifacts — typed references only, never a content copy ("do not
// duplicate artifact content into project tables"). The artifact row
// itself (Module 7's `agent_artifacts`) remains the sole source of truth.
// ---------------------------------------------------------------------------

export interface ProjectArtifactLink {
  id: string;
  projectId: string;
  artifactId: string;
  linkedEntityType: ProjectLinkedEntityType;
  linkedEntityId: string;
  createdAt: Date;
}

export async function linkArtifactToEntity(
  db: Db,
  input: { organizationId: string; projectId: string; artifactId: string; linkedEntityType: ProjectLinkedEntityType; linkedEntityId: string; actorUserId: string }
): Promise<ProjectArtifactLink> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectContentAuthority(db, ctx, project.id);

  const [artifact] = await db.select({ id: agentArtifacts.id }).from(agentArtifacts).where(and(eq(agentArtifacts.id, input.artifactId), eq(agentArtifacts.organizationId, input.organizationId)));
  if (!artifact) throw new TenantResourceNotFoundError();

  let row;
  try {
    [row] = await db
      .insert(projectArtifactLinks)
      .values({ id: randomUUID(), organizationId: input.organizationId, projectId: project.id, artifactId: input.artifactId, linkedEntityType: input.linkedEntityType, linkedEntityId: input.linkedEntityId, linkedByUserId: input.actorUserId })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateArtifactLinkError();
    throw err;
  }

  await recordAuditEvent(db, { eventType: "project_artifact_linked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_artifact_link", targetId: row.id, metadata: { artifactId: input.artifactId, linkedEntityType: input.linkedEntityType, linkedEntityId: input.linkedEntityId } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: project.id, eventType: "project_artifact_linked", actorUserId: input.actorUserId, targetType: input.linkedEntityType, targetId: input.linkedEntityId, metadata: { artifactId: input.artifactId } });

  return { id: row.id, projectId: project.id, artifactId: input.artifactId, linkedEntityType: input.linkedEntityType, linkedEntityId: input.linkedEntityId, createdAt: row.createdAt };
}

export async function listArtifactLinks(db: Db, input: { organizationId: string; projectId: string; actorUserId: string; linkedEntityType?: ProjectLinkedEntityType; linkedEntityId?: string }): Promise<ProjectArtifactLink[]> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectViewAuthority(db, ctx, project.id);

  const conditions = [eq(projectArtifactLinks.projectId, project.id)];
  if (input.linkedEntityType) conditions.push(eq(projectArtifactLinks.linkedEntityType, input.linkedEntityType));
  if (input.linkedEntityId) conditions.push(eq(projectArtifactLinks.linkedEntityId, input.linkedEntityId));

  const rows = await db.select().from(projectArtifactLinks).where(and(...conditions));
  return rows.map((r) => ({ id: r.id, projectId: project.id, artifactId: r.artifactId, linkedEntityType: r.linkedEntityType as ProjectLinkedEntityType, linkedEntityId: r.linkedEntityId, createdAt: r.createdAt }));
}

// ---------------------------------------------------------------------------
// Approvals — the Runtime approval record remains authoritative; this is
// a typed pointer, never a duplicated decision.
// ---------------------------------------------------------------------------

export interface ProjectApprovalLink {
  id: string;
  projectId: string;
  approvalRequestId: string;
  linkedEntityType: ProjectLinkedEntityType;
  linkedEntityId: string;
  status: string;
  createdAt: Date;
}

export async function linkApprovalToEntity(
  db: Db,
  input: { organizationId: string; projectId: string; approvalRequestId: string; linkedEntityType: ProjectLinkedEntityType; linkedEntityId: string; actorUserId: string }
): Promise<ProjectApprovalLink> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectContentAuthority(db, ctx, project.id);

  const [approval] = await db.select({ id: agentApprovalRequests.id, status: agentApprovalRequests.status }).from(agentApprovalRequests).where(and(eq(agentApprovalRequests.id, input.approvalRequestId), eq(agentApprovalRequests.organizationId, input.organizationId)));
  if (!approval) throw new TenantResourceNotFoundError();

  let row;
  try {
    [row] = await db
      .insert(projectApprovalLinks)
      .values({ id: randomUUID(), organizationId: input.organizationId, projectId: project.id, approvalRequestId: input.approvalRequestId, linkedEntityType: input.linkedEntityType, linkedEntityId: input.linkedEntityId, linkedByUserId: input.actorUserId })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateApprovalLinkError();
    throw err;
  }

  await recordAuditEvent(db, { eventType: "project_approval_linked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_approval_link", targetId: row.id, metadata: { approvalRequestId: input.approvalRequestId, linkedEntityType: input.linkedEntityType, linkedEntityId: input.linkedEntityId } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: project.id, eventType: "project_approval_linked", actorUserId: input.actorUserId, targetType: input.linkedEntityType, targetId: input.linkedEntityId, metadata: { approvalRequestId: input.approvalRequestId } });

  return { id: row.id, projectId: project.id, approvalRequestId: input.approvalRequestId, linkedEntityType: input.linkedEntityType, linkedEntityId: input.linkedEntityId, status: approval.status, createdAt: row.createdAt };
}

export async function listApprovalLinks(db: Db, input: { organizationId: string; projectId: string; actorUserId: string; linkedEntityType?: ProjectLinkedEntityType; linkedEntityId?: string }): Promise<ProjectApprovalLink[]> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectViewAuthority(db, ctx, project.id);

  const conditions = [eq(projectApprovalLinks.projectId, project.id)];
  if (input.linkedEntityType) conditions.push(eq(projectApprovalLinks.linkedEntityType, input.linkedEntityType));
  if (input.linkedEntityId) conditions.push(eq(projectApprovalLinks.linkedEntityId, input.linkedEntityId));

  const rows = await db
    .select({ id: projectApprovalLinks.id, approvalRequestId: projectApprovalLinks.approvalRequestId, linkedEntityType: projectApprovalLinks.linkedEntityType, linkedEntityId: projectApprovalLinks.linkedEntityId, createdAt: projectApprovalLinks.createdAt, status: agentApprovalRequests.status })
    .from(projectApprovalLinks)
    .innerJoin(agentApprovalRequests, eq(agentApprovalRequests.id, projectApprovalLinks.approvalRequestId))
    .where(and(...conditions));

  return rows.map((r) => ({ id: r.id, projectId: project.id, approvalRequestId: r.approvalRequestId, linkedEntityType: r.linkedEntityType as ProjectLinkedEntityType, linkedEntityId: r.linkedEntityId, status: r.status, createdAt: r.createdAt }));
}

// ---------------------------------------------------------------------------
// Agent Runtime execution launch — the ONLY way an agent is ever involved
// in a project task. Never a parallel execution model: this creates a
// real `agent_executions` row through the real Runtime (Module 7/8/9),
// then records a typed link back to the task. Task state is never
// auto-changed by this — "human project status remains authoritative."
// ---------------------------------------------------------------------------

export interface ProjectExecutionLink {
  id: string;
  projectId: string;
  taskId: string;
  executionId: string;
  executionStatus: string;
  createdAt: Date;
}

export interface LaunchKnowledgeAnalystForTaskInput {
  organizationId: string;
  projectId: string;
  taskId: string;
  topic: string;
  allowedDomains: KnowledgeDomain[];
  maxResults?: number;
  actorUserId: string;
}

export interface LaunchAgentForTaskInput {
  organizationId: string;
  projectId: string;
  taskId: string;
  agentId: string;
  goal: string;
  successCriteria: string;
  failureCriteria: string;
  allowedDomains: KnowledgeDomain[];
  priority?: number;
  actorUserId: string;
}

/**
 * Launches any deployed registry agent for a project task through the same
 * audited Runtime used everywhere else. This is the office orchestrator's
 * generic counterpart to `launchKnowledgeAnalystForTask`: it creates a real
 * execution, assigns the selected employee, records a recoverable plan, and
 * enqueues the durable Runtime job that continues the work after the request.
 */
export async function launchAgentForTask(db: Db, input: LaunchAgentForTaskInput): Promise<ProjectExecutionLink> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const task = await resolveTaskById(db, input.organizationId, input.taskId);
  if (task.projectId !== project.id) throw new TenantResourceNotFoundError();

  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireLaunchAgentExecutionAuthority(db, ctx, project.id);

  const existingActive = await db
    .select({ id: projectExecutionLinks.id })
    .from(projectExecutionLinks)
    .innerJoin(agentExecutions, eq(agentExecutions.id, projectExecutionLinks.executionId))
    .where(and(eq(projectExecutionLinks.taskId, task.id), inArray(agentExecutions.status, [...NON_TERMINAL_EXECUTION_STATUSES])));
  if (existingActive.length > 0) throw new ActiveExecutionAlreadyLinkedError();

  const agent = await resolveAgentById(db, input.agentId);
  if (!agent || agent.organizationId !== input.organizationId || agent.lifecycleStage === "retired") {
    throw new TenantResourceNotFoundError();
  }

  const created = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId: project.workspaceId,
    ownerUserId: input.actorUserId,
    goal: input.goal,
    successCriteria: input.successCriteria,
    failureCriteria: input.failureCriteria,
    domainsRequested: input.allowedDomains,
    priority: input.priority,
    actorUserId: input.actorUserId,
  });
  const assigned = await assignExecution(db, {
    organizationId: input.organizationId,
    executionId: created.id,
    assignedAgentId: agent.id,
    actorUserId: input.actorUserId,
  });
  const started = await startExecution(db, {
    organizationId: input.organizationId,
    executionId: assigned.id,
    actorUserId: input.actorUserId,
  });
  const planning = await advanceExecution(db, {
    organizationId: input.organizationId,
    executionId: started.id,
    toStatus: "planning",
    actorAgentId: agent.id,
  });
  await createPlan(db, {
    organizationId: input.organizationId,
    executionId: planning.id,
    actorAgentId: agent.id,
    steps: [
      "Analyze the founder objective and the assigned workstream",
      "Produce a concrete, reviewable workstream deliverable",
      "Verify the deliverable against the stated success criteria",
      "Hand the result back to the Executive Assistant for founder review",
    ],
  });
  await createCheckpoint(db, {
    organizationId: input.organizationId,
    executionId: planning.id,
    statusAtCheckpoint: "planning",
    actorAgentId: agent.id,
    safeStateSummary: { officeDirectiveExecution: true, projectId: project.id, taskId: task.id },
  });
  const job = await enqueueJob(db, {
    organizationId: input.organizationId,
    workspaceId: project.workspaceId,
    jobType: "execution_run",
    executionId: planning.id,
    idempotencyKey: `office-exec:${planning.id}`,
    priority: input.priority,
  });

  const [row] = await db
    .insert(projectExecutionLinks)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      projectId: project.id,
      taskId: task.id,
      executionId: planning.id,
      launchedByUserId: input.actorUserId,
    })
    .returning();

  await recordAuditEvent(db, {
    eventType: "project_agent_execution_launched",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "project_task",
    targetId: task.id,
    metadata: { executionId: planning.id, jobId: job.id, agentId: agent.id, source: "office_directive" },
  });
  await recordProjectEvent(db, {
    organizationId: input.organizationId,
    projectId: project.id,
    eventType: "project_agent_execution_launched",
    actorUserId: input.actorUserId,
    targetType: "project_task",
    targetId: task.id,
    metadata: { executionId: planning.id, jobId: job.id, agentId: agent.id, source: "office_directive" },
  });

  return {
    id: row.id,
    projectId: project.id,
    taskId: task.id,
    executionId: planning.id,
    executionStatus: planning.status,
    createdAt: row.createdAt,
  };
}

/**
 * "Support the existing Company Knowledge Analyst agent only" — this
 * function is deliberately named for that one agent, not a generic
 * "launch any agent" entry point; a future module adding a second agent
 * task type would add its own equivalent function, not generalize this
 * one prematurely.
 */
export async function launchKnowledgeAnalystForTask(db: Db, _rawSql: RawSql, input: LaunchKnowledgeAnalystForTaskInput): Promise<ProjectExecutionLink> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const task = await resolveTaskById(db, input.organizationId, input.taskId);
  if (task.projectId !== project.id) throw new TenantResourceNotFoundError();

  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireLaunchAgentExecutionAuthority(db, ctx, project.id);

  const existingActive = await db
    .select({ id: projectExecutionLinks.id })
    .from(projectExecutionLinks)
    .innerJoin(agentExecutions, eq(agentExecutions.id, projectExecutionLinks.executionId))
    .where(and(eq(projectExecutionLinks.taskId, task.id), inArray(agentExecutions.status, [...NON_TERMINAL_EXECUTION_STATUSES])));
  if (existingActive.length > 0) throw new ActiveExecutionAlreadyLinkedError();

  const agent = await resolveKnowledgeAnalystAgent(db, input.organizationId);

  const { execution, job } = await createKnowledgeAnalystTask(db, {
    organizationId: input.organizationId,
    workspaceId: project.workspaceId,
    ownerUserId: input.actorUserId,
    agentId: agent.id,
    topic: input.topic,
    allowedDomains: input.allowedDomains,
    maxResults: input.maxResults,
    actorUserId: input.actorUserId,
  });

  const [row] = await db
    .insert(projectExecutionLinks)
    .values({ id: randomUUID(), organizationId: input.organizationId, projectId: project.id, taskId: task.id, executionId: execution.id, launchedByUserId: input.actorUserId })
    .returning();

  await recordAuditEvent(db, { eventType: "project_agent_execution_launched", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "project_task", targetId: task.id, metadata: { executionId: execution.id, jobId: job.id, agentId: agent.id } });
  await recordProjectEvent(db, { organizationId: input.organizationId, projectId: project.id, eventType: "project_agent_execution_launched", actorUserId: input.actorUserId, targetType: "project_task", targetId: task.id, metadata: { executionId: execution.id } });

  return { id: row.id, projectId: project.id, taskId: task.id, executionId: execution.id, executionStatus: execution.status, createdAt: row.createdAt };
}

export async function listExecutionLinksForTask(db: Db, input: { organizationId: string; taskId: string; actorUserId: string }): Promise<ProjectExecutionLink[]> {
  const task = await resolveTaskById(db, input.organizationId, input.taskId);
  const project = await resolveProjectById(db, input.organizationId, task.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectViewAuthority(db, ctx, project.id);

  const rows = await db
    .select({ id: projectExecutionLinks.id, executionId: projectExecutionLinks.executionId, createdAt: projectExecutionLinks.createdAt, executionStatus: agentExecutions.status })
    .from(projectExecutionLinks)
    .innerJoin(agentExecutions, eq(agentExecutions.id, projectExecutionLinks.executionId))
    .where(eq(projectExecutionLinks.taskId, task.id));

  return rows.map((r) => ({ id: r.id, projectId: task.projectId, taskId: task.id, executionId: r.executionId, executionStatus: r.executionStatus, createdAt: r.createdAt }));
}

/** Every agent execution ever launched anywhere in this project — the "Agents" section's own view, avoiding a per-task query. */
export async function listExecutionLinksForProject(db: Db, input: { organizationId: string; projectId: string; actorUserId: string }): Promise<ProjectExecutionLink[]> {
  const project = await resolveProjectById(db, input.organizationId, input.projectId);
  const ctx = await resolveProjectAuthContext(db, { organizationId: input.organizationId, project, actorUserId: input.actorUserId });
  await requireProjectViewAuthority(db, ctx, project.id);

  const rows = await db
    .select({ id: projectExecutionLinks.id, taskId: projectExecutionLinks.taskId, executionId: projectExecutionLinks.executionId, createdAt: projectExecutionLinks.createdAt, executionStatus: agentExecutions.status })
    .from(projectExecutionLinks)
    .innerJoin(agentExecutions, eq(agentExecutions.id, projectExecutionLinks.executionId))
    .where(eq(projectExecutionLinks.projectId, project.id));

  return rows.map((r) => ({ id: r.id, projectId: project.id, taskId: r.taskId, executionId: r.executionId, executionStatus: r.executionStatus, createdAt: r.createdAt }));
}
