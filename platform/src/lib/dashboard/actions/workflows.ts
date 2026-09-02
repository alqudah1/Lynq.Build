"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { uuidParam } from "@/lib/http/validation";
import { createWorkflowDefinition, updateWorkflowDefinition, transitionWorkflowDefinitionStatus } from "@/lib/workflows/definitions";
import { createWorkflowVersion, validateWorkflowVersionAndPersist, publishWorkflowVersion } from "@/lib/workflows/versions";
import { createWorkflowNode, updateWorkflowNode, deleteWorkflowNode } from "@/lib/workflows/nodes";
import { createWorkflowEdge, deleteWorkflowEdge } from "@/lib/workflows/edges";
import { startWorkflowExecution, pauseWorkflowExecution, resumeWorkflowExecution, cancelWorkflowExecution, retryWorkflowExecution } from "@/lib/workflows/executions";
import { completeWorkflowHumanTask } from "@/lib/workflows/human-tasks";
import { seedStarterTemplates } from "@/lib/workflows/templates";
import { approveRequest, rejectRequest, requestRevision } from "@/lib/agent-runtime/approvals";
import { notifyApprovalDecided } from "@/lib/workflows/scheduling";
import { enqueueJob } from "@/lib/runtime/queue";
import { workflowKeySchema, workflowNameSchema, workflowDefinitionStatusSchema, nodeKeySchema, workflowNodeTypeSchema } from "@/lib/workflows/validation";
import { toActionResult } from "./errors";
import type { ActionResult } from "./types";

async function context(organizationSlug: string, path: string) {
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, path);
  const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
  return { db, user, organization };
}

