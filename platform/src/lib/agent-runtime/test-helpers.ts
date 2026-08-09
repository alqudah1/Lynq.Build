import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import {
  users,
  organizations,
  organizationMemberships,
  agents,
  agentVersions,
  agentCredentials,
  brainPermissionGrants,
  agentExecutions,
  agentExecutionEvents,
  agentCheckpoints,
  agentPlans,
  agentPlanSteps,
  agentApprovalRequests,
  agentArtifacts,
  agentDelegations,
  agentTaskDependencies,
  auditLogs,
  knowledgeItems,
  toolInvocations,
  runtimeJobs,
} from "@/db/schema";
import { registerAgent } from "@/lib/agents/agents";
import { issueAgentCredential } from "@/lib/agents/credentials";
import { createBrainPermissionGrant, revokeBrainPermissionGrant, listBrainPermissionGrants } from "@/lib/brain/permissions";
import { createKnowledgeItem, type KnowledgeDomain } from "@/lib/brain/knowledge-items";
import { createExecution } from "@/lib/agent-runtime/executions";
import { assignExecution, startExecution, advanceExecution } from "@/lib/agent-runtime/lifecycle";
import { seedInitialTools } from "@/lib/tools/seed";

export const env = loadEnv();
export const db = createDbClient(env);
export const rawSql = neon(env.DATABASE_URL);

export const createdOrgIds: string[] = [];
export const createdUserIds: string[] = [];

export async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `agent-runtime-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

export async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Agent Runtime Test Org", slug: `agent-runtime-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

export async function makeAgent(orgId: string, ownerId: string, permissionLevel: "observer" | "assistant" | "manager" = "assistant") {
  return registerAgent(db, {
    organizationId: orgId,
    humanOwnerUserId: ownerId,
    actorUserId: ownerId,
    name: "Runtime Test Agent",
    department: "engineering",
    purpose: "Exercise the agent runtime in tests",
    responsibilities: "None — test fixture only",
    goals: "N/A",
    inputs: "N/A",
    outputs: "N/A",
    successCriteria: "N/A",
    failureCriteria: "N/A",
    retirementCriteria: "Deleted when the test finishes",
    permissionLevel,
  });
}

export async function makeAgentWithCredential(orgId: string, ownerId: string, permissionLevel: "observer" | "assistant" | "manager" = "assistant") {
  const agent = await makeAgent(orgId, ownerId, permissionLevel);
  const { plaintextSecret } = await issueAgentCredential(db, { organizationId: orgId, agentId: agent.id, actorUserId: ownerId });
  return { agent, secret: plaintextSecret };
}

export async function grantAgentCapability(orgId: string, ownerId: string, agentId: string, domain: KnowledgeDomain, capability: "read" | "draft_write") {
  await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain, workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability }).onConflictDoNothing();
  await createBrainPermissionGrant(db, { organizationId: orgId, domain, grantee: { type: "agent", agentId }, capability, actorUserId: ownerId });
}

