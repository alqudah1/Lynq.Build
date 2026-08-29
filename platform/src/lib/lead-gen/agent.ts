import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agents, agentExecutions } from "@/db/schema";
import { registerAgent, resolveAgentById, type Agent } from "@/lib/agents/agents";
import { advanceAgentLifecycleStage, changeAgentPermissionLevel } from "@/lib/agents/lifecycle";
import { createExecution, resolveExecutionById, type AgentExecution } from "@/lib/agent-runtime/executions";
import { assignExecution, startExecution, advanceExecution } from "@/lib/agent-runtime/lifecycle";
import { createPlan } from "@/lib/agent-runtime/plans";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * The lead-gen agent identity and its tool session
 * ============================================================================
 * Tools in this codebase are only callable from inside a live agent
 * execution — that is what carries the accountable human, the assigned
 * agent, the live eligibility re-check and the audit trail. So an MCP
 * client does not get to call tools "as itself": it authenticates as a
 * registered agent, and every call runs inside a real execution owned by
 * that agent's accountable human.
 *
 * `permissionLevel: "operator"` is deliberate and is the ceiling: it is
 * what `leadgen.send_approved_batch` and the qualify/disqualify tools
 * require, and nothing in the lead-gen set is registered above it. It does
 * NOT grant the ability to approve anything — approval decisions are
 * human-only and enforced inside the Runtime, not by permission level.
 */
export const LEAD_GEN_AGENT_NAME = "Lead Generation Assistant";

export class LeadGenAgentNotSeededError extends Error {
  constructor() {
    super(`The "${LEAD_GEN_AGENT_NAME}" agent has not been seeded for this organization.`);
    this.name = "LeadGenAgentNotSeededError";
  }
}

export async function seedLeadGenAgent(db: Db, input: { organizationId: string; humanOwnerUserId: string; actorUserId: string }): Promise<Agent> {
  const [existingRow] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, input.organizationId), eq(agents.name, LEAD_GEN_AGENT_NAME)));
  if (existingRow) return (await resolveAgentById(db, existingRow.id))!;

  const agent = await registerAgent(db, {
    organizationId: input.organizationId,
    name: LEAD_GEN_AGENT_NAME,
    humanOwnerUserId: input.humanOwnerUserId,
    permissionLevel: "assistant",
    actorUserId: input.actorUserId,
    department: "sales_and_bizdev",
    purpose:
      "Research and qualify local businesses, build and review their demo, draft English outreach at the correct market price, and assemble outreach batches for a human to approve — never to send one.",
    responsibilities:
      "Read and enrich CRM leads, score them, generate and review demo content against the business's real data, compose outreach, group eligible leads into bulk batches, submit those batches to the existing human approval workflow, classify inbound replies, and draft follow-ups. Every action runs through the registered lead-gen tools under the accountable human's own CRM and Communications authority.",
    goals: "Only businesses with a reviewed, passing demo and a resolved market are ever put in front of a human for send approval.",
    inputs: "CRM lead ids, business research, inbound reply text.",
    outputs: "Enriched leads, scored leads, reviewed demos, drafted outreach, unapproved bulk batches, reply classifications and follow-up drafts.",
    successCriteria: "Batches reach a human approver containing only recipients that passed market, demo-quality, consent and suppression checks.",
    failureCriteria: "Any attempt to contact a business whose demo has not passed review, or to send without an approved batch.",
    retirementCriteria: "Superseded by a broader growth agent, or outbound prospecting is retired.",
  });

  for (const toStage of ["specification", "development", "testing", "approval", "deployment"] as const) {
    await advanceAgentLifecycleStage(db, { organizationId: input.organizationId, agentId: agent.id, toStage, actorUserId: input.actorUserId });
  }
  await changeAgentPermissionLevel(db, {
    organizationId: input.organizationId,
    agentId: agent.id,
    newPermissionLevel: "operator",
    reason: "Lead-gen — 'operator' is the floor the send-approved-batch and lead qualification tools require. It confers no approval authority.",
    actorUserId: input.actorUserId,
  });
  return (await resolveAgentById(db, agent.id))!;
}

export async function resolveLeadGenAgent(db: Db, organizationId: string): Promise<Agent> {
  const [row] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, organizationId), eq(agents.name, LEAD_GEN_AGENT_NAME)));
  if (!row) throw new LeadGenAgentNotSeededError();
  return (await resolveAgentById(db, row.id))!;
}

const TOOL_SESSION_GOAL = "Lead-gen tool session (MCP)";

/**
 * Resolves the agent's current open tool session, or opens a new one.
 *
 * Reusing one long-running `executing` execution per agent keeps the audit
 * trail coherent (every tool invocation in a working session hangs off one
 * execution) and avoids manufacturing a throwaway execution per call. The
 * lookup is deliberately narrow: same organization, same assigned agent,
 * same goal string, still `executing`.
 */
export async function resolveOrOpenToolSession(db: Db, input: { organizationId: string; agentId: string }): Promise<AgentExecution> {
  const [open] = await db
    .select({ id: agentExecutions.id })
    .from(agentExecutions)
    .where(
      and(
        eq(agentExecutions.organizationId, input.organizationId),
        eq(agentExecutions.assignedAgentId, input.agentId),
        eq(agentExecutions.goal, TOOL_SESSION_GOAL),
        inArray(agentExecutions.status, ["executing"])
      )
    )
    .orderBy(desc(agentExecutions.createdAt))
    .limit(1);

  if (open) return resolveExecutionById(db, input.organizationId, open.id);

  const agent = await resolveAgentById(db, input.agentId);
  if (!agent) throw new LeadGenAgentNotSeededError();

  // The execution is owned by the agent's own accountable human. Every
  // tool then acts under THAT person's CRM/Communications authority, so
  // revoking their access immediately revokes the agent's reach.
  const ownerUserId = agent.humanOwnerUserId;

  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    ownerUserId,
    goal: TOOL_SESSION_GOAL,
    successCriteria: "Lead-gen tools were invoked under the accountable human's authority, with every invocation recorded.",
    failureCriteria: "The assigned agent became ineligible, or a tool was called outside its permitted scope.",
    domainsRequested: [],
    actorUserId: ownerUserId,
  });

  await assignExecution(db, { organizationId: input.organizationId, executionId: execution.id, assignedAgentId: input.agentId, actorUserId: ownerUserId });
  await startExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorUserId: ownerUserId });
  await advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "planning", actorAgentId: input.agentId });
  await createPlan(db, {
    organizationId: input.organizationId,
    executionId: execution.id,
    steps: ["Research and qualify leads", "Generate and review demos", "Draft outreach and assemble a batch", "Submit the batch for human approval", "Process replies and follow-ups"],
    actorAgentId: input.agentId,
  });
  await advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "reasoning", actorAgentId: input.agentId });
  return advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "executing", actorAgentId: input.agentId });
}
