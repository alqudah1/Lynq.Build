import "server-only";
import { and, eq, or, isNull, isNotNull, lt, desc, inArray, type SQL } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { knowledgeRelationships, knowledgeItems } from "@/db/schema";
import { requireOrganizationMembership, requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { requireBrainReadAccess, requireBrainMutateAccess } from "./authz";
import { SelfRelationshipViolationError, DuplicateRelationshipError, RelationshipAlreadyArchivedError, KnowledgeItemArchivedViolationError } from "./errors";
import { getKnowledgeItemForUser, getMemberWorkspaceIds, type KnowledgeItem } from "./knowledge-items";
import { isPostgresUniqueViolation } from "./db-errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/** The fixed nine-type taxonomy (MODULE_3_BRAIN_ARCHITECTURE.md §7), matching the `relationship_type` Postgres enum exactly. */
export type RelationshipType =
  | "supports"
  | "contradicts"
  | "depends_on"
  | "supersedes"
  | "related_to"
  | "created_from"
  | "references"
  | "used_by"
  | "required_for";

export interface KnowledgeRelationship {
  id: string;
  organizationId: string;
  sourceItemId: string;
  targetItemId: string;
  relationshipType: RelationshipType;
  creatorUserId: string | null;
  explanation: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

/**
 * Verifies the actor can currently READ `item` — reuses the exact same
 * `requireBrainReadAccess` gate every other Brain mutation already calls,
 * given an already-resolved `KnowledgeItem` rather than re-fetching it.
 * Writes `knowledge_access_denied` (targeting the ITEM, not the
 * relationship) on failure, identically to how `getKnowledgeItemForUser`
 * itself already behaves for a workspace-membership failure — no new,
 * relationship-specific denial event is introduced for this check.
 */
async function requireReadableEndpoint(db: Db, item: KnowledgeItem, actorUserId: string): Promise<void> {
  await requireBrainReadAccess(
    db,
    { organizationId: item.organizationId, workspaceId: item.workspaceId, domain: item.domain, classification: item.classification },
    actorUserId
  );
}

/**
 * Verifies the actor holds UPDATE-level authority over `item` — entity 8's
 * exact rule ("removable by the same authority that could edit either
 * endpoint item, subject to the same permission chain on *both* ends").
 * Reuses `requireBrainMutateAccess` with `"update"`, never a
 * relationship-specific authority concept — archiving a relationship is
 * authorized purely by each endpoint's own edit authority, never by who
 * created the relationship row itself.
 */
async function requireEditableEndpoint(db: Db, item: KnowledgeItem, actorUserId: string): Promise<void> {
  await requireBrainMutateAccess(
    db,
    { organizationId: item.organizationId, workspaceId: item.workspaceId, domain: item.domain, classification: item.classification },
    item.authorUserId,
    actorUserId,
    "update"
  );
}

export interface CreateRelationshipInput {
  organizationId: string;
  sourceItemId: string;
  targetItemId: string;
  relationshipType: RelationshipType;
  explanation?: string | null;
  actorUserId: string;
}

/**
 * Creates a typed, directed edge between two stable knowledge items.
 * Enforces every Module 3 validation rule:
 *
 * - **Self-link** rejected before touching the database (`SelfRelationshipViolationError`) —
 *   also backed by the `knowledge_relationships_no_self_link` CHECK constraint as defense-in-depth.
 * - **Cross-organization / nonexistent endpoint** rejected via `getKnowledgeItemForUser`,
 *   which resolves each endpoint scoped to `organizationId` and throws `TenantResourceNotFoundError`
 *   for anything outside it — identical to every other cross-tenant check in this codebase.
 * - **Visibility** — MODULE_3_BRAIN_ARCHITECTURE.md §7's structural rule ("a relationship can only
 *   ever be created between two items the creating actor can currently see") is enforced by
 *   independently re-running `requireBrainReadAccess` on *both* endpoints, not just the source.
 *   An item in a workspace the actor doesn't belong to fails here even if the actor could see
 *   the other endpoint fine — there is no single "can create" check that covers both ends at once.
 * - **Archived endpoint** rejected (`KnowledgeItemArchivedViolationError`, reused rather than a new
 *   class) — creating an edge is a graph-content mutation touching the item, so an archived item
 *   cannot gain a new relationship, mirroring the existing "archived items cannot be updated" rule.
 * - **Duplicate active relationship** — the service attempts the insert directly (no separate
 *   pre-check SELECT, which would itself race) and translates a `23505` violation of
 *   `knowledge_relationships_active_edge_unique` into `DuplicateRelationshipError` — the database
 *   constraint is the true, final guard; this is not merely an application-level check.
 */
export async function createRelationship(db: Db, input: CreateRelationshipInput): Promise<KnowledgeRelationship> {
  if (input.sourceItemId === input.targetItemId) {
    throw new SelfRelationshipViolationError();
  }

  const source = await getKnowledgeItemForUser(db, input.organizationId, input.sourceItemId, input.actorUserId);
  const target = await getKnowledgeItemForUser(db, input.organizationId, input.targetItemId, input.actorUserId);

  // §7: visibility on BOTH ends, independently — getKnowledgeItemForUser above
  // already proved organization + (if workspace-scoped) workspace membership
  // for each; requireReadableEndpoint re-runs the identical Brain-specific
  // read gate every other mutation uses, so a future authz change to
  // requireBrainReadAccess automatically governs relationship creation too.
  await requireReadableEndpoint(db, source, input.actorUserId);
  await requireReadableEndpoint(db, target, input.actorUserId);

  if (source.status === "archived" || target.status === "archived") {
    throw new KnowledgeItemArchivedViolationError();
  }

  try {
    const [row] = await db
      .insert(knowledgeRelationships)
      .values({
        organizationId: input.organizationId,
        sourceItemId: input.sourceItemId,
        targetItemId: input.targetItemId,
        relationshipType: input.relationshipType,
        creatorUserId: input.actorUserId,
        explanation: input.explanation ?? null,
      })
      .returning();

    await recordAuditEvent(db, {
      eventType: "knowledge_relationship_created",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "knowledge_relationship",
      targetId: row.id,
      metadata: {
        sourceItemId: source.id,
        targetItemId: target.id,
        relationshipType: input.relationshipType,
        sourceWorkspaceScoped: Boolean(source.workspaceId),
        targetWorkspaceScoped: Boolean(target.workspaceId),
      },
    });

    return row as KnowledgeRelationship;
  } catch (err) {
    if (isPostgresUniqueViolation(err)) {
      throw new DuplicateRelationshipError();
    }
    throw err;
  }
}

/**
 * Determines, for a relationship row anchored at `anchorItemId`, whether the
 * *other* endpoint is independently visible to the actor — MODULE_3_BRAIN_ARCHITECTURE.md
 * §7's "a relationship never grants visibility into the item on its other end" rule,
 * batched across a whole page rather than one extra round-trip per row (an N+1 query
 * would otherwise be required to call `getKnowledgeItemForUser` per relationship).
 * A relationship whose other endpoint the actor cannot see is filtered out of the
 * result entirely — never returned in a redacted form, never a 403; simply absent,
 * identical in spirit to how a workspace-scoped item the actor can't see is absent
 * from `listKnowledgeItemsForUser`'s results.
 */
async function filterByOtherEndpointVisibility<T extends { sourceItemId: string; targetItemId: string }>(
  db: Db,
  organizationId: string,
  anchorItemId: string,
  actorUserId: string,
  rows: T[]
): Promise<T[]> {
  if (rows.length === 0) return rows;

  const otherIdOf = (row: T) => (row.sourceItemId === anchorItemId ? row.targetItemId : row.sourceItemId);
  const distinctOtherIds = [...new Set(rows.map(otherIdOf))];

  const otherItemRows = await db
    .select({ id: knowledgeItems.id, workspaceId: knowledgeItems.workspaceId })
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.organizationId, organizationId), inArray(knowledgeItems.id, distinctOtherIds)));
  const otherItemById = new Map(otherItemRows.map((r) => [r.id, r]));

  const memberWorkspaceIds = new Set(await getMemberWorkspaceIds(db, organizationId, actorUserId));

  return rows.filter((row) => {
    const other = otherItemById.get(otherIdOf(row));
    if (!other) return false; // defensive: the composite FK guarantees this never happens in practice
    return other.workspaceId === null || memberWorkspaceIds.has(other.workspaceId);
  });
}

