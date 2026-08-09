import "server-only";
import { and, eq, isNull, or, lt, desc, isNotNull, inArray, type SQL } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { knowledgeItems, knowledgeItemVersions, knowledgeRelationships, knowledgeItemTrust, knowledgeItemSources, knowledgeItemEvidence } from "@/db/schema";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { requireAgentBrainReadAccess } from "@/lib/brain/authz";
import { composedItemSelection, scopeKey, getReadableBrainScopesForAgent, type KnowledgeItem, type KnowledgeItemStatus, type KnowledgeDomain } from "@/lib/brain/knowledge-items";
import type { KnowledgeRelationship, RelationshipType } from "@/lib/brain/relationships";
import type { TrustTier, SourceType } from "@/lib/brain/trust";
import type { EvidenceClass } from "@/lib/brain/evidence";
import type { AgentPrincipal } from "./authentication";
import type { AgentBrainEndpointClass } from "./rate-limits";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Agent Brain reads — Brain Module 16 (Agent Read API)
 * ============================================================================
 *
 * "Allow registered agents to read Brain knowledge through the SAME
 * tenant, workspace, domain, lifecycle, and permission boundaries that
 * apply to humans. Agents must never receive broader access merely
 * because they are agents." Every function below is scoped by the
 * authenticated `AgentPrincipal.organizationId` ONLY — never a
 * caller-supplied organization id (there is no such parameter anywhere in
 * this file) — and gated by `requireAgentBrainReadAccess`, which resolves
 * against the identical `brain_permission_grants` table and exact-scope-
 * match semantics the human read path uses (`src/lib/brain/authz.ts`).
 *
 * Deliberately simpler than the human read path in exactly one place:
 * there is no "expand visibility to every workspace I'm a member of" step
 * (`getMemberWorkspaceIds`), because Agent Registry agents have no
 * workspace-membership concept at all (org-scoped only). Omitting
 * `workspaceId` on a list call therefore means "organization-scoped items
 * only" for an agent, never "every workspace-scoped item across every
 * workspace" — a narrower, not broader, default than the human path's,
 * consistent with "agents must never receive broader access."
 *
 * A deterministic retrieval interface only — no ranking, no synthesis, no
 * generated reasoning. Every function here is a direct, bounded lookup.
 */

function toKnowledgeDomain(domain: string): KnowledgeDomain {
  return domain as KnowledgeDomain;
}

async function recordAgentBrainRead(
  db: Db,
  input: { organizationId: string; agentId: string; endpointClass: AgentBrainEndpointClass; targetId?: string | null; resultCount?: number }
): Promise<void> {
  await recordAuditEvent(db, {
    eventType: "agent_brain_read",
    actorAgentId: input.agentId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    targetId: input.targetId ?? null,
    metadata: { endpointClass: input.endpointClass, ...(input.resultCount !== undefined ? { resultCount: input.resultCount } : {}) },
  });
}

export interface ListKnowledgeItemsForAgentInput {
  workspaceId?: string | null;
  domain?: KnowledgeDomain;
  classification?: string;
  status?: KnowledgeItemStatus;
  cursor?: string | null;
  limit?: number;
}

export interface ListKnowledgeItemsForAgentResult {
  items: KnowledgeItem[];
  nextCursor: string | null;
}

interface ItemCursor {
  createdAt: string;
  id: string;
}

