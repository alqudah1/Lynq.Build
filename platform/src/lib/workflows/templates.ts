import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workflowDefinitions, workflowVersions, workflowNodes, workflowEdges } from "@/db/schema";
import { resolveKnowledgeAnalystAgent } from "@/lib/agents/knowledge-analyst";
import { recordAuditEvent } from "@/lib/audit";
import { validateWorkflowGraph } from "./graph-validation";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Starter templates — Module 11
 * ============================================================================
 * Templates are normal `workflow_definitions` rows (`isTemplate: true`) —
 * never a second execution architecture. Because a template's
 * `agent_execution`/`approval` nodes must reference a REAL, already-seeded
 * agent (never a workflow-specific one), each template is seeded directly
 * INTO the calling organization — the organization's own Company Knowledge
 * Analyst (Module 8) must already exist. Idempotent by `workflowKey`,
 * matching `seedKnowledgeAnalystAgent`'s own idempotent-seed precedent:
 * calling this twice for the same org never creates a duplicate.
 *
 * Structure only — no fake business results, no synthetic report content.
 * Every node here does exactly what its own executor (`engine.ts`) already
 * does for a hand-authored workflow; nothing about template seeding is a
 * special case at execution time.
 */

async function findExistingTemplate(db: Db, organizationId: string, workflowKey: string) {
  const [row] = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.organizationId, organizationId), eq(workflowDefinitions.workflowKey, workflowKey)));
  return row ?? null;
}

/** Exported so other modules (e.g. Sales OS, Module 13) can seed their own idempotent-by-`workflowKey` templates through this exact same insert sequence, instead of re-implementing it. */
export async function seedTemplate(
  db: Db,
  input: {
    organizationId: string;
    actorUserId: string;
    workflowKey: string;
    name: string;
    description: string;
    nodes: Array<{ nodeKey: string; nodeType: (typeof workflowNodes.$inferInsert)["nodeType"]; name: string; configuration: Record<string, unknown>; inputMapping?: Record<string, unknown>; positionX: number; positionY: number }>;
    edges: Array<{ sourceNodeKey: string; targetNodeKey: string; conditionKey?: string }>;
  }
): Promise<{ definitionId: string; versionId: string; alreadyExisted: boolean }> {
  const existing = await findExistingTemplate(db, input.organizationId, input.workflowKey);
  if (existing) {
    return { definitionId: existing.id, versionId: existing.currentPublishedVersionId ?? "", alreadyExisted: true };
  }

  const definitionId = randomUUID();
  await db.insert(workflowDefinitions).values({
    id: definitionId,
    organizationId: input.organizationId,
    name: input.name,
    workflowKey: input.workflowKey,
    description: input.description,
    isTemplate: true,
    createdByUserId: input.actorUserId,
  });

  const versionId = randomUUID();
  await db.insert(workflowVersions).values({
    id: versionId,
    organizationId: input.organizationId,
    workflowDefinitionId: definitionId,
    versionNumber: 1,
    name: input.name,
    description: input.description,
    createdByUserId: input.actorUserId,
    changeReason: "Initial template seed",
  });

  const nodeIdByKey = new Map<string, string>();
  for (const node of input.nodes) {
    const id = randomUUID();
    nodeIdByKey.set(node.nodeKey, id);
    await db.insert(workflowNodes).values({
      id,
      organizationId: input.organizationId,
      workflowVersionId: versionId,
      nodeKey: node.nodeKey,
      nodeType: node.nodeType,
      name: node.name,
      configuration: node.configuration,
      inputMapping: node.inputMapping ?? {},
      positionX: node.positionX,
      positionY: node.positionY,
    });
  }

  for (const edge of input.edges) {
    await db.insert(workflowEdges).values({
      id: randomUUID(),
      organizationId: input.organizationId,
      workflowVersionId: versionId,
      sourceNodeId: nodeIdByKey.get(edge.sourceNodeKey)!,
      targetNodeId: nodeIdByKey.get(edge.targetNodeKey)!,
      conditionKey: edge.conditionKey ?? null,
    });
  }

  const result = await validateWorkflowGraph(db, { organizationId: input.organizationId, versionId });
  if (result.valid) {
    await db.update(workflowVersions).set({ status: "valid", validationResult: result as object }).where(eq(workflowVersions.id, versionId));
    await db.update(workflowVersions).set({ status: "published", publishedAt: new Date() }).where(eq(workflowVersions.id, versionId));
    await db.update(workflowDefinitions).set({ currentPublishedVersionId: versionId, status: "published" }).where(eq(workflowDefinitions.id, definitionId));
  } else {
    await db.update(workflowVersions).set({ status: "draft", validationResult: result as object }).where(eq(workflowVersions.id, versionId));
  }

  await recordAuditEvent(db, { eventType: "workflow_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_definition", targetId: definitionId, metadata: { workflowKey: input.workflowKey, template: true, valid: result.valid } });

  return { definitionId, versionId, alreadyExisted: false };
}

