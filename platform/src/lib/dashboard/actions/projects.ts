"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { uuidParam } from "@/lib/http/validation";
import { knowledgeDomainSchema } from "@/lib/brain/validation";
import { createProject, updateProject, transitionProjectStatus } from "@/lib/projects/projects";
import { addProjectMember, changeProjectMemberRole, removeProjectMember } from "@/lib/projects/members";
import { createPhase, updatePhase } from "@/lib/projects/phases";
import { createMilestone, updateMilestone } from "@/lib/projects/milestones";
import { createTask, createTaskAssignedToCreator, transitionTaskStatus, assignTask, unassignTask } from "@/lib/projects/tasks";
import { addDependency, removeDependency } from "@/lib/projects/dependencies";
import { linkArtifactToEntity, linkApprovalToEntity, launchKnowledgeAnalystForTask } from "@/lib/projects/links";
import {
  projectKeySchema,
  projectNameSchema,
  projectPrioritySchema,
  projectStatusSchema,
  projectMemberRoleSchema,
  projectPhaseStatusSchema,
  projectMilestoneStatusSchema,
  taskTitleSchema,
  projectTaskStatusSchema,
  projectLinkedEntityTypeSchema,
} from "@/lib/projects/validation";
import { toActionResult } from "./errors";
import type { ActionResult } from "./types";

async function context(organizationSlug: string, path: string) {
  const env = loadEnv();
  const db = createDbClient(env);
  const rawSql = neon(env.DATABASE_URL);
  const user = await requireDashboardUser(db, path);
  const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
  return { db, rawSql, user, organization };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

const createProjectSchema = z.object({
  workspaceId: uuidParam.optional().or(z.literal("")),
  name: projectNameSchema,
  projectKey: projectKeySchema,
  description: z.string().trim().max(5000).optional(),
  objective: z.string().trim().max(2000).optional(),
  priority: projectPrioritySchema.optional(),
});

export async function createProjectAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/new`);

  const parsed = createProjectSchema.safeParse({
    workspaceId: formData.get("workspaceId") || undefined,
    name: formData.get("name"),
    projectKey: (formData.get("projectKey") as string)?.toUpperCase(),
    description: formData.get("description") || undefined,
    objective: formData.get("objective") || undefined,
    priority: formData.get("priority") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);

  let project;
  try {
    project = await createProject(db, {
      organizationId: organization.id,
      workspaceId: parsed.data.workspaceId || null,
      name: parsed.data.name,
      projectKey: parsed.data.projectKey,
      description: parsed.data.description ?? null,
      objective: parsed.data.objective ?? null,
      priority: parsed.data.priority,
      actorUserId: user.userId,
    });
  } catch (err) {
    return toActionResult(err);
  }

  redirect(`/app/${organizationSlug}/projects/${project.id}`);
}

const updateProjectSchema = z.object({
  expectedRevision: z.coerce.number().int().min(1),
  name: projectNameSchema.optional(),
  description: z.string().trim().max(5000).optional(),
  objective: z.string().trim().max(2000).optional(),
  priority: projectPrioritySchema.optional(),
});

export async function updateProjectAction(organizationSlug: string, projectId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}/settings`);

  const parsed = updateProjectSchema.safeParse({
    expectedRevision: formData.get("expectedRevision"),
    name: formData.get("name") || undefined,
    description: formData.get("description") || undefined,
    objective: formData.get("objective") || undefined,
    priority: formData.get("priority") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    const { expectedRevision, ...updates } = parsed.data;
    await updateProject(db, { organizationId: organization.id, projectId, actorUserId: user.userId, expectedRevision, updates });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}`);
  revalidatePath(`/app/${organizationSlug}/projects/${projectId}/settings`);
  return { ok: true };
}

const transitionProjectSchema = z.object({ toStatus: projectStatusSchema, expectedRevision: z.coerce.number().int().min(1) });

export async function transitionProjectAction(organizationSlug: string, projectId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}`);

  const parsed = transitionProjectSchema.safeParse({ toStatus: formData.get("toStatus"), expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await transitionProjectStatus(db, { organizationId: organization.id, projectId, toStatus: parsed.data.toStatus, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

const addMemberSchema = z.object({ userId: uuidParam, role: projectMemberRoleSchema });

export async function addProjectMemberAction(organizationSlug: string, projectId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}/settings`);

  const parsed = addMemberSchema.safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await addProjectMember(db, { organizationId: organization.id, projectId, targetUserId: parsed.data.userId, role: parsed.data.role, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}/settings`);
  return { ok: true };
}

export async function changeProjectMemberRoleAction(organizationSlug: string, projectId: string, targetUserId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}/settings`);

  const parsed = z.object({ role: projectMemberRoleSchema }).safeParse({ role: formData.get("role") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await changeProjectMemberRole(db, { organizationId: organization.id, projectId, targetUserId, newRole: parsed.data.role, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}/settings`);
  return { ok: true };
}