function encodeItemCursor(item: Pick<KnowledgeItem, "createdAt" | "id">): string {
  const payload: ItemCursor = { createdAt: item.createdAt.toISOString(), id: item.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeItemCursor(cursor: string): ItemCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed?.createdAt === "string" && typeof parsed?.id === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** GET /api/agent/brain/knowledge — see this file's own top-level note on the narrower (never broader) workspace-visibility default vs. the human path. */
export async function listKnowledgeItemsForAgent(db: Db, principal: AgentPrincipal, input: ListKnowledgeItemsForAgentInput): Promise<ListKnowledgeItemsForAgentResult> {
  const status = input.status ?? "draft";
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

  const conditions: SQL[] = [eq(knowledgeItems.organizationId, principal.organizationId), eq(knowledgeItems.status, status)];
  conditions.push(input.workspaceId ? eq(knowledgeItems.workspaceId, input.workspaceId) : isNull(knowledgeItems.workspaceId));
  if (input.domain) conditions.push(eq(knowledgeItems.domain, input.domain));
  if (input.classification) conditions.push(eq(knowledgeItemVersions.classification, input.classification));

  if (input.cursor) {
    const decoded = decodeItemCursor(input.cursor);
    if (decoded) {
      const cursorDate = new Date(decoded.createdAt);
      const cursorCondition = or(lt(knowledgeItems.createdAt, cursorDate), and(eq(knowledgeItems.createdAt, cursorDate), lt(knowledgeItems.id, decoded.id)));
      if (cursorCondition) conditions.push(cursorCondition);
    }
  }

  const rows = await db
    .select(composedItemSelection())
    .from(knowledgeItems)
    .innerJoin(knowledgeItemVersions, eq(knowledgeItems.currentVersionId, knowledgeItemVersions.id))
    .where(and(...conditions))
    .orderBy(desc(knowledgeItems.createdAt), desc(knowledgeItems.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit) as KnowledgeItem[];
  const nextCursor = hasMore ? encodeItemCursor(page[page.length - 1]) : null;

  const readableScopes = await getReadableBrainScopesForAgent(db, principal.organizationId, principal.agentId);
  const visible = page.filter((item) => readableScopes.has(scopeKey(item.domain, item.workspaceId)));

  await recordAgentBrainRead(db, { organizationId: principal.organizationId, agentId: principal.agentId, endpointClass: "list", resultCount: visible.length });

  return { items: visible, nextCursor };
}

/**
 * GET /api/agent/brain/knowledge/:knowledgeItemId — the agent equivalent
 * of `getKnowledgeItemForUser`. `TenantResourceNotFoundError` (404) for
 * every failure mode (nonexistent, cross-tenant, or missing `read` grant),
 * identical "cannot distinguish nonexistent from inaccessible" discipline.
 */
export async function getKnowledgeItemForAgent(db: Db, principal: AgentPrincipal, knowledgeItemId: string): Promise<KnowledgeItem> {
  const item = (await requireTenantScopedResource(async () => {
    const [row] = await db
      .select(composedItemSelection())
      .from(knowledgeItems)
      .innerJoin(knowledgeItemVersions, eq(knowledgeItems.currentVersionId, knowledgeItemVersions.id))
      .where(and(eq(knowledgeItems.id, knowledgeItemId), eq(knowledgeItems.organizationId, principal.organizationId)));
    return row;
  })) as KnowledgeItem;

  await requireAgentBrainReadAccess(db, { organizationId: principal.organizationId, workspaceId: item.workspaceId, domain: item.domain, classification: item.classification }, principal.agentId);

  await recordAgentBrainRead(db, { organizationId: principal.organizationId, agentId: principal.agentId, endpointClass: "get", targetId: item.id });

  return item;
}

interface VersionCursor {
  versionNumber: number;
}

function encodeVersionCursor(versionNumber: number): string {
  const payload: VersionCursor = { versionNumber };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeVersionCursor(cursor: string): VersionCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed?.versionNumber === "number") return parsed;
    return null;
  } catch {
    return null;
  }
}

export interface ListKnowledgeItemVersionsForAgentInput {
  cursor?: string | null;
  limit?: number;
}

export interface KnowledgeItemVersionSummaryForAgent {
  versionNumber: number;
  title: string;
  content: string;
  classification: string;
  changeReason: string | null;
  createdAt: Date;
  isCurrent: boolean;
}

export interface ListKnowledgeItemVersionsForAgentResult {
  versions: KnowledgeItemVersionSummaryForAgent[];
  nextCursor: string | null;
}

/** GET /api/agent/brain/knowledge/:knowledgeItemId/versions — never exposes `createdByUserId`/`createdByAgentId` (Module 17's attribution stays an internal/audit fact, not part of an agent reader's response shape). */
export async function listKnowledgeItemVersionsForAgent(
  db: Db,
  principal: AgentPrincipal,
  knowledgeItemId: string,
  input: ListKnowledgeItemVersionsForAgentInput
): Promise<ListKnowledgeItemVersionsForAgentResult> {
  const item = await getKnowledgeItemForAgent(db, principal, knowledgeItemId);

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const conditions = [eq(knowledgeItemVersions.knowledgeItemId, item.id)];

  if (input.cursor) {
    const decoded = decodeVersionCursor(input.cursor);
    if (decoded) conditions.push(lt(knowledgeItemVersions.versionNumber, decoded.versionNumber));
  }

  const rows = await db
    .select()
    .from(knowledgeItemVersions)
    .where(and(...conditions))
    .orderBy(desc(knowledgeItemVersions.versionNumber))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const nextCursor = hasMore ? encodeVersionCursor(page[page.length - 1].versionNumber) : null;

  await recordAgentBrainRead(db, { organizationId: principal.organizationId, agentId: principal.agentId, endpointClass: "versions", targetId: item.id, resultCount: page.length });

  return {
    versions: page.map((row) => ({
      versionNumber: row.versionNumber,
      title: row.title,
      content: row.content,
      classification: row.classification,
      changeReason: row.changeReason,
      createdAt: row.createdAt,
      isCurrent: row.versionNumber === item.currentVersionNumber,
    })),
    nextCursor,
  };
}

async function resolveVersionRow(db: Db, knowledgeItemId: string, versionNumber: number) {
  const [row] = await db
    .select()
    .from(knowledgeItemVersions)
    .where(and(eq(knowledgeItemVersions.knowledgeItemId, knowledgeItemId), eq(knowledgeItemVersions.versionNumber, versionNumber)));
  if (!row) throw new TenantResourceNotFoundError();
  return row;
}

export interface ListRelationshipsForAgentInput {
  direction?: "outgoing" | "incoming" | "both";
  relationshipType?: RelationshipType;
  status?: "active" | "archived";
  cursor?: string | null;
  limit?: number;
}

export interface ListRelationshipsForAgentResult {
  relationships: KnowledgeRelationship[];
  nextCursor: string | null;
}

/**
 * GET /api/agent/brain/knowledge/:knowledgeItemId/relationships — the
 * agent equivalent of `listRelationshipsForItem`, including
 * §7's "a relationship never grants visibility into the item on its
 * other end" rule. The human path's `filterByOtherEndpointVisibility`
 * checks WORKSPACE MEMBERSHIP for the other endpoint (a human-only
 * concept); the agent equivalent here checks the other endpoint's
 * (domain, workspace-or-org) scope against the agent's own readable-scopes
 * set instead — actually a STRICTER check than the human path's, since it
 * verifies the real `read` grant rather than mere membership.
 */
export async function listRelationshipsForAgent(
  db: Db,
  principal: AgentPrincipal,
  knowledgeItemId: string,
  input: ListRelationshipsForAgentInput
): Promise<ListRelationshipsForAgentResult> {
  const anchor = await getKnowledgeItemForAgent(db, principal, knowledgeItemId);

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const status = input.status ?? "active";
  const direction = input.direction ?? "both";

  const conditions: SQL[] = [eq(knowledgeRelationships.organizationId, principal.organizationId)];
  const directionCondition =
    direction === "outgoing"
      ? eq(knowledgeRelationships.sourceItemId, anchor.id)
      : direction === "incoming"
        ? eq(knowledgeRelationships.targetItemId, anchor.id)
        : or(eq(knowledgeRelationships.sourceItemId, anchor.id), eq(knowledgeRelationships.targetItemId, anchor.id));
  if (directionCondition) conditions.push(directionCondition);
  if (input.relationshipType) conditions.push(eq(knowledgeRelationships.relationshipType, input.relationshipType));
  conditions.push(status === "archived" ? isNotNull(knowledgeRelationships.archivedAt) : isNull(knowledgeRelationships.archivedAt));

  if (input.cursor) {
    const decoded = decodeItemCursor(input.cursor);
    if (decoded) {
      const cursorDate = new Date(decoded.createdAt);
      const cursorCondition = or(
        lt(knowledgeRelationships.createdAt, cursorDate),
        and(eq(knowledgeRelationships.createdAt, cursorDate), lt(knowledgeRelationships.id, decoded.id))
      );
      if (cursorCondition) conditions.push(cursorCondition);
    }
  }

  const rows = await db
    .select()
    .from(knowledgeRelationships)
    .where(and(...conditions))
    .orderBy(desc(knowledgeRelationships.createdAt), desc(knowledgeRelationships.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit) as KnowledgeRelationship[];
  const nextCursor = hasMore ? encodeItemCursor(page[page.length - 1]) : null;

  const visible = await filterByOtherEndpointReadableToAgent(db, principal, anchor.id, page);

  await recordAgentBrainRead(db, { organizationId: principal.organizationId, agentId: principal.agentId, endpointClass: "relationships", targetId: anchor.id, resultCount: visible.length });

  return { relationships: visible, nextCursor };
}

async function filterByOtherEndpointReadableToAgent(
  db: Db,
  principal: AgentPrincipal,
  anchorItemId: string,
  rows: KnowledgeRelationship[]
): Promise<KnowledgeRelationship[]> {
  if (rows.length === 0) return rows;

  const otherIdOf = (row: KnowledgeRelationship) => (row.sourceItemId === anchorItemId ? row.targetItemId : row.sourceItemId);
  const distinctOtherIds = [...new Set(rows.map(otherIdOf))];

  const otherItemRows = await db
    .select({ id: knowledgeItems.id, domain: knowledgeItems.domain, workspaceId: knowledgeItems.workspaceId })
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.organizationId, principal.organizationId), inArray(knowledgeItems.id, distinctOtherIds)));
  const otherItemById = new Map(otherItemRows.map((r) => [r.id, r]));

  const readableScopes = await getReadableBrainScopesForAgent(db, principal.organizationId, principal.agentId);

  return rows.filter((row) => {
    const other = otherItemById.get(otherIdOf(row));
    if (!other) return false;
    return readableScopes.has(scopeKey(other.domain, other.workspaceId));
  });
}