export function authedRequest(url: string, secret: string, init: RequestInit = {}): Request {
  return new Request(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${secret}` } });
}

export async function makeKnowledgeItem(orgId: string, ownerId: string, domain: KnowledgeDomain, title: string, content: string) {
  return createKnowledgeItem(db, rawSql, { organizationId: orgId, domain, classification: "note", title, content, actorUserId: ownerId });
}

/** Brings a fresh execution all the way to `executing` through the real Runtime — the shared fixture every Module 8/9 test needing a live, tool-callable execution reuses. */
export async function bringExecutionToExecuting(orgId: string, ownerId: string, agentId: string) {
  const execution = await createExecution(db, {
    organizationId: orgId,
    ownerUserId: ownerId,
    goal: "Runtime test execution",
    successCriteria: "n/a",
    failureCriteria: "n/a",
    domainsRequested: ["identity"],
    actorUserId: ownerId,
  });
  await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agentId, actorUserId: ownerId });
  await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
  await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "planning", actorAgentId: agentId });
  await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "reasoning", actorAgentId: agentId });
  await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "executing", actorAgentId: agentId });
  return execution;
}

export async function revokeAgentCapability(orgId: string, ownerId: string, agentId: string, domain: KnowledgeDomain, capability: "read" | "draft_write"): Promise<void> {
  const grants = await listBrainPermissionGrants(db, { organizationId: orgId, actorUserId: ownerId, granteeAgentId: agentId, domain });
  const grant = grants.find((g) => g.capability === capability);
  if (grant) await revokeBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, actorUserId: ownerId });
}

let toolsSeeded = false;
/** Idempotent — the 3 real tool definitions are permanent, global seed data (never deleted by test cleanup), matching the task's own "except permanent seed/global tool definitions" allowance. */
export async function ensureToolsSeeded(): Promise<void> {
  if (toolsSeeded) return;
  await seedInitialTools(db);
  toolsSeeded = true;
}

export async function cleanupAgentRuntimeTestData(): Promise<void> {
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(runtimeJobs).where(sql`${runtimeJobs.organizationId} = ${id}`);
    await db.delete(toolInvocations).where(sql`${toolInvocations.organizationId} = ${id}`);
    await db.delete(agentTaskDependencies).where(sql`${agentTaskDependencies.organizationId} = ${id}`);
    await db.delete(agentDelegations).where(sql`${agentDelegations.organizationId} = ${id}`);
    await db.delete(agentApprovalRequests).where(sql`${agentApprovalRequests.organizationId} = ${id}`);
    await db.delete(agentArtifacts).where(sql`${agentArtifacts.organizationId} = ${id}`);
    await db.delete(agentPlanSteps).where(sql`${agentPlanSteps.organizationId} = ${id}`);
    await db.delete(agentPlans).where(sql`${agentPlans.organizationId} = ${id}`);
    await db.delete(agentCheckpoints).where(sql`${agentCheckpoints.organizationId} = ${id}`);
    await db.delete(agentExecutionEvents).where(sql`${agentExecutionEvents.organizationId} = ${id}`);
    await db.delete(agentExecutions).where(sql`${agentExecutions.organizationId} = ${id}`);
    await db.delete(knowledgeItems).where(sql`${knowledgeItems.organizationId} = ${id}`);
    await db.delete(brainPermissionGrants).where(sql`${brainPermissionGrants.organizationId} = ${id}`);
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(agentCredentials).where(sql`${agentCredentials.agentId} IN (SELECT id FROM agents WHERE organization_id = ${id})`);
    await db.delete(agentVersions).where(sql`${agentVersions.agentId} IN (SELECT id FROM agents WHERE organization_id = ${id})`);
    await db.delete(agents).where(sql`${agents.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
}

/**
 * `claimJobs`/`pollAndProcess` operate globally, by design (a real
 * worker has no reason to filter by tenant) — under the full test suite
 * running many files in parallel, each of which enqueues its own jobs,
 * a single `pollAndProcess` call can claim OTHER files' jobs instead of
 * (or as well as) the one a given test cares about. This polls the
 * TARGET job's own row directly, re-invoking `pollAndProcess` until it
 * reaches a terminal state, rather than asserting it was present in any
 * one poll batch.
 */
export async function pollUntilJobDone(jobId: string, options: { maxAttempts?: number; leaseOwner?: string } = {}) {
  const { pollAndProcess } = await import("@/lib/runtime/worker");
  const { getJob } = await import("@/lib/runtime/queue");
  const maxAttempts = options.maxAttempts ?? 30;
  const terminal = new Set(["completed", "failed", "cancelled", "dead_lettered"]);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const current = await getJob(db, jobId);
    if (terminal.has(current.status)) return current;
    if (current.status === "queued" || current.status === "retry_scheduled") {
      // `onlyJobId` claims exactly this job regardless of whatever else
      // is currently eligible in the global queue — the full suite runs
      // many files in parallel, each enqueueing their own jobs onto the
      // same table, so an untargeted claim could grab (or lose the race
      // for) unrelated work instead.
      await pollAndProcess(db, rawSql, { leaseOwner: options.leaseOwner ?? `poll-until-done:${jobId}:${attempt}`, onlyJobIds: [jobId] });
    } else {
      // Already leased/running — by us or, under full-suite concurrency,
      // by another file's own untargeted poll that happened to grab it
      // first. Either way it's being driven to a terminal state by a
      // real `processClaimedJob` call; wait rather than fight over it.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return getJob(db, jobId);
}
