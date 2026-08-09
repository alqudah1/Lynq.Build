export { db, rawSql, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, addOrgMember, makeAgent } from "@/lib/crm/test-helpers";

import { randomUUID } from "node:crypto";
import { db, rawSql, makeUser, addOrgMember } from "@/lib/crm/test-helpers";
import { grantAnalyticsRole } from "./roles";
import { createWorkflowDefinition } from "@/lib/workflows/definitions";
import { createWorkflowVersion } from "@/lib/workflows/versions";
import { createWorkspace } from "@/lib/workspaces/workspaces";
import { workflowExecutions, agentExecutions, toolInvocations, agentApprovalRequests, workspaceMemberships } from "@/db/schema";
import type { AnalyticsRole } from "./validation";

function randKey(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

/** A real workspace inside an existing organization, for workspace-isolation tests. */
export async function makeTestWorkspace(orgId: string, actorUserId: string) {
  const key = randKey("ws").toLowerCase();
  const { workspace } = await createWorkspace(db, rawSql, { organizationId: orgId, name: `Test Workspace ${key}`, slug: key, actorUserId });
  return workspace;
}

/** Adds an existing org member to a workspace directly (bypassing the invitation flow — the minimum a workspace-scoped analytics test needs). */
export async function addWorkspaceMember(workspaceId: string, userId: string, role: "manager" | "member" | "viewer" = "member") {
  await db.insert(workspaceMemberships).values({ workspaceId, userId, role });
}

/** A real org member with an active Analytics OS role, ready to be an actor. */
export async function makeAnalyticsUser(orgId: string, role: AnalyticsRole = "viewer", grantedByUserId?: string): Promise<string> {
  const userId = await makeUser();
  await addOrgMember(orgId, userId, "member");
  await grantAnalyticsRole(db, { organizationId: orgId, userId, role, actorUserId: grantedByUserId ?? userId });
  return userId;
}

/** A real (draft) workflow definition+version — the minimum `workflow_executions` rows need for their own composite tenant-safety FKs; it never needs to be validated/published since the analytics metrics only ever read the execution table's own columns, never drive real orchestration. */
export async function makeTestWorkflowVersion(orgId: string, actorUserId: string) {
  const definition = await createWorkflowDefinition(db, { organizationId: orgId, name: "Test Workflow", workflowKey: randKey("WF"), actorUserId });
  const version = await createWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, actorUserId });
  return { definition, version };
}

/** Directly inserts a `workflow_executions` row with the given status/timestamps — a real canonical row for aggregation, without driving full node-by-node orchestration through the engine. */
export async function seedWorkflowExecution(orgId: string, definitionId: string, versionId: string, status: "running" | "completed" | "failed", timestamps: { startedAt?: Date; completedAt?: Date; workspaceId?: string | null } = {}) {
  const [row] = await db
    .insert(workflowExecutions)
    .values({ organizationId: orgId, workspaceId: timestamps.workspaceId, workflowDefinitionId: definitionId, workflowVersionId: versionId, status, startedAt: timestamps.startedAt, completedAt: timestamps.completedAt })
    .returning();
  return row;
}

/** Directly inserts an `agent_executions` row with the given status/timestamps. */
export async function seedAgentExecution(orgId: string, ownerId: string, status: "executing" | "completed" | "failed", timestamps: { startedAt?: Date; completedAt?: Date; failedAt?: Date; workspaceId?: string | null } = {}) {
  const id = randomUUID();
  const [row] = await db
    .insert(agentExecutions)
    .values({
      id,
      organizationId: orgId,
      workspaceId: timestamps.workspaceId,
      ownerUserId: ownerId,
      rootExecutionId: id,
      goal: "Test goal",
      successCriteria: "Test success criteria",
      failureCriteria: "Test failure criteria",
      status,
      startedAt: timestamps.startedAt,
      completedAt: timestamps.completedAt,
      failedAt: timestamps.failedAt,
    })
    .returning();
  return row;
}

export async function seedToolInvocation(orgId: string, executionId: string, agentId: string, status: "failed" | "timed_out" | "succeeded", completedAt: Date = new Date()) {
  const [row] = await db
    .insert(toolInvocations)
    .values({ organizationId: orgId, executionId, agentId, agentVersionNumber: 1, toolKey: "test.tool", toolVersion: 1, status, idempotencyKey: randKey("idem"), completedAt })
    .returning();
  return row;
}

export async function seedApprovalRequest(orgId: string, executionId: string, agentId: string, status: "pending" = "pending") {
  const [row] = await db
    .insert(agentApprovalRequests)
    .values({ organizationId: orgId, executionId, requestingAgentId: agentId, requestedAction: "test.action", summary: "Test approval", riskLevel: "low", status, expiresAt: new Date(Date.now() + 86_400_000) })
    .returning();
  return row;
}

export function randAnalyticsKey(prefix: string): string {
  return randKey(prefix);
}
