import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agents, marketingApprovalLinks, organizationMemberships, socialAdChangeRequests, socialContentVariants } from "@/db/schema";
import { registerAgent, resolveAgentById, type Agent } from "@/lib/agents/agents";
import { advanceAgentLifecycleStage, changeAgentPermissionLevel } from "@/lib/agents/lifecycle";
import { createExecution, resolveExecutionById, type AgentExecution } from "@/lib/agent-runtime/executions";
import { requestApproval, type AgentApprovalRequest } from "@/lib/agent-runtime/approvals";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { driveThroughToExecuting } from "@/lib/marketing-os/agents";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Module 19 — the Social Media Manager agent. One narrow, registered agent
 * (Agent Registry lifecycle, same forward-only stage sequence as the
 * Marketing OS agents) that owns the approval requests the Social Command
 * Center raises. It never decides an approval: every request it files is
 * decided by a human through `approveRequest` / `rejectRequest` /
 * `requestRevision` — from the Social approval queue or the Founder
 * Approval Center (both read the same `agent_approval_requests` row via
 * `marketing_approval_links`).
 */
export const SOCIAL_MANAGER_AGENT_NAME = "Social Media Manager";

async function findSocialManager(db: Db, organizationId: string): Promise<Agent | null> {
  const [row] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, organizationId), eq(agents.name, SOCIAL_MANAGER_AGENT_NAME)));
  if (!row) return null;
  return (await resolveAgentById(db, row.id)) ?? null;
}

/** Idempotent: returns the existing agent when one is already registered under the canonical name. `actorUserId` must hold Agent Registry management authority (org owner/admin). */
export async function seedSocialAgents(db: Db, input: { organizationId: string; actorUserId: string }): Promise<{ socialManagerAgent: Agent }> {
  const existing = await findSocialManager(db, input.organizationId);
  if (existing) return { socialManagerAgent: existing };

  const agent = await registerAgent(db, {
    organizationId: input.organizationId,
    name: SOCIAL_MANAGER_AGENT_NAME,
    department: "marketing_and_brand",
    purpose: "Run a brand's social presence through the Social Command Center: prepare per-platform posts, route each one to a human for approval, and publish only what a human approved.",
    responsibilities: "File an approval request for every post submitted for review and every advertising change proposed; never decide those approvals; publish or execute only after a recorded human approval.",
    goals: "Nothing reaches a public social account or moves ad spend without an explicit, recorded human decision.",
    inputs: "Social content variants and advertising change requests in this organization.",
    outputs: "Agent approval requests linked to the variant or change request through marketing_approval_links.",
    successCriteria: "Each approval request is decided by a human and the linked record follows that decision.",
    failureCriteria: "A linked record cannot be resolved, or the requesting human lacks the Marketing OS capability for it.",
    retirementCriteria: "Superseded by a broader marketing operations agent, or the Social Command Center is retired.",
    humanOwnerUserId: input.actorUserId,
    permissionLevel: "assistant",
    actorUserId: input.actorUserId,
  }).catch(async (err) => {
    // A concurrent seed won the race — reuse its agent.
    if (isPostgresUniqueViolation(err)) {
      const raced = await findSocialManager(db, input.organizationId);
      if (raced) return raced;
    }
    throw err;
  });
  if (agent.lifecycleStage === "deployment") return { socialManagerAgent: agent };

  for (const toStage of ["specification", "development", "testing", "approval", "deployment"] as const) {
    await advanceAgentLifecycleStage(db, { organizationId: input.organizationId, agentId: agent.id, toStage, actorUserId: input.actorUserId });
  }
  await changeAgentPermissionLevel(db, { organizationId: input.organizationId, agentId: agent.id, newPermissionLevel: "assistant", reason: "Social Command Center (Module 19) — 'assistant' is the minimum level needed to file approval requests.", actorUserId: input.actorUserId });
  return { socialManagerAgent: (await resolveAgentById(db, agent.id))! };
}

/**
 * Resolves the org's Social Media Manager, seeding it lazily (as the
 * organization's earliest owner, who always holds registry authority) when
 * it does not exist yet — so the first "Submit for review" in a new
 * organization works without a separate setup step.
 */
export async function resolveSocialManagerAgent(db: Db, organizationId: string): Promise<Agent> {
  const existing = await findSocialManager(db, organizationId);
  if (existing) return existing;
  const [owner] = await db
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.role, "owner")))
    .orderBy(asc(organizationMemberships.createdAt))
    .limit(1);
  if (!owner) throw new Error("Cannot seed the Social Media Manager: the organization has no owner");
  const { socialManagerAgent } = await seedSocialAgents(db, { organizationId, actorUserId: owner.userId });
  return socialManagerAgent;
}