export interface ListRelationshipsForItemInput {
  organizationId: string;
  knowledgeItemId: string;
  actorUserId: string;
  direction?: "outgoing" | "incoming" | "both";
  relationshipType?: RelationshipType;
  status?: "active" | "archived";
  cursor?: string | null;
  limit?: number;
}

export interface ListRelationshipsForItemResult {
  relationships: KnowledgeRelationship[];
  nextCursor: string | null;
}

interface RelationshipCursor {
  createdAt: string;
  id: string;
}

function encodeRelationshipCursor(row: Pick<KnowledgeRelationship, "createdAt" | "id">): string {
  const payload: RelationshipCursor = { createdAt: row.createdAt.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeRelationshipCursor(cursor: string): RelationshipCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed?.createdAt === "string" && typeof parsed?.id === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Lists the relationships anchored at one item — outgoing (item is source),
 * incoming (item is target), or both (default). Bounded, cursor-paginated.
 * No graph traversal: this returns exactly the direct edges touching
 * `knowledgeItemId`, never a multi-hop walk.
 *
 * Because a page is fetched from the database *before* the other-endpoint
 * visibility filter (`filterByOtherEndpointVisibility`) runs, a returned
 * page may legitimately contain fewer than `limit` rows even when more
 * candidates exist — the alternative (looping to backfill a full page)
 * would require unbounded extra queries whenever many edges point at
 * content the actor can't see, which is worse than an occasionally
 * shorter-than-requested page. `nextCursor` is still computed from the
 * last *fetched* (not last *visible*) row, so pagination continues
 * correctly past filtered rows.
 */
export async function listRelationshipsForItem(db: Db, input: ListRelationshipsForItemInput): Promise<ListRelationshipsForItemResult> {
  const anchor = await getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const status = input.status ?? "active";
  const direction = input.direction ?? "both";

  const conditions: SQL[] = [eq(knowledgeRelationships.organizationId, input.organizationId)];

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
    const decoded = decodeRelationshipCursor(input.cursor);
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
  const nextCursor = hasMore ? encodeRelationshipCursor(page[page.length - 1]) : null;

  const visible = await filterByOtherEndpointVisibility(db, input.organizationId, anchor.id, input.actorUserId, page);

  return { relationships: visible, nextCursor };
}

/**
 * Resolves one relationship by id, enforcing §7's visibility rule on BOTH
 * endpoints (not just tenant scoping) — a relationship whose other endpoint
 * the actor cannot independently read is a 404, identical to a nonexistent
 * relationship, via the same `TenantResourceNotFoundError`
 * `getKnowledgeItemForUser` already throws for the failing endpoint.
 */
export async function getRelationshipForUser(
  db: Db,
  organizationId: string,
  relationshipId: string,
  actorUserId: string
): Promise<KnowledgeRelationship> {
  await requireOrganizationMembership(db, organizationId, actorUserId);

  const relationship = (await requireTenantScopedResource(async () => {
    const [row] = await db
      .select()
      .from(knowledgeRelationships)
      .where(and(eq(knowledgeRelationships.id, relationshipId), eq(knowledgeRelationships.organizationId, organizationId)));
    return row;
  })) as KnowledgeRelationship;

  // Both endpoints must be independently visible — reuses getKnowledgeItemForUser's
  // own TenantResourceNotFoundError/knowledge_access_denied behavior for whichever
  // endpoint fails, rather than inventing a relationship-specific equivalent.
  await getKnowledgeItemForUser(db, organizationId, relationship.sourceItemId, actorUserId);
  await getKnowledgeItemForUser(db, organizationId, relationship.targetItemId, actorUserId);

  return relationship;
}

export interface ArchiveRelationshipInput {
  organizationId: string;
  relationshipId: string;
  actorUserId: string;
}

/**
 * Archives a relationship — entity 8's lifecycle note ("can be removed... a
 * correction, not a history-erasing act"). Never a hard delete: no `DELETE`
 * route and no `deleteRelationship`/`hardDeleteRelationship` function exist
 * anywhere in this module, matching every other Brain entity's "archive,
 * never erase" convention. Authorization is entity 8's exact rule —
 * requires UPDATE-level authority on BOTH endpoints (`requireEditableEndpoint`),
 * never the relationship's own `creatorUserId` (which is pure provenance,
 * never consulted for authorization — see that column's schema comment).
 *
 * Concurrency: a single atomic `UPDATE ... WHERE id = ? AND archived_at IS NULL`
 * is the complete guard — unlike an item or version, a relationship has no
 * other mutable field to protect against a lost update (there is no
 * `PATCH` for relationships at all), so the binary "not yet archived"
 * condition on the WHERE clause is itself sufficient; no separate
 * client-supplied concurrency token is needed or requested here. Two
 * concurrent archive attempts can only ever result in one success; the
 * loser's `UPDATE` affects zero rows and receives the identical
 * `RelationshipAlreadyArchivedError` a plain "already archived" pre-check
 * would produce.
 */
export async function archiveRelationship(db: Db, input: ArchiveRelationshipInput): Promise<KnowledgeRelationship> {
  const existing = await getRelationshipForUser(db, input.organizationId, input.relationshipId, input.actorUserId);

  if (existing.archivedAt !== null) {
    throw new RelationshipAlreadyArchivedError();
  }

  const source = await getKnowledgeItemForUser(db, input.organizationId, existing.sourceItemId, input.actorUserId);
  const target = await getKnowledgeItemForUser(db, input.organizationId, existing.targetItemId, input.actorUserId);

  // Denial auditing (knowledge_access_denied or brain_permission_denied,
  // targeting whichever endpoint item failed) happens inside
  // requireBrainMutateAccess itself — mirrors createRelationship's own
  // requireReadableEndpoint calls above, which are likewise never wrapped
  // in a second, relationship-level denial audit.
  await requireEditableEndpoint(db, source, input.actorUserId);
  await requireEditableEndpoint(db, target, input.actorUserId);

  const [updated] = await db
    .update(knowledgeRelationships)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(knowledgeRelationships.id, input.relationshipId), isNull(knowledgeRelationships.archivedAt)))
    .returning();

  if (!updated) {
    throw new RelationshipAlreadyArchivedError();
  }

  await recordAuditEvent(db, {
    eventType: "knowledge_relationship_archived",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_relationship",
    targetId: updated.id,
    metadata: {
      sourceItemId: existing.sourceItemId,
      targetItemId: existing.targetItemId,
      relationshipType: existing.relationshipType,
      sourceWorkspaceScoped: Boolean(source.workspaceId),
      targetWorkspaceScoped: Boolean(target.workspaceId),
    },
  });

  return updated as KnowledgeRelationship;
}