export async function removeProjectMemberAction(organizationSlug: string, projectId: string, targetUserId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}/settings`);

  try {
    await removeProjectMember(db, { organizationId: organization.id, projectId, targetUserId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}/settings`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

const createPhaseSchema = z.object({ name: projectNameSchema, description: z.string().trim().max(5000).optional(), targetDate: z.string().optional() });

export async function createPhaseAction(organizationSlug: string, projectId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}`);

  const parsed = createPhaseSchema.safeParse({ name: formData.get("name"), description: formData.get("description") || undefined, targetDate: formData.get("targetDate") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createPhase(db, { organizationId: organization.id, projectId, name: parsed.data.name, description: parsed.data.description ?? null, targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : null, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}`);
  return { ok: true };
}

const updatePhaseStatusSchema = z.object({ status: projectPhaseStatusSchema, expectedRevision: z.coerce.number().int().min(1) });

export async function updatePhaseStatusAction(organizationSlug: string, projectId: string, phaseId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}`);

  const parsed = updatePhaseStatusSchema.safeParse({ status: formData.get("status"), expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await updatePhase(db, { organizationId: organization.id, projectId, phaseId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId, updates: { status: parsed.data.status } });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

const createMilestoneSchema = z.object({ title: projectNameSchema, description: z.string().trim().max(5000).optional(), targetDate: z.string().optional() });

export async function createMilestoneAction(organizationSlug: string, projectId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}`);

  const parsed = createMilestoneSchema.safeParse({ title: formData.get("title"), description: formData.get("description") || undefined, targetDate: formData.get("targetDate") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createMilestone(db, { organizationId: organization.id, projectId, title: parsed.data.title, description: parsed.data.description ?? null, targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : null, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}`);
  return { ok: true };
}

const updateMilestoneStatusSchema = z.object({ status: projectMilestoneStatusSchema, expectedRevision: z.coerce.number().int().min(1) });

export async function updateMilestoneStatusAction(organizationSlug: string, projectId: string, milestoneId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}`);

  const parsed = updateMilestoneStatusSchema.safeParse({ status: formData.get("status"), expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await updateMilestone(db, { organizationId: organization.id, projectId, milestoneId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId, updates: { status: parsed.data.status } });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const createTaskSchema = z.object({
  title: taskTitleSchema,
  description: z.string().trim().max(5000).optional(),
  priority: projectPrioritySchema.optional(),
  phaseId: uuidParam.optional().or(z.literal("")),
  milestoneId: uuidParam.optional().or(z.literal("")),
  parentTaskId: uuidParam.optional().or(z.literal("")),
  dueDate: z.string().optional(),
});

export async function createTaskAction(organizationSlug: string, projectId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}`);

  const parsed = createTaskSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    priority: formData.get("priority") || undefined,
    phaseId: formData.get("phaseId") || undefined,
    milestoneId: formData.get("milestoneId") || undefined,
    parentTaskId: formData.get("parentTaskId") || undefined,
    dueDate: formData.get("dueDate") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createTask(db, {
      organizationId: organization.id,
      projectId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      priority: parsed.data.priority,
      phaseId: parsed.data.phaseId || null,
      milestoneId: parsed.data.milestoneId || null,
      parentTaskId: parsed.data.parentTaskId || null,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      actorUserId: user.userId,
    });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}`);
  return { ok: true };
}

const createPersonalTaskSchema = createTaskSchema.extend({ projectId: uuidParam });

/** Adds a task to the caller's own My Work list. The task remains a real
 * project task, with a project owner and audit trail, instead of becoming an
 * untracked private note. */
export async function createPersonalTaskAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/my-work`);
  const parsed = createPersonalTaskSchema.safeParse({
    projectId: formData.get("projectId"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    priority: formData.get("priority") || undefined,
    dueDate: formData.get("dueDate") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    const task = await createTaskAssignedToCreator(db, {
      organizationId: organization.id,
      projectId: parsed.data.projectId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      priority: parsed.data.priority,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      actorUserId: user.userId,
    });
    revalidatePath(`/app/${organizationSlug}/projects/${task.projectId}`);
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/my-work`);
  return { ok: true };
}

const transitionTaskSchema = z.object({ toStatus: projectTaskStatusSchema, expectedRevision: z.coerce.number().int().min(1) });

