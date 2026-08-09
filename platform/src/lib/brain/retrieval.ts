import "server-only";
import { and, eq, isNull, or, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { knowledgeItems, knowledgeItemVersions, knowledgeRelationships } from "@/db/schema";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { getMemberWorkspaceIds, getReadableBrainScopes, scopeKey, composedItemSelection, type KnowledgeDomain, type KnowledgeItem } from "./knowledge-items";
import { searchKnowledgeItems, LIVE_STATUSES } from "./search";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Brain retrieval — Module 11 (Retrieval Layer)
 * ============================================================================
 *
 * `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §2's "relevant nodes" step:
 * unions Module 10's keyword-search hits with a bounded graph-traversal
 * expansion over Module 3's relationships, de-duplicated, still fully
 * permission-filtered. Internal function only — no public route of its own
 * (Modules 12/16 compose this into something citation/agent-facing).
 *
 * **Cycle detection is a hard requirement, not an optimization**
 * (`MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §9): a visited-node set stops
 * traversal from ever re-expanding the same item twice, and `maxDepth` is a
 * small, fixed, conservative bound (default 2) — §15.4's own open question
 * on tuning this is deliberately left for later, per the plan's "can be
 * deferred" note; the bound itself is not deferrable.
 *
 * **Traversal never grants visibility on its own** (§7's exact rule): every
 * node this function returns — whether found via keyword search or via
 * graph traversal — passes through the identical batched permission filter
 * (`getMemberWorkspaceIds`/`getReadableBrainScopes`, reused from
 * `knowledge-items.ts`, never re-derived). A relationship edge pointing at
 * an item the actor cannot read is simply never expanded into, exactly
 * like `relationships.ts`'s own `filterByOtherEndpointVisibility` already
 * enforces for direct relationship listing.
 */

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_SEED_LIMIT = 20;

export type RetrievalSource = "keyword" | "graph";

export interface RetrievedNode {
  item: KnowledgeItem;
  source: RetrievalSource;
  /** Only present for keyword-search hits; `null` for pure graph-traversal discoveries. */
  rank: number | null;
  /** 0 for a keyword seed hit; hop distance from the nearest seed for a graph-traversal discovery. */
  depth: number;
}

export interface RetrieveRelevantKnowledgeInput {
  organizationId: string;
  query: string;
  domain?: KnowledgeDomain;
  workspaceId?: string | null;
  actorUserId: string;
  /** Bounds the keyword-search seed set (Module 10) that traversal expands from. */
  seedLimit?: number;
  /** Small, fixed hop bound for graph-traversal expansion. */
  maxDepth?: number;
}

export interface RetrieveRelevantKnowledgeResult {
  nodes: RetrievedNode[];
}

/**
 * Composes keyword search (seed set) with bounded, cycle-safe graph
 * traversal (expansion), de-duplicated by item id — a node reachable both
 * ways keeps its keyword rank and its shallower (seed, depth 0) depth.
 */
export async function retrieveRelevantKnowledge(db: Db, input: RetrieveRelevantKnowledgeInput): Promise<RetrieveRelevantKnowledgeResult> {
  await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  const maxDepth = Math.min(Math.max(input.maxDepth ?? DEFAULT_MAX_DEPTH, 0), 5);
  const seedLimit = Math.min(Math.max(input.seedLimit ?? DEFAULT_SEED_LIMIT, 1), 100);

  const seeds = await searchKnowledgeItems(db, {
    organizationId: input.organizationId,
    query: input.query,
    domain: input.domain,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    limit: seedLimit,
  });

  const nodesById = new Map<string, RetrievedNode>();
  for (const { item, rank } of seeds.results) {
    nodesById.set(item.id, { item, source: "keyword", rank, depth: 0 });
  }

  // Cycle-safe, bounded, breadth-first graph-traversal expansion. `visited`
  // is seeded with every keyword hit so traversal never re-discovers (and
  // never re-expands from) a node already in the result set.
  const visited = new Set<string>(nodesById.keys());
  let frontier = [...visited];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const edges = await db
      .select({ sourceItemId: knowledgeRelationships.sourceItemId, targetItemId: knowledgeRelationships.targetItemId })
      .from(knowledgeRelationships)
      .where(
        and(
          eq(knowledgeRelationships.organizationId, input.organizationId),
          isNull(knowledgeRelationships.archivedAt),
          or(inArray(knowledgeRelationships.sourceItemId, frontier), inArray(knowledgeRelationships.targetItemId, frontier))
        )
      );

    const candidateIds = new Set<string>();
    for (const edge of edges) {
      const other = frontier.includes(edge.sourceItemId) ? edge.targetItemId : edge.sourceItemId;
      if (!visited.has(other)) candidateIds.add(other);
    }
    if (candidateIds.size === 0) break;

    const candidateRows = await db
      .select(composedItemSelection())
      .from(knowledgeItems)
      .innerJoin(knowledgeItemVersions, eq(knowledgeItems.currentVersionId, knowledgeItemVersions.id))
      .where(
        and(
          eq(knowledgeItems.organizationId, input.organizationId),
          inArray(knowledgeItems.id, [...candidateIds]),
          inArray(knowledgeItems.status, LIVE_STATUSES)
        )
      );

    for (const row of candidateRows) visited.add(row.id);

    // The identical permission chain direct item access uses — §7's "a
    // relationship never grants visibility into the item on its other
    // end" rule, extended here to multi-hop traversal.
    const memberWorkspaceIds = new Set(await getMemberWorkspaceIds(db, input.organizationId, input.actorUserId));
    const readableScopes = await getReadableBrainScopes(db, input.organizationId, input.actorUserId);

    const nextFrontier: string[] = [];
    for (const row of candidateRows) {
      const workspaceVisible = row.workspaceId === null || memberWorkspaceIds.has(row.workspaceId);
      const capabilityVisible = readableScopes.has(scopeKey(row.domain, row.workspaceId));
      if (workspaceVisible && capabilityVisible) {
        nodesById.set(row.id, { item: row as KnowledgeItem, source: "graph", rank: null, depth });
        nextFrontier.push(row.id);
      }
      // Invisible candidates are still marked `visited` (above) so traversal
      // never repeatedly re-discovers an item it isn't allowed to surface —
      // but they never become part of the next frontier, so nothing is ever
      // expanded FROM an item the actor couldn't already read directly.
    }

    frontier = nextFrontier;
  }

  return { nodes: [...nodesById.values()] };
}
