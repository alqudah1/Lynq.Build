import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentTaskDependencies, agentExecutions } from "@/db/schema";
import { resolveExecutionById } from "./executions";
import { DependencyCycleError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * §2's Dependency edge — `dependentExecutionId` cannot start/complete
 * until `dependsOnExecutionId` finishes. Acyclicity enforced here, in
 * application code, via a bounded graph walk before insert (a general
 * DAG-acyclicity property has no simple CHECK-constraint expression) —
 * the identical class of guard `delegation.ts`'s ancestry check uses for
 * the same underlying concern.
 */
export interface AgentTaskDependency {
  id: string;
  dependentExecutionId: string;
  dependsOnExecutionId: string;
  createdAt: Date;
}

function toDependency(row: typeof agentTaskDependencies.$inferSelect): AgentTaskDependency {
  return { id: row.id, dependentExecutionId: row.dependentExecutionId, dependsOnExecutionId: row.dependsOnExecutionId, createdAt: row.createdAt };
}

/** True if `targetId` is reachable from `startId` by following `dependsOn` edges — used to reject a new edge that would close a cycle back to itself. */
async function isReachable(db: Db, organizationId: string, startId: string, targetId: string): Promise<boolean> {
  const visited = new Set<string>();
  let frontier = [startId];

  while (frontier.length > 0) {
    const rows = await db
      .select({ dependsOnExecutionId: agentTaskDependencies.dependsOnExecutionId })
      .from(agentTaskDependencies)
      .where(and(eq(agentTaskDependencies.organizationId, organizationId), eq(agentTaskDependencies.dependentExecutionId, frontier[0])));

    frontier = frontier.slice(1);
    for (const row of rows) {
      if (row.dependsOnExecutionId === targetId) return true;
      if (!visited.has(row.dependsOnExecutionId)) {
        visited.add(row.dependsOnExecutionId);
        frontier.push(row.dependsOnExecutionId);
      }
    }
  }
  return false;
}

export interface AddDependencyInput {
  organizationId: string;
  dependentExecutionId: string;
  dependsOnExecutionId: string;
}

export async function addDependency(db: Db, input: AddDependencyInput): Promise<AgentTaskDependency> {
  await resolveExecutionById(db, input.organizationId, input.dependentExecutionId);
  await resolveExecutionById(db, input.organizationId, input.dependsOnExecutionId);

  if (input.dependentExecutionId === input.dependsOnExecutionId) {
    throw new DependencyCycleError();
  }

  // Would adding dependent -> dependsOn create a cycle? Only if dependsOn
  // can already reach dependent (i.e. dependent is already, transitively,
  // something dependsOn itself depends on).
  const wouldCycle = await isReachable(db, input.organizationId, input.dependsOnExecutionId, input.dependentExecutionId);
  if (wouldCycle) {
    throw new DependencyCycleError();
  }

  const [row] = await db
    .insert(agentTaskDependencies)
    .values({ id: randomUUID(), organizationId: input.organizationId, dependentExecutionId: input.dependentExecutionId, dependsOnExecutionId: input.dependsOnExecutionId })
    .returning();

  return toDependency(row);
}

/** Every unfinished dependency for `executionId` — a non-empty result means the execution cannot yet leave `waiting`/start real work (fan-in: it may have several). */
export async function getUnresolvedDependencies(db: Db, organizationId: string, executionId: string): Promise<AgentTaskDependency[]> {
  const rows = await db
    .select({ dependency: agentTaskDependencies, status: agentExecutions.status })
    .from(agentTaskDependencies)
    .innerJoin(agentExecutions, eq(agentTaskDependencies.dependsOnExecutionId, agentExecutions.id))
    .where(and(eq(agentTaskDependencies.organizationId, organizationId), eq(agentTaskDependencies.dependentExecutionId, executionId)));

  return rows.filter((r) => r.status !== "completed" && r.status !== "archived").map((r) => toDependency(r.dependency));
}
