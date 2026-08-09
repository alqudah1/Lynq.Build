import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentArtifacts } from "@/db/schema";
import { resolveExecutionById } from "./executions";
import { requireAssignedAgent } from "./authz";
import { recordExecutionEvent } from "./events";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * §13's task-execution-scoped output — structurally never a Knowledge
 * Item (see this file's own top-level architecture note in
 * `MODULE_7_AGENT_RUNTIME_CORE.md`). Never large binary content: `content`
 * is bounded text, `externalRef` is a pointer to wherever this codebase
 * already stores blobs — the file itself never lives in this table.
 */
export type AgentArtifactType = "draft_text" | "report" | "proposal" | "structured_data" | "code_patch_reference" | "file_reference" | "action_proposal";
export type AgentArtifactStatus = "draft" | "review" | "approved" | "published" | "archived";

export interface AgentArtifact {
  id: string;
  executionId: string;
  artifactType: AgentArtifactType;
  title: string;
  content: string | null;
  externalRef: string | null;
  status: AgentArtifactStatus;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  createdByType: "human" | "agent";
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

function toArtifact(row: typeof agentArtifacts.$inferSelect): AgentArtifact {
  return {
    id: row.id,
    executionId: row.executionId,
    artifactType: row.artifactType,
    title: row.title,
    content: row.content,
    externalRef: row.externalRef,
    status: row.status,
    createdByUserId: row.createdByUserId,
    createdByAgentId: row.createdByAgentId,
    createdByType: row.createdByType,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const MAX_CONTENT_LENGTH = 20000;

export interface CreateArtifactInput {
  organizationId: string;
  executionId: string;
  artifactType: AgentArtifactType;
  title: string;
  content?: string | null;
  externalRef?: string | null;
  actorAgentId: string;
}

export async function createArtifact(db: Db, input: CreateArtifactInput): Promise<AgentArtifact> {
  const execution = await resolveExecutionById(db, input.organizationId, input.executionId);
  requireAssignedAgent(execution, input.actorAgentId);

  if (input.content && input.content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Artifact content exceeds the maximum of ${MAX_CONTENT_LENGTH} characters — use externalRef for large content instead`);
  }
  if (input.artifactType === "file_reference" && !input.externalRef) {
    throw new Error("A file_reference artifact requires externalRef — this table never stores binary content directly");
  }

  const [row] = await db
    .insert(agentArtifacts)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      executionId: input.executionId,
      artifactType: input.artifactType,
      title: input.title,
      content: input.content ?? null,
      externalRef: input.externalRef ?? null,
      createdByAgentId: input.actorAgentId,
      createdByType: "agent",
    })
    .returning();

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: "agent_artifact_created",
    actorAgentId: input.actorAgentId,
    metadata: { artifactId: row.id, artifactType: input.artifactType },
  });

  return toArtifact(row);
}

const ARTIFACT_STATUS_EDGES: Record<AgentArtifactStatus, AgentArtifactStatus[]> = {
  draft: ["review"],
  review: ["approved", "draft"],
  approved: ["published"],
  published: ["archived"],
  archived: [],
};

export interface UpdateArtifactStatusInput {
  organizationId: string;
  executionId: string;
  artifactId: string;
  toStatus: AgentArtifactStatus;
  expectedRevision: number;
  actorAgentId?: string | null;
  actorUserId?: string | null;
}

/** §13's Draft→Review→Approval→Published→Archived progression (`approved`, matching this codebase's `agentArtifactStatusEnum`, plays the role §13's diagram calls "Approval"). Publishing an artifact and promoting it into the Brain remain two separate, never-automatic decisions — this function only ever changes THIS row's own status; it never creates a Knowledge Item. */
export async function updateArtifactStatus(db: Db, input: UpdateArtifactStatusInput): Promise<AgentArtifact> {
  const [existing] = await db.select().from(agentArtifacts).where(and(eq(agentArtifacts.id, input.artifactId), eq(agentArtifacts.organizationId, input.organizationId)));
  if (!existing) throw new Error("Artifact not found");

  const legalTargets = ARTIFACT_STATUS_EDGES[existing.status];
  if (!legalTargets.includes(input.toStatus)) {
    throw new Error(`Artifact cannot move from "${existing.status}" to "${input.toStatus}"`);
  }

  const [row] = await db
    .update(agentArtifacts)
    .set({ status: input.toStatus, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(agentArtifacts.id, input.artifactId), eq(agentArtifacts.revision, input.expectedRevision)))
    .returning();

  if (!row) {
    throw new Error("Artifact was changed by someone else — refresh and try again");
  }

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: "agent_artifact_status_changed",
    actorAgentId: input.actorAgentId ?? null,
    actorUserId: input.actorUserId ?? null,
    metadata: { artifactId: input.artifactId, fromStatus: existing.status, toStatus: input.toStatus },
  });

  return toArtifact(row);
}

export async function listArtifactsForExecution(db: Db, organizationId: string, executionId: string): Promise<AgentArtifact[]> {
  const rows = await db.select().from(agentArtifacts).where(and(eq(agentArtifacts.organizationId, organizationId), eq(agentArtifacts.executionId, executionId)));
  return rows.map(toArtifact);
}