export interface AgentKnowledgeContext {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  domain: KnowledgeDomain;
  classification: string;
  status: KnowledgeItemStatus;
  title: string;
  content: string;
  versionNumber: number;
  source: { sourceType: SourceType; sourceDetail: string | null; recordedAt: Date } | null;
  trust: { trustTier: TrustTier; assessedAt: Date | null };
  evidence: Array<{ evidenceClass: EvidenceClass; description: string; evidenceTrustTier: TrustTier }>;
  relationships: Array<{ relationshipType: RelationshipType; direction: "outgoing" | "incoming"; otherItemId: string }>;
  retrievedAt: Date;
}

/**
 * GET /api/agent/brain/knowledge/:knowledgeItemId/versions/:versionNumber/context
 * — item 10's "citation-ready read response": exactly the field list the
 * task specifies, assembled deterministically from this item's own
 * version/trust/source/evidence/relationship rows. No ranking, no
 * synthesis, no cross-item retrieval graph traversal (that's Brain Module
 * 11's `retrieveRelevantKnowledge`, a semantic/multi-hop concern
 * deliberately out of scope for this deterministic endpoint).
 */
export async function getKnowledgeContextForAgent(db: Db, principal: AgentPrincipal, knowledgeItemId: string, versionNumber: number): Promise<AgentKnowledgeContext> {
  const item = await getKnowledgeItemForAgent(db, principal, knowledgeItemId);
  const version = await resolveVersionRow(db, item.id, versionNumber);

  const [trustRow] = await db.select().from(knowledgeItemTrust).where(eq(knowledgeItemTrust.knowledgeItemVersionId, version.id));
  const [sourceRow] = await db.select().from(knowledgeItemSources).where(eq(knowledgeItemSources.knowledgeItemVersionId, version.id));
  const evidenceRows = await db.select().from(knowledgeItemEvidence).where(eq(knowledgeItemEvidence.knowledgeItemVersionId, version.id));

  const relationshipRows = await db
    .select()
    .from(knowledgeRelationships)
    .where(and(eq(knowledgeRelationships.organizationId, principal.organizationId), or(eq(knowledgeRelationships.sourceItemId, item.id), eq(knowledgeRelationships.targetItemId, item.id)), isNull(knowledgeRelationships.archivedAt)));
  const visibleRelationships = await filterByOtherEndpointReadableToAgent(db, principal, item.id, relationshipRows as KnowledgeRelationship[]);

  await recordAgentBrainRead(db, { organizationId: principal.organizationId, agentId: principal.agentId, endpointClass: "context", targetId: item.id });

  return {
    id: item.id,
    organizationId: item.organizationId,
    workspaceId: item.workspaceId,
    domain: toKnowledgeDomain(item.domain),
    classification: version.classification,
    status: item.status,
    title: version.title,
    content: version.content,
    versionNumber: version.versionNumber,
    source: sourceRow ? { sourceType: sourceRow.sourceType, sourceDetail: sourceRow.sourceDetail, recordedAt: sourceRow.createdAt } : null,
    trust: trustRow ? { trustTier: trustRow.trustTier, assessedAt: trustRow.updatedAt } : { trustTier: "unknown", assessedAt: null },
    evidence: evidenceRows.map((e) => ({ evidenceClass: e.evidenceClass, description: e.description, evidenceTrustTier: e.evidenceTrustTier })),
    relationships: visibleRelationships.map((r) => ({
      relationshipType: r.relationshipType,
      direction: r.sourceItemId === item.id ? "outgoing" : "incoming",
      otherItemId: r.sourceItemId === item.id ? r.targetItemId : r.sourceItemId,
    })),
    retrievedAt: new Date(),
  };
}
