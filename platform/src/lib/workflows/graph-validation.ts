import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workflowNodes, workflowEdges } from "@/db/schema";
import { resolveAgentById } from "@/lib/agents/agents";
import "@/lib/agents/knowledge-analyst";
import "@/lib/sales-os/agents";
import { resolveAgentTaskHandler } from "@/lib/agent-runtime/task-handlers";
import { getCurrentToolVersion } from "@/lib/tools/definitions";
import { nodeConfigSchemaFor, type WorkflowNodeType } from "./validation";
import type { MappingSource } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface ValidationIssue {
  nodeId?: string;
  nodeKey?: string;
  edgeId?: string;
  message: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const SECRET_LIKE_PATTERNS = [/sk-[a-zA-Z0-9]{16,}/, /-----BEGIN[ A-Z]*PRIVATE KEY-----/, /"(password|secret|api[_-]?key|token)"\s*:\s*"[^"]{4,}"/i];

function scanForSecrets(configuration: unknown): boolean {
  const text = JSON.stringify(configuration ?? {});
  return SECRET_LIKE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * ============================================================================
 * Deterministic workflow graph validation — Module 11
 * ============================================================================
 * A single, ordered pass over one version's nodes/edges. Every check
 * produces a structured issue referencing the exact node/edge it concerns
 * — never a bare "invalid" with no location. Publication is refused unless
 * this returns `valid: true` with zero issues.
 */
export async function validateWorkflowGraph(db: Db, input: { organizationId: string; versionId: string }): Promise<WorkflowValidationResult> {
  const issues: ValidationIssue[] = [];

  const nodes = await db.select().from(workflowNodes).where(and(eq(workflowNodes.workflowVersionId, input.versionId), eq(workflowNodes.organizationId, input.organizationId)));
  const edges = await db.select().from(workflowEdges).where(and(eq(workflowEdges.workflowVersionId, input.versionId), eq(workflowEdges.organizationId, input.organizationId)));

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const nodeByKey = new Map(nodes.map((n) => [n.nodeKey, n]));

  if (nodes.length === 0) {
    return { valid: false, issues: [{ message: "the version has no nodes" }] };
  }

  // Node keys unique (defense in depth — already DB-enforced).
  if (nodeByKey.size !== nodes.length) {
    issues.push({ message: "duplicate node keys exist in this version" });
  }

  // Exactly one start node, at least one end node.
  const startNodes = nodes.filter((n) => n.nodeType === "start");
  const endNodes = nodes.filter((n) => n.nodeType === "end");
  if (startNodes.length === 0) issues.push({ message: "the workflow must have exactly one start node (has none)" });
  if (startNodes.length > 1) for (const n of startNodes) issues.push({ nodeId: n.id, nodeKey: n.nodeKey, message: "the workflow must have exactly one start node (has more than one)" });
  if (endNodes.length === 0) issues.push({ message: "the workflow must have at least one end node" });

  // Adjacency.
  const outgoing = new Map<string, typeof edges>();
  const incoming = new Map<string, typeof edges>();
  for (const edge of edges) {
    if (!outgoing.has(edge.sourceNodeId)) outgoing.set(edge.sourceNodeId, []);
    outgoing.get(edge.sourceNodeId)!.push(edge);
    if (!incoming.has(edge.targetNodeId)) incoming.set(edge.targetNodeId, []);
    incoming.get(edge.targetNodeId)!.push(edge);
  }

  // Reachability from start (only meaningful with exactly one start node).
  const reachableFromStart = new Set<string>();
  if (startNodes.length === 1) {
    const queue = [startNodes[0].id];
    reachableFromStart.add(startNodes[0].id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of outgoing.get(current) ?? []) {
        if (!reachableFromStart.has(edge.targetNodeId)) {
          reachableFromStart.add(edge.targetNodeId);
          queue.push(edge.targetNodeId);
        }
      }
    }
    for (const node of nodes) {
      if (!reachableFromStart.has(node.id)) issues.push({ nodeId: node.id, nodeKey: node.nodeKey, message: "node is unreachable from the start node" });
    }
  }

  // Cycle detection — DFS with a recursion stack. A DAG is required this phase; a bounded per-node retry is NOT a graph cycle (it never appears as a graph edge).
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(nodes.map((n) => [n.id, WHITE]));
  const cyclicNodes = new Set<string>();
  function dfs(nodeId: string, stack: string[]): void {
    color.set(nodeId, GRAY);
    stack.push(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      const targetColor = color.get(edge.targetNodeId);
      if (targetColor === GRAY) {
        for (const id of stack) cyclicNodes.add(id);
        cyclicNodes.add(edge.targetNodeId);
      } else if (targetColor === WHITE) {
        dfs(edge.targetNodeId, stack);
      }
    }
    stack.pop();
    color.set(nodeId, BLACK);
  }
  for (const node of nodes) {
    if (color.get(node.id) === WHITE) dfs(node.id, []);
  }
  for (const nodeId of cyclicNodes) {
    const node = nodeById.get(nodeId)!;
    issues.push({ nodeId: node.id, nodeKey: node.nodeKey, message: "node participates in an unsupported graph cycle — this phase requires a directed acyclic graph" });
  }

  // Terminal shape: only `end` nodes may have zero outgoing edges. Every
  // other node (including `wait`) must continue the graph — a wait pauses
  // a path, it never silently ends it.
  for (const node of nodes) {
    const out = outgoing.get(node.id) ?? [];
    if (node.nodeType === "end") {
      if (out.length > 0) issues.push({ nodeId: node.id, nodeKey: node.nodeKey, message: "an end node must have no outgoing edges" });
      continue;
    }
    if (out.length === 0) {
      issues.push({ nodeId: node.id, nodeKey: node.nodeKey, message: "node has no outgoing edge and is not an end node — this path never reaches an end" });
    }
    if (node.nodeType !== "condition" && out.length > 1) {
      issues.push({ nodeId: node.id, nodeKey: node.nodeKey, message: "only a condition node may have more than one outgoing edge (no parallel fan-out in this phase)" });
    }
  }

  // Condition branches: deterministic, complete, non-duplicated.
  for (const node of nodes.filter((n) => n.nodeType === "condition")) {
    const config = node.configuration as { branches?: Array<{ branchKey: string }>; defaultBranchKey?: string };
    const out = outgoing.get(node.id) ?? [];
    const seenKeys = new Set<string>();
    for (const edge of out) {
      if (!edge.conditionKey) {
        issues.push({ edgeId: edge.id, nodeId: node.id, nodeKey: node.nodeKey, message: "every outgoing edge from a condition node must have a conditionKey" });
        continue;
      }
      if (seenKeys.has(edge.conditionKey)) {
        issues.push({ edgeId: edge.id, nodeId: node.id, nodeKey: node.nodeKey, message: `duplicate outgoing edge for condition key "${edge.conditionKey}" — branches must be deterministic` });
      }
      seenKeys.add(edge.conditionKey);
      const isDeclaredBranch = (config.branches ?? []).some((b) => b.branchKey === edge.conditionKey);
      const isDefault = config.defaultBranchKey === edge.conditionKey;
      if (!isDeclaredBranch && !isDefault) {
        issues.push({ edgeId: edge.id, nodeId: node.id, nodeKey: node.nodeKey, message: `edge condition key "${edge.conditionKey}" does not match any configured branch` });
      }
    }
    for (const branch of config.branches ?? []) {
      if (!seenKeys.has(branch.branchKey)) {
        issues.push({ nodeId: node.id, nodeKey: node.nodeKey, message: `branch "${branch.branchKey}" has no matching outgoing edge — this branch leads nowhere` });
      }
    }
  }

  // Node configuration matches its type (defense in depth).
  for (const node of nodes) {
    const schema = nodeConfigSchemaFor(node.nodeType as WorkflowNodeType);
    const parsed = schema.safeParse(node.configuration);
    if (!parsed.success) {
      issues.push({ nodeId: node.id, nodeKey: node.nodeKey, message: `invalid configuration: ${parsed.error.issues.map((i) => i.message).join("; ")}` });
    }
    if (scanForSecrets(node.configuration)) {
      issues.push({ nodeId: node.id, nodeKey: node.nodeKey, message: "configuration appears to contain a secret or credential — remove it; nodes reference credentials only through existing, already-authorized systems" });
    }
  }

  // Referenced agents exist and are eligible. `agent_execution` is bounded
  // to whichever agent task type it declares (Module 14's typed registry) —
  // never a free-text driver, and a legacy (pre-Module-14) node with no
  // `agentTaskType` resolves to `company_knowledge_report`, exactly like
  // the engine's own execution-time resolution (see `engine.ts`).
  for (const node of nodes.filter((n) => ["agent_execution", "tool_invocation", "approval", "artifact_transform"].includes(n.nodeType))) {
    const config = node.configuration as { agentId?: string; toolKey?: string; agentTaskType?: string };
    if (config.agentId) {
      const agent = await resolveAgentById(db, config.agentId);
      if (!agent || agent.organizationId !== input.organizationId || agent.lifecycleStage === "retired") {
        issues.push({ nodeId: node.id, nodeKey: node.nodeKey, message: "referenced agent does not exist in this organization, or is retired" });
      } else if (node.nodeType === "agent_execution") {
        const agentTaskType = typeof config.agentTaskType === "string" ? config.agentTaskType : "company_knowledge_report";
        const handler = resolveAgentTaskHandler(agentTaskType);
        if (!handler || !handler.isAgentEligible(agent)) {
          issues.push({ nodeId: node.id, nodeKey: node.nodeKey, message: `referenced agent is not eligible for agent task type "${agentTaskType}"` });
        }
      }
    }
    if (node.nodeType === "tool_invocation" && config.toolKey) {
      const tool = await getCurrentToolVersion(db, config.toolKey);
      if (!tool || !tool.enabled) {
        issues.push({ nodeId: node.id, nodeKey: node.nodeKey, message: `referenced tool "${config.toolKey}" does not exist or is disabled` });
      }
    }
  }

  // Input mappings reference only prior (ancestor) node outputs — never a
  // forward or self reference, never an unknown node.
  for (const node of nodes) {
    const mapping = node.inputMapping as Record<string, MappingSource>;
    for (const [field, source] of Object.entries(mapping ?? {})) {
      if (source.source !== "node_output") continue;
      const referenced = nodeByKey.get(source.nodeKey);
      if (!referenced) {
        issues.push({ nodeId: node.id, nodeKey: node.nodeKey, message: `input mapping "${field}" references unknown node "${source.nodeKey}"` });
        continue;
      }
      if (!isAncestor(referenced.id, node.id, incoming)) {
        issues.push({ nodeId: node.id, nodeKey: node.nodeKey, message: `input mapping "${field}" references node "${source.nodeKey}", which is not a predecessor of this node` });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/** Bounded backward BFS — is `candidateAncestorId` reachable by following edges backward from `nodeId`? */
function isAncestor(candidateAncestorId: string, nodeId: string, incoming: Map<string, { sourceNodeId: string }[]>): boolean {
  const visited = new Set<string>([nodeId]);
  const queue = [nodeId];
  let examined = 0;
  while (queue.length > 0 && examined < 2000) {
    const current = queue.shift()!;
    examined += 1;
    for (const edge of incoming.get(current) ?? []) {
      if (edge.sourceNodeId === candidateAncestorId) return true;
      if (!visited.has(edge.sourceNodeId)) {
        visited.add(edge.sourceNodeId);
        queue.push(edge.sourceNodeId);
      }
    }
  }
  return false;
}