export async function transitionTaskAction(organizationSlug: string, projectId: string, taskId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}`);

  const parsed = transitionTaskSchema.safeParse({ toStatus: formData.get("toStatus"), expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await transitionTaskStatus(db, { organizationId: organization.id, taskId, toStatus: parsed.data.toStatus, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
    // Module 11: a `project_task` workflow node may be waiting on this exact task — a harmless no-op when it isn't. Projects Core itself has no knowledge of workflows; this is the one, cross-module notification hook.
    const { notifyProjectTaskChanged } = await import("@/lib/workflows/scheduling");
    await notifyProjectTaskChanged(db, { organizationId: organization.id, projectTaskId: taskId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}`);
  return { ok: true };
}

const assignTaskSchema = z.object({ userId: uuidParam });

export async function assignTaskAction(organizationSlug: string, projectId: string, taskId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}`);

  const parsed = assignTaskSchema.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    const assignment = await assignTask(db, { organizationId: organization.id, taskId, targetUserId: parsed.data.userId, actorUserId: user.userId });
    const { resolveTaskById } = await import("@/lib/projects/tasks");
    const { notifyTaskAssigned } = await import("@/lib/email/task-notifier");
    const task = await resolveTaskById(db, organization.id, taskId);
    const notification = await notifyTaskAssigned(db, {
      organizationSlug,
      task,
      assigneeUserId: assignment.userId,
      assignerUserId: user.userId,
    });

    revalidatePath(`/app/${organizationSlug}/projects/${projectId}`);
    if (notification === "sent") return { ok: true, message: "Task assigned and email notification sent." };
    if (notification === "not_configured") return { ok: true, message: "Task assigned. Email notifications are not connected yet." };
    return { ok: true, message: "Task assigned. The email notification could not be delivered." };
  } catch (err) {
    return toActionResult(err);
  }
}

export async function unassignTaskAction(organizationSlug: string, projectId: string, taskId: string, targetUserId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}`);

  try {
    await unassignTask(db, { organizationId: organization.id, taskId, targetUserId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

const addDependencySchema = z.object({ blockingTaskId: uuidParam });

export async function addDependencyAction(organizationSlug: string, projectId: string, taskId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}`);

  const parsed = addDependencySchema.safeParse({ blockingTaskId: formData.get("blockingTaskId") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await addDependency(db, { organizationId: organization.id, blockedTaskId: taskId, blockingTaskId: parsed.data.blockingTaskId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}`);
  return { ok: true };
}

export async function removeDependencyAction(organizationSlug: string, projectId: string, dependencyId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}`);

  try {
    await removeDependency(db, { organizationId: organization.id, dependencyId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Artifacts / Approvals / Agent execution
// ---------------------------------------------------------------------------

const linkArtifactSchema = z.object({ artifactId: uuidParam, linkedEntityType: projectLinkedEntityTypeSchema, linkedEntityId: uuidParam });

export async function linkArtifactAction(organizationSlug: string, projectId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}`);

  const parsed = linkArtifactSchema.safeParse({ artifactId: formData.get("artifactId"), linkedEntityType: formData.get("linkedEntityType"), linkedEntityId: formData.get("linkedEntityId") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await linkArtifactToEntity(db, { organizationId: organization.id, projectId, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}`);
  return { ok: true };
}

const linkApprovalSchema = z.object({ approvalRequestId: uuidParam, linkedEntityType: projectLinkedEntityTypeSchema, linkedEntityId: uuidParam });

export async function linkApprovalAction(organizationSlug: string, projectId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}`);

  const parsed = linkApprovalSchema.safeParse({ approvalRequestId: formData.get("approvalRequestId"), linkedEntityType: formData.get("linkedEntityType"), linkedEntityId: formData.get("linkedEntityId") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await linkApprovalToEntity(db, { organizationId: organization.id, projectId, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}`);
  return { ok: true };
}

const launchAgentSchema = z.object({ topic: z.string().trim().min(1).max(500), allowedDomains: z.array(knowledgeDomainSchema).min(1) });

export async function launchKnowledgeAnalystAction(organizationSlug: string, projectId: string, taskId: string, formData: FormData): Promise<ActionResult> {
  const { db, rawSql, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/projects/${projectId}`);

  const domains = formData.getAll("allowedDomains");
  const parsed = launchAgentSchema.safeParse({ topic: formData.get("topic"), allowedDomains: domains });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await launchKnowledgeAnalystForTask(db, rawSql, { organizationId: organization.id, projectId, taskId, topic: parsed.data.topic, allowedDomains: parsed.data.allowedDomains, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/projects/${projectId}`);
  return { ok: true };
}
