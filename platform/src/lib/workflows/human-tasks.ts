import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workflowHumanTasks } from "@/db/schema";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { recordWorkflowEvent } from "./events";
import { enqueueWorkflowContinuation } from "./scheduling";
import { WorkflowHumanTaskAlreadyDecidedError, StaleWorkflowUpdateError } from "./errors";
import type { WorkflowHumanTaskStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface WorkflowHumanTask {
  id: string;
  organizationId: string;
  workflowExecutionId: string;
  workflowNodeExecutionId: string;
  title: string;
  instructions: string | null;
  assignedUserId: string;
  dueDate: Date | null;
  status: WorkflowHumanTaskStatus;
  completedByUserId: string | null;
  completedAt: Date | null;
  outputData: Record<string, unknown> | null;
  revision: number;
  createdAt: Date;
}

function toHumanTask(row: typeof workflowHumanTasks.$inferSelect): WorkflowHumanTask {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workflowExecutionId: row.workflowExecutionId,
    workflowNodeExecutionId: row.workflowNodeExecutionId,
    title: row.title,
    instructions: row.instructions,
    assignedUserId: row.assignedUserId,
    dueDate: row.dueDate,
    status: row.status,
    completedByUserId: row.completedByUserId,
    completedAt: row.completedAt,
    outputData: row.outputData as Record<string, unknown> | null,
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

export interface CreateWorkflowHumanTaskInput {
  organizationId: string;
  workflowExecutionId: string;
  workflowNodeExecutionId: string;
  title: string;
  instructions?: string | null;
  assignedUserId: string;
  dueDate?: Date | null;
}

/** Created internally by the node executor (`engine.ts`) — never directly by a human/route caller, matching "a structured manual work item," not an ad hoc one. */
export async function createWorkflowHumanTask(db: Db, input: CreateWorkflowHumanTaskInput): Promise<WorkflowHumanTask> {
  await requireOrganizationMembership(db, input.organizationId, input.assignedUserId);

  const [row] = await db
    .insert(workflowHumanTasks)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      workflowExecutionId: input.workflowExecutionId,
      workflowNodeExecutionId: input.workflowNodeExecutionId,
      title: input.title,
      instructions: input.instructions ?? null,
      assignedUserId: input.assignedUserId,
      dueDate: input.dueDate ?? null,
    })
    .returning();

  await recordAuditEvent(db, { eventType: "workflow_human_task_created", organizationId: input.organizationId, targetType: "workflow_human_task", targetId: row.id, metadata: { workflowExecutionId: input.workflowExecutionId, assignedUserId: input.assignedUserId } });
  await recordWorkflowEvent(db, { organizationId: input.organizationId, workflowExecutionId: input.workflowExecutionId, workflowNodeExecutionId: input.workflowNodeExecutionId, eventType: "workflow_human_task_created", metadata: { assignedUserId: input.assignedUserId } });

  return toHumanTask(row);
}

export async function getWorkflowHumanTaskForUser(db: Db, input: { organizationId: string; taskId: string; actorUserId: string }): Promise<WorkflowHumanTask> {
  await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  const [row] = await db.select().from(workflowHumanTasks).where(and(eq(workflowHumanTasks.id, input.taskId), eq(workflowHumanTasks.organizationId, input.organizationId)));
  if (!row) throw new TenantResourceNotFoundError();
  return toHumanTask(row);
}

/** "My Work" — every workflow human task currently assigned to this user, across every workflow. */
export async function listMyWorkflowHumanTasks(db: Db, input: { organizationId: string; actorUserId: string; status?: WorkflowHumanTaskStatus }): Promise<WorkflowHumanTask[]> {
  await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  const conditions = [eq(workflowHumanTasks.organizationId, input.organizationId), eq(workflowHumanTasks.assignedUserId, input.actorUserId)];
  if (input.status) conditions.push(eq(workflowHumanTasks.status, input.status));
  const rows = await db.select().from(workflowHumanTasks).where(and(...conditions)).orderBy(desc(workflowHumanTasks.createdAt));
  return rows.map(toHumanTask);
}

export interface CompleteWorkflowHumanTaskInput {
  organizationId: string;
  taskId: string;
  expectedRevision: number;
  outputData?: Record<string, unknown> | null;
  actorUserId: string;
}

/** Single-use: an atomic `UPDATE ... WHERE status = 'pending' AND revision = expected` — a second completion attempt (by anyone, including a race between the assignee and an org admin) always loses. Only the assigned user (or an org owner/admin, matching the "respond to workflow-linked human tasks... where authorized" floor) may complete it. */
export async function completeWorkflowHumanTask(db: Db, input: CompleteWorkflowHumanTaskInput): Promise<WorkflowHumanTask> {
  const [existing] = await db.select().from(workflowHumanTasks).where(and(eq(workflowHumanTasks.id, input.taskId), eq(workflowHumanTasks.organizationId, input.organizationId)));
  if (!existing) throw new TenantResourceNotFoundError();

  const membership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  const isAdmin = membership.role === "owner" || membership.role === "admin";
  if (existing.assignedUserId !== input.actorUserId && !isAdmin) {
    throw new InsufficientRoleError("requires being this task's own assignee, or organization owner/admin");
  }
  if (existing.status !== "pending") throw new WorkflowHumanTaskAlreadyDecidedError();

  const [row] = await db
    .update(workflowHumanTasks)
    .set({ status: "completed", completedByUserId: input.actorUserId, completedAt: new Date(), outputData: (input.outputData ?? null) as object | null, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(workflowHumanTasks.id, existing.id), eq(workflowHumanTasks.revision, input.expectedRevision), eq(workflowHumanTasks.status, "pending")))
    .returning();
  if (!row) throw new StaleWorkflowUpdateError("workflow human task");

  await recordAuditEvent(db, { eventType: "workflow_human_task_completed", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_human_task", targetId: existing.id, metadata: { workflowExecutionId: existing.workflowExecutionId } });
  await recordWorkflowEvent(db, { organizationId: input.organizationId, workflowExecutionId: existing.workflowExecutionId, workflowNodeExecutionId: existing.workflowNodeExecutionId, eventType: "workflow_human_task_completed", actorUserId: input.actorUserId });

  await enqueueWorkflowContinuation(db, { organizationId: input.organizationId, workflowExecutionId: existing.workflowExecutionId });

  return toHumanTask(row);
}
