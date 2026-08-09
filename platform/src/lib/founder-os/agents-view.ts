import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { and, eq, isNotNull, gte, count } from "drizzle-orm";
import { agentExecutions, agentArtifacts } from "@/db/schema";
import { listAgents, type Agent } from "@/lib/agents/agents";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { resolveFounderAuthContext, requireFounderViewAuthority, hasFounderCapability } from "./authz";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface AgentWorkforceRow {
  agent: Agent;
  executionsInPeriod: number;
  completed: number;
  failed: number;
  successRate: number | null;
  recentArtifactCount: number;
}

export interface ExecutiveAgentsView {
  agents: AgentWorkforceRow[];
}

/**
 * ============================================================================
 * AI Workforce view — Module 18
 * ============================================================================
 * `listAgents` is Agent Registry's own unmodified read (Module 3) — no
 * duplicated registry. Per-agent execution/artifact counts are computed
 * directly against `agent_executions`/`agent_artifacts` here because
 * Analytics OS's own agent metrics declare `agent` as a supported
 * dimension but do not yet implement a per-agent `groupBy` branch (a real,
 * disclosed gap in Module 17's own registry, flagged in this module's
 * final report — not silently worked around). No hidden reasoning, no
 * credential values are ever included.
 */
export async function computeExecutiveAgentsView(db: Db, input: { organizationId: string; actorUserId: string; periodDays?: number }): Promise<ExecutiveAgentsView> {
  const founderCtx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, founderCtx, "founder_agents_view", input.organizationId);
  if (!hasFounderCapability(founderCtx, "founder_workspace_view_agents")) return { agents: [] };
  await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  const agents = await listAgents(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  const since = new Date(Date.now() - (input.periodDays ?? 30) * 24 * 60 * 60 * 1000);

  const [executionCounts, artifactCounts] = await Promise.all([
    db
      .select({ agentId: agentExecutions.assignedAgentId, status: agentExecutions.status, value: count() })
      .from(agentExecutions)
      .where(and(eq(agentExecutions.organizationId, input.organizationId), isNotNull(agentExecutions.assignedAgentId), gte(agentExecutions.createdAt, since)))
      .groupBy(agentExecutions.assignedAgentId, agentExecutions.status),
    db
      .select({ agentId: agentArtifacts.createdByAgentId, value: count() })
      .from(agentArtifacts)
      .where(and(eq(agentArtifacts.organizationId, input.organizationId), isNotNull(agentArtifacts.createdByAgentId), gte(agentArtifacts.createdAt, since)))
      .groupBy(agentArtifacts.createdByAgentId),
  ]);

  const rows: AgentWorkforceRow[] = agents.map((agent) => {
    const perStatus = executionCounts.filter((r) => r.agentId === agent.id);
    const completed = perStatus.find((r) => r.status === "completed")?.value ?? 0;
    const failed = perStatus.find((r) => r.status === "failed")?.value ?? 0;
    const total = perStatus.reduce((sum, r) => sum + r.value, 0);
    const terminal = completed + failed;
    return {
      agent,
      executionsInPeriod: total,
      completed,
      failed,
      successRate: terminal === 0 ? null : Math.round((completed / terminal) * 1000) / 10,
      recentArtifactCount: artifactCounts.find((r) => r.agentId === agent.id)?.value ?? 0,
    };
  });

  rows.sort((a, b) => b.executionsInPeriod - a.executionsInPeriod);
  return { agents: rows };
}