export interface SeedStarterTemplatesResult {
  knowledgeReport: { definitionId: string; versionId: string; alreadyExisted: boolean };
  projectResearchTask: { definitionId: string; versionId: string; alreadyExisted: boolean };
}

/** Seeds both starter templates into one organization — requires the org's Company Knowledge Analyst to already be seeded (Module 8). */
export async function seedStarterTemplates(db: Db, input: { organizationId: string; actorUserId: string }): Promise<SeedStarterTemplatesResult> {
  const analyst = await resolveKnowledgeAnalystAgent(db, input.organizationId).catch(() => null);
  if (!analyst) throw new TenantResourceNotFoundError();

  const knowledgeReport = await seedTemplate(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    workflowKey: "KNOWLEDGE_REPORT_TEMPLATE",
    name: "Knowledge Report Workflow",
    description: "Start → Company Knowledge Analyst agent execution → Approval → End. A minimal, deterministic starter template.",
    nodes: [
      { nodeKey: "start", nodeType: "start", name: "Start", configuration: {}, positionX: 0, positionY: 0 },
      {
        nodeKey: "analyst_report",
        nodeType: "agent_execution",
        name: "Company Knowledge Analyst report",
        configuration: { agentId: analyst.id, agentTaskType: "company_knowledge_report" },
        inputMapping: { topic: { source: "workflow_input", path: "topic" }, allowedDomains: { source: "literal", value: ["identity"] } },
        positionX: 1,
        positionY: 0,
      },
      {
        nodeKey: "approve_report",
        nodeType: "approval",
        name: "Approve report",
        configuration: { agentId: analyst.id, requestedAction: "publish_knowledge_report", summary: "Review and approve the generated knowledge report", riskLevel: "low" },
        positionX: 2,
        positionY: 0,
      },
      { nodeKey: "end", nodeType: "end", name: "End", configuration: { requiredOutputs: [] }, positionX: 3, positionY: 0 },
    ],
    edges: [
      { sourceNodeKey: "start", targetNodeKey: "analyst_report" },
      { sourceNodeKey: "analyst_report", targetNodeKey: "approve_report" },
      { sourceNodeKey: "approve_report", targetNodeKey: "end" },
    ],
  });

  const projectResearchTask = await seedTemplate(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    workflowKey: "PROJECT_RESEARCH_TASK_TEMPLATE",
    name: "Project Research Task Workflow",
    description: "Start → Create project task → Knowledge Analyst execution → End (with the report artifact reference carried through). A minimal, deterministic starter template.",
    nodes: [
      { nodeKey: "start", nodeType: "start", name: "Start", configuration: {}, positionX: 0, positionY: 0 },
      {
        nodeKey: "create_task",
        nodeType: "project_task",
        name: "Create research task",
        configuration: { createNew: true, title: "Research task (from workflow)", description: "Created automatically by the Project Research Task workflow." },
        positionX: 1,
        positionY: 0,
      },
      {
        nodeKey: "analyst_research",
        nodeType: "agent_execution",
        name: "Company Knowledge Analyst research",
        configuration: { agentId: analyst.id, agentTaskType: "company_knowledge_report" },
        inputMapping: { topic: { source: "workflow_input", path: "topic" }, allowedDomains: { source: "literal", value: ["identity"] } },
        positionX: 2,
        positionY: 0,
      },
      { nodeKey: "end", nodeType: "end", name: "End", configuration: { requiredOutputs: [] }, positionX: 3, positionY: 0 },
    ],
    edges: [
      { sourceNodeKey: "start", targetNodeKey: "create_task" },
      { sourceNodeKey: "create_task", targetNodeKey: "analyst_research" },
      { sourceNodeKey: "analyst_research", targetNodeKey: "end" },
    ],
  });

  return { knowledgeReport, projectResearchTask };
}