function parseOptionalJson(raw: FormDataEntryValue | null): unknown {
  if (!raw || typeof raw !== "string" || raw.trim().length === 0) return undefined;
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const createWorkflowSchema = z.object({ workspaceId: uuidParam.optional().or(z.literal("")), name: workflowNameSchema, workflowKey: workflowKeySchema, description: z.string().trim().max(5000).optional() });

export async function createWorkflowAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflows/new`);

  const parsed = createWorkflowSchema.safeParse({
    workspaceId: formData.get("workspaceId") || undefined,
    name: formData.get("name"),
    workflowKey: (formData.get("workflowKey") as string)?.toUpperCase(),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);

  let definition;
  try {
    definition = await createWorkflowDefinition(db, { organizationId: organization.id, workspaceId: parsed.data.workspaceId || null, name: parsed.data.name, workflowKey: parsed.data.workflowKey, description: parsed.data.description ?? null, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  redirect(`/app/${organizationSlug}/workflows/${definition.id}`);
}

const updateWorkflowSchema = z.object({ expectedRevision: z.coerce.number().int().min(1), name: workflowNameSchema.optional(), description: z.string().trim().max(5000).optional() });

export async function updateWorkflowAction(organizationSlug: string, definitionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflows/${definitionId}`);

  const parsed = updateWorkflowSchema.safeParse({ expectedRevision: formData.get("expectedRevision"), name: formData.get("name") || undefined, description: formData.get("description") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    const { expectedRevision, ...updates } = parsed.data;
    await updateWorkflowDefinition(db, { organizationId: organization.id, definitionId, actorUserId: user.userId, expectedRevision, updates });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/workflows/${definitionId}`);
  return { ok: true };
}

const transitionWorkflowSchema = z.object({ toStatus: workflowDefinitionStatusSchema, expectedRevision: z.coerce.number().int().min(1) });

export async function transitionWorkflowAction(organizationSlug: string, definitionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflows/${definitionId}`);

  const parsed = transitionWorkflowSchema.safeParse({ toStatus: formData.get("toStatus"), expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await transitionWorkflowDefinitionStatus(db, { organizationId: organization.id, definitionId, toStatus: parsed.data.toStatus, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/workflows/${definitionId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export async function createVersionAction(organizationSlug: string, definitionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflows/${definitionId}/builder`);

  const changeReason = (formData.get("changeReason") as string) || undefined;
  const cloneFromVersionId = (formData.get("cloneFromVersionId") as string) || undefined;

  let version;
  try {
    version = await createWorkflowVersion(db, { organizationId: organization.id, definitionId, changeReason, cloneFromVersionId: cloneFromVersionId || undefined, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  redirect(`/app/${organizationSlug}/workflows/${definitionId}/builder?versionId=${version.id}`);
}

export async function validateVersionAction(organizationSlug: string, definitionId: string, versionId: string): Promise<ActionResult & { validation?: unknown }> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflows/${definitionId}/builder`);

  try {
    const result = await validateWorkflowVersionAndPersist(db, { organizationId: organization.id, definitionId, versionId, actorUserId: user.userId });
    revalidatePath(`/app/${organizationSlug}/workflows/${definitionId}/builder`);
    return { ok: true, validation: result };
  } catch (err) {
    return toActionResult(err);
  }
}

const publishSchema = z.object({ expectedRevision: z.coerce.number().int().min(1) });

export async function publishVersionAction(organizationSlug: string, definitionId: string, versionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflows/${definitionId}/builder`);

  const parsed = publishSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await publishWorkflowVersion(db, { organizationId: organization.id, definitionId, versionId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/workflows/${definitionId}`);
  revalidatePath(`/app/${organizationSlug}/workflows/${definitionId}/builder`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Nodes / edges
// ---------------------------------------------------------------------------

const createNodeSchema = z.object({ nodeKey: nodeKeySchema, nodeType: workflowNodeTypeSchema, name: workflowNameSchema, configuration: z.string().optional(), inputMapping: z.string().optional(), retryPolicy: z.string().optional() });

export async function createNodeAction(organizationSlug: string, definitionId: string, versionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflows/${definitionId}/builder`);

  const parsed = createNodeSchema.safeParse({ nodeKey: formData.get("nodeKey"), nodeType: formData.get("nodeType"), name: formData.get("name"), configuration: formData.get("configuration") || undefined, inputMapping: formData.get("inputMapping") || undefined, retryPolicy: formData.get("retryPolicy") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    const configuration = parseOptionalJson(parsed.data.configuration ?? null);
    const inputMapping = parseOptionalJson(parsed.data.inputMapping ?? null);
    const retryPolicy = parseOptionalJson(parsed.data.retryPolicy ?? null);
    await createWorkflowNode(db, { organizationId: organization.id, definitionId, versionId, nodeKey: parsed.data.nodeKey, nodeType: parsed.data.nodeType, name: parsed.data.name, configuration, inputMapping, retryPolicy, actorUserId: user.userId });
  } catch (err) {
    if (err instanceof SyntaxError) return { ok: false, code: "invalid_json", message: "Configuration/mapping fields must be valid JSON" };
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/workflows/${definitionId}/builder`);
  return { ok: true };
}

const updateNodeConfigSchema = z.object({ configuration: z.string().optional(), inputMapping: z.string().optional() });

/** Edits an existing node's configuration/input mapping in place — the "edit node configuration" builder requirement, as an alternative to delete-and-recreate. Only legal while the version is still a draft (`updateWorkflowNode` itself enforces this). */
export async function updateNodeAction(organizationSlug: string, definitionId: string, versionId: string, nodeId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflows/${definitionId}/builder`);

  const parsed = updateNodeConfigSchema.safeParse({ configuration: formData.get("configuration") || undefined, inputMapping: formData.get("inputMapping") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    const configuration = parseOptionalJson(parsed.data.configuration ?? null);
    const inputMapping = parseOptionalJson(parsed.data.inputMapping ?? null);
    await updateWorkflowNode(db, { organizationId: organization.id, definitionId, versionId, nodeId, actorUserId: user.userId, updates: { configuration, inputMapping } });
  } catch (err) {
    if (err instanceof SyntaxError) return { ok: false, code: "invalid_json", message: "Configuration/mapping fields must be valid JSON" };
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/workflows/${definitionId}/builder`);
  return { ok: true };
}

export async function deleteNodeAction(organizationSlug: string, definitionId: string, versionId: string, nodeId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflows/${definitionId}/builder`);

  try {
    await deleteWorkflowNode(db, { organizationId: organization.id, definitionId, versionId, nodeId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/workflows/${definitionId}/builder`);
  return { ok: true };
}

const createEdgeSchema = z.object({ sourceNodeId: uuidParam, targetNodeId: uuidParam, conditionKey: z.string().trim().max(60).optional() });

export async function createEdgeAction(organizationSlug: string, definitionId: string, versionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflows/${definitionId}/builder`);

  const parsed = createEdgeSchema.safeParse({ sourceNodeId: formData.get("sourceNodeId"), targetNodeId: formData.get("targetNodeId"), conditionKey: formData.get("conditionKey") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createWorkflowEdge(db, { organizationId: organization.id, definitionId, versionId, sourceNodeId: parsed.data.sourceNodeId, targetNodeId: parsed.data.targetNodeId, conditionKey: parsed.data.conditionKey, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/workflows/${definitionId}/builder`);
  return { ok: true };
}

export async function deleteEdgeAction(organizationSlug: string, definitionId: string, versionId: string, edgeId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflows/${definitionId}/builder`);

  try {
    await deleteWorkflowEdge(db, { organizationId: organization.id, definitionId, versionId, edgeId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/workflows/${definitionId}/builder`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Executions
// ---------------------------------------------------------------------------

const startExecutionSchema = z.object({ projectId: uuidParam.optional().or(z.literal("")), input: z.string().optional() });

export async function startExecutionAction(organizationSlug: string, definitionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflows/${definitionId}`);

  const parsed = startExecutionSchema.safeParse({ projectId: formData.get("projectId") || undefined, input: formData.get("input") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  let execution;
  try {
    const input = parseOptionalJson(parsed.data.input ?? null) as Record<string, unknown> | undefined;
    execution = await startWorkflowExecution(db, { organizationId: organization.id, definitionId, projectId: parsed.data.projectId || null, input, actorUserId: user.userId });
  } catch (err) {
    if (err instanceof SyntaxError) return { ok: false, code: "invalid_json", message: "Input must be valid JSON" };
    return toActionResult(err);
  }

  redirect(`/app/${organizationSlug}/workflow-executions/${execution.id}`);
}

const revisionSchema = z.object({ expectedRevision: z.coerce.number().int().min(1) });

export async function pauseExecutionAction(organizationSlug: string, executionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflow-executions/${executionId}`);
  const parsed = revisionSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await pauseWorkflowExecution(db, { organizationId: organization.id, executionId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/workflow-executions/${executionId}`);
  return { ok: true };
}

export async function resumeExecutionAction(organizationSlug: string, executionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflow-executions/${executionId}`);
  const parsed = revisionSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await resumeWorkflowExecution(db, { organizationId: organization.id, executionId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/workflow-executions/${executionId}`);
  return { ok: true };
}

export async function cancelExecutionAction(organizationSlug: string, executionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflow-executions/${executionId}`);
  const parsed = revisionSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await cancelWorkflowExecution(db, { organizationId: organization.id, executionId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/workflow-executions/${executionId}`);
  return { ok: true };
}

export async function retryExecutionAction(organizationSlug: string, executionId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflow-executions/${executionId}`);
  const parsed = revisionSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await retryWorkflowExecution(db, { organizationId: organization.id, executionId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/workflow-executions/${executionId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Human tasks
// ---------------------------------------------------------------------------

const completeHumanTaskSchema = z.object({ expectedRevision: z.coerce.number().int().min(1), notes: z.string().trim().max(2000).optional() });

export async function completeHumanTaskAction(organizationSlug: string, taskId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/my-work`);

  const parsed = completeHumanTaskSchema.safeParse({ expectedRevision: formData.get("expectedRevision"), notes: formData.get("notes") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await completeWorkflowHumanTask(db, { organizationId: organization.id, taskId, expectedRevision: parsed.data.expectedRevision, outputData: parsed.data.notes ? { notes: parsed.data.notes } : undefined, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/my-work`);
  return { ok: true };
}

/** "Pending approvals the user may decide" — reuses the existing Agent Runtime approval decision functions unmodified (Module 7); this is not a new decision mechanism, only a UI surface for one that already existed but had no dashboard page yet. */
export async function approveApprovalAction(organizationSlug: string, approvalId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/my-work`);
  try {
    const approval = await approveRequest(db, { organizationId: organization.id, approvalId, actorUserId: user.userId });
    await notifyApprovalDecided(db, { organizationId: organization.id, approvalRequestId: approvalId });
    await enqueueJob(db, { organizationId: organization.id, jobType: "execution_resume", executionId: approval.executionId, idempotencyKey: `my-work-approval-resume:${approval.id}`, priority: 100 });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/my-work`);
  return { ok: true };
}

export async function requestApprovalRevisionAction(organizationSlug: string, approvalId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/my-work`);
  const decisionNote = (formData.get("decisionNote") as string) || undefined;
  try {
    const approval = await requestRevision(db, { organizationId: organization.id, approvalId, decisionNote, actorUserId: user.userId });
    await notifyApprovalDecided(db, { organizationId: organization.id, approvalRequestId: approvalId });
    await enqueueJob(db, { organizationId: organization.id, jobType: "execution_resume", executionId: approval.executionId, idempotencyKey: `my-work-revision-resume:${approval.id}`, priority: 100 });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/my-work`);
  return { ok: true };
}

export async function rejectApprovalAction(organizationSlug: string, approvalId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/my-work`);
  const decisionNote = (formData.get("decisionNote") as string) || undefined;
  try {
    await rejectRequest(db, { organizationId: organization.id, approvalId, decisionNote, actorUserId: user.userId, severe: true });
    await notifyApprovalDecided(db, { organizationId: organization.id, approvalRequestId: approvalId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/my-work`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function seedTemplatesAction(organizationSlug: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/workflows`);

  try {
    await seedStarterTemplates(db, { organizationId: organization.id, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/workflows`);
  return { ok: true };
}
