import "server-only";
import { sql as drizzleSql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { getMemberWorkspaceIds, getReadableBrainScopes, getReadableBrainScopesForAgent, scopeKey, type KnowledgeDomain, type KnowledgeItem, type KnowledgeItemStatus } from "./knowledge-items";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Brain search — Module 10 (Search Interface, keyword only)
 * ============================================================================
 *
 * Deliberately NOT semantic or hybrid search — `MODULE_3_BRAIN_GRAPH_AND_REASONING.md`
 * §13 names plain keyword search as always available without an embedding
 * pipeline; that pipeline (chunks, embeddings, vector search) stays fully
 * out of scope here and everywhere else in this codebase so far. Postgres
 * full-text search (`to_tsvector`/`plainto_tsquery`/`ts_rank`) over each
 * item's CURRENT version only — historical versions are indexed (the GIN
 * index in `schema.ts` covers the whole table) but never queried through,
 * since this function only ever joins via `knowledgeItems.currentVersionId`.
 *
 * **Every result is filtered by the identical permission chain direct item
 * access uses** — `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §8's explicit
 * rule: search is not a side-door around Domain Grants. Reuses
 * `getMemberWorkspaceIds`/`getReadableBrainScopes` from `knowledge-items.ts`
 * rather than re-deriving either rule — the identical batched-lookup
 * pattern `listKnowledgeItemsForUser` already established, extended here to
 * a full-text-ranked candidate set instead of a plain listing.
 *
 * Archived/retired/purged items are excluded unconditionally — §4's own
 * words for Retired ("excluded from normal retrieval... by default") and
 * the existing "archived items don't appear in the default listing"
 * precedent (`listKnowledgeItemsForUser`) both point the same direction;
 * there is no override parameter yet to include them (a future module can
 * add one additively if a real use case needs it).
 */

export interface SearchKnowledgeItemsInput {
  organizationId: string;
  query: string;
  domain?: KnowledgeDomain;
  /** `undefined` = no workspace filter (organization-wide, still workspace-membership-filtered); `null` = organization-scoped items only. */
  workspaceId?: string | null;
  actorUserId: string;
  cursor?: string | null;
  limit?: number;
}

export interface SearchResultItem {
  item: KnowledgeItem;
  rank: number;
}

export interface SearchKnowledgeItemsResult {
  results: SearchResultItem[];
  nextCursor: string | null;
}

interface SearchCursor {
  rank: number;
  id: string;
}

function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeSearchCursor(cursor: string): SearchCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed?.rank === "number" && typeof parsed?.id === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** §4's "excluded from normal retrieval by default" (Retired) plus the existing archived/purged precedent — reused by Module 11's `retrieval.ts` graph-traversal filter so both retrieval paths apply the identical liveness rule. */
export const LIVE_STATUSES: KnowledgeItemStatus[] = ["idea", "draft", "review", "approved", "published"];

interface RunSearchInput {
  organizationId: string;
  query: string;
  domain?: KnowledgeDomain;
  workspaceId?: string | null;
  cursor?: string | null;
  limit?: number;
}

/**
 * The shared query core behind both `searchKnowledgeItems` (human) and
 * `searchKnowledgeItemsForAgent` (Brain Module 8/16) — one full-text query,
 * parameterized only by which workspace ids to expand visibility into
 * (a human's own explicit memberships; always empty for an agent, which
 * has no workspace-membership concept — Module 16's own "narrower, never
 * broader by default" precedent) and a pre-resolved readable-scopes set
 * (each caller resolves this differently: `getReadableBrainScopes` vs.
 * `getReadableBrainScopesForAgent`, the identical grantee-polymorphic
 * split already established in `authz.ts`'s `resolveEffectiveBrainCapabilitiesForGrantee`).
 */
async function runSearch(db: Db, input: RunSearchInput, workspaceVisibilityIds: string[], readableScopes: Set<string>): Promise<SearchKnowledgeItemsResult> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const cursor = input.cursor ? decodeSearchCursor(input.cursor) : null;

  const result = await db.execute<{
    id: string;
    organization_id: string;
    workspace_id: string | null;
    domain: KnowledgeDomain;
    classification: string;
    title: string;
    content: string;
    status: KnowledgeItemStatus;
    author_user_id: string | null;
    author_agent_id: string | null;
    author_type: "human" | "agent" | null;
    version_number: number;
    created_at: string;
    updated_at: string;
    archived_at: string | null;
    approved_by_user_id: string | null;
    approved_at: string | null;
    published_by_user_id: string | null;
    published_at: string | null;
    retired_by_user_id: string | null;
    retired_at: string | null;
    retired_reason: string | null;
    outcome: KnowledgeItem["outcome"];
    rank: number;
  }>(drizzleSql`
    SELECT
      ki.id, ki.organization_id, ki.workspace_id, ki.domain, ki.status, ki.author_user_id,
      ki.author_agent_id, ki.author_type,
      ki.created_at, ki.updated_at, ki.archived_at,
      ki.approved_by_user_id, ki.approved_at, ki.published_by_user_id, ki.published_at,
      ki.retired_by_user_id, ki.retired_at, ki.retired_reason, ki.outcome,
      kiv.title, kiv.content, kiv.classification, kiv.version_number,
      ts_rank(to_tsvector('english', kiv.title || ' ' || kiv.content), plainto_tsquery('english', ${input.query})) AS rank
    FROM knowledge_items ki
    JOIN knowledge_item_versions kiv ON kiv.id = ki.current_version_id
    WHERE ki.organization_id = ${input.organizationId}
      AND ki.status IN ${LIVE_STATUSES}
      AND to_tsvector('english', kiv.title || ' ' || kiv.content) @@ plainto_tsquery('english', ${input.query})
      AND (ki.workspace_id IS NULL${
        workspaceVisibilityIds.length > 0 ? drizzleSql` OR ki.workspace_id IN ${workspaceVisibilityIds}` : drizzleSql``
      })
      ${input.domain ? drizzleSql`AND ki.domain = ${input.domain}` : drizzleSql``}
      ${input.workspaceId === null ? drizzleSql`AND ki.workspace_id IS NULL` : input.workspaceId ? drizzleSql`AND ki.workspace_id = ${input.workspaceId}` : drizzleSql``}
      ${
        cursor
          ? drizzleSql`AND (ts_rank(to_tsvector('english', kiv.title || ' ' || kiv.content), plainto_tsquery('english', ${input.query})) < ${cursor.rank}
              OR (ts_rank(to_tsvector('english', kiv.title || ' ' || kiv.content), plainto_tsquery('english', ${input.query})) = ${cursor.rank} AND ki.id > ${cursor.id}))`
          : drizzleSql``
      }
    ORDER BY rank DESC, ki.id ASC
    LIMIT ${limit + 1}
  `);

  const rows = result.rows;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  const visible = page.filter((row) => readableScopes.has(scopeKey(row.domain, row.workspace_id)));

  const nextCursor = hasMore && page.length > 0 ? encodeSearchCursor({ rank: Number(page[page.length - 1].rank), id: page[page.length - 1].id }) : null;

  return {
    results: visible.map((row) => ({
      rank: Number(row.rank),
      item: {
        id: row.id,
        organizationId: row.organization_id,
        workspaceId: row.workspace_id,
        domain: row.domain,
        classification: row.classification,
        title: row.title,
        content: row.content,
        status: row.status,
        authorUserId: row.author_user_id,
        authorAgentId: row.author_agent_id,
        authorType: row.author_type,
        currentVersionNumber: Number(row.version_number),
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        archivedAt: row.archived_at ? new Date(row.archived_at) : null,
        approvedByUserId: row.approved_by_user_id,
        approvedAt: row.approved_at ? new Date(row.approved_at) : null,
        publishedByUserId: row.published_by_user_id,
        publishedAt: row.published_at ? new Date(row.published_at) : null,
        retiredByUserId: row.retired_by_user_id,
        retiredAt: row.retired_at ? new Date(row.retired_at) : null,
        retiredReason: row.retired_reason,
        outcome: row.outcome,
      },
    })),
    nextCursor,
  };
}

/**
 * Runs a keyword search, bounded and cursor-paginated (rank DESC, id ASC
 * tiebreak — the identical "cursor never offset-based" principle every
 * other list function in this codebase follows, adapted to a rank-ordered
 * result set instead of a time-ordered one). A page may legitimately come
 * back shorter than `limit` after permission-filtering removes candidates —
 * the same accepted tradeoff `listKnowledgeItemsForUser`/
 * `listRelationshipsForItem` already made, for the identical reason
 * (looping to backfill a full page would require unbounded extra queries).
 */
export async function searchKnowledgeItems(db: Db, input: SearchKnowledgeItemsInput): Promise<SearchKnowledgeItemsResult> {
  await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  const memberWorkspaceIds = await getMemberWorkspaceIds(db, input.organizationId, input.actorUserId);
  const readableScopes = await getReadableBrainScopes(db, input.organizationId, input.actorUserId);

  return runSearch(db, input, memberWorkspaceIds, readableScopes);
}

export interface SearchKnowledgeItemsForAgentInput {
  organizationId: string;
  query: string;
  domain?: KnowledgeDomain;
  /** `undefined` = organization-scoped items only (agents have no workspace-membership concept to expand into — Brain Module 16's own "narrower, never broader by default" rule, applied here identically); `null` is likewise organization-scoped; a real id scopes to exactly that workspace, still gated by an exact-scope `read` grant. */
  workspaceId?: string | null;
  agentId: string;
  cursor?: string | null;
  limit?: number;
}

/**
 * Brain Module 8 (Tool Runtime Foundation) / Module 16 — the agent-grantee
 * equivalent of `searchKnowledgeItems`, backing the `brain.search` tool.
 * Shares the identical `runSearch` query core; the only real difference
 * from the human path is which grantee resolves "readable scopes" and
 * that there is no workspace-membership expansion to perform (agents
 * have none), matching every other agent-read function's own precedent
 * in `src/lib/agents/brain-reads.ts`.
 */
export async function searchKnowledgeItemsForAgent(db: Db, input: SearchKnowledgeItemsForAgentInput): Promise<SearchKnowledgeItemsResult> {
  const readableScopes = await getReadableBrainScopesForAgent(db, input.organizationId, input.agentId);
  const result = await runSearch(db, input, [], readableScopes);

  await recordAuditEvent(db, {
    eventType: "agent_brain_read",
    actorAgentId: input.agentId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    metadata: { endpointClass: "search", resultCount: result.results.length },
  });

  return result;
}