async function openApprovalExecution(db: Db, input: { organizationId: string; actorUserId: string; goal: string; planStep: string }): Promise<{ agent: Agent; execution: AgentExecution }> {
  const agent = await resolveSocialManagerAgent(db, input.organizationId);
  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    ownerUserId: input.actorUserId,
    goal: input.goal,
    successCriteria: "A human approval decision is recorded",
    failureCriteria: "The linked record cannot be resolved",
    domainsRequested: [],
    actorUserId: input.actorUserId,
  });
  await driveThroughToExecuting(db, input.organizationId, execution.id, agent.id, input.actorUserId, [input.planStep]);
  return { agent, execution };
}

/**
 * Files the approval request for publishing one content variant. Callers
 * (content.ts `submitVariantForReview`) have already checked the actor's
 * Marketing OS authority and moved the variant to `ready_for_review`.
 * The execution is owned by the submitter; the request is decided by a
 * human via the Social approval queue or the Founder Approval Center.
 */
export async function requestVariantApproval(db: Db, input: { organizationId: string; contentVariantId: string; summary: string; actorUserId: string }): Promise<{ execution: AgentExecution; approval: AgentApprovalRequest }> {
  const variant = await requireTenantScopedResource(async () => {
    const [row] = await db.select({ id: socialContentVariants.id, platform: socialContentVariants.platform }).from(socialContentVariants).where(and(eq(socialContentVariants.id, input.contentVariantId), eq(socialContentVariants.organizationId, input.organizationId)));
    return row;
  });

  const { agent, execution } = await openApprovalExecution(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, goal: `Request approval to publish social post ${variant.id} (${variant.platform})`, planStep: "Request human approval to publish this social post" });
  const { request } = await requestApproval(db, { organizationId: input.organizationId, executionId: execution.id, requestedAction: "publish_social_post", summary: input.summary.slice(0, 2000), riskLevel: "medium", proposedActionRef: { type: "content_variant", id: variant.id, platform: variant.platform }, actorAgentId: agent.id });

  await db.insert(marketingApprovalLinks).values({ organizationId: input.organizationId, approvalRequestId: request.id, linkedEntityType: "content_variant", linkedEntityId: variant.id, purpose: "publish_social_post", createdByUserId: input.actorUserId });
  await db.update(socialContentVariants).set({ approvalRequestId: request.id, updatedAt: new Date() }).where(and(eq(socialContentVariants.id, variant.id), eq(socialContentVariants.organizationId, input.organizationId)));
  await recordAuditEvent(db, { eventType: "marketing_approval_linked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_content_variant", targetId: variant.id, metadata: { approvalRequestId: request.id } });

  return { execution: await resolveExecutionById(db, input.organizationId, execution.id), approval: request };
}

/** Same as `requestVariantApproval` for an advertising change request (high risk: it moves money or delivery). */
export async function requestAdChangeApproval(db: Db, input: { organizationId: string; changeRequestId: string; summary: string; actorUserId: string }): Promise<{ execution: AgentExecution; approval: AgentApprovalRequest }> {
  const change = await requireTenantScopedResource(async () => {
    const [row] = await db
      .select({ id: socialAdChangeRequests.id, platform: socialAdChangeRequests.platform, changeType: socialAdChangeRequests.changeType })
      .from(socialAdChangeRequests)
      .where(and(eq(socialAdChangeRequests.id, input.changeRequestId), eq(socialAdChangeRequests.organizationId, input.organizationId)));
    return row;
  });

  const { agent, execution } = await openApprovalExecution(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, goal: `Request approval to execute advertising change ${change.id} (${change.platform} ${change.changeType})`, planStep: "Request human approval to execute this advertising change" });
  const { request } = await requestApproval(db, { organizationId: input.organizationId, executionId: execution.id, requestedAction: "execute_ad_change", summary: input.summary.slice(0, 2000), riskLevel: "high", proposedActionRef: { type: "ad_change_request", id: change.id, platform: change.platform, changeType: change.changeType }, actorAgentId: agent.id });

  await db.insert(marketingApprovalLinks).values({ organizationId: input.organizationId, approvalRequestId: request.id, linkedEntityType: "ad_change_request", linkedEntityId: change.id, purpose: "execute_ad_change", createdByUserId: input.actorUserId });
  await db.update(socialAdChangeRequests).set({ approvalRequestId: request.id, updatedAt: new Date() }).where(and(eq(socialAdChangeRequests.id, change.id), eq(socialAdChangeRequests.organizationId, input.organizationId)));
  await recordAuditEvent(db, { eventType: "marketing_approval_linked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_ad_change_request", targetId: change.id, metadata: { approvalRequestId: request.id } });

  return { execution: await resolveExecutionById(db, input.organizationId, execution.id), approval: request };
}
