import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, or, lt, desc, inArray, sql as drizzleSql, type SQL } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { knowledgeItems, knowledgeItemVersions, workspaceMemberships, workspaces, brainPermissionGrants } from "@/db/schema";
import { requireOrganizationMembership, requireWorkspaceMembership, requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { requireBrainReadAccess, requireBrainCreateAccess, requireBrainMutateAccess } from "./authz";
import { KnowledgeVersionConflictError, KnowledgeItemAlreadyArchivedError, KnowledgeItemArchivedViolationError, KnowledgeItemNotEditableError, InvalidLifecycleTransitionError } from "./errors";
import { isPostgresUniqueViolation } from "./db-errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

export type KnowledgeDomain =
  | "identity"
  | "offerings"
  | "market"
  | "execution"
  | "growth"
  | "governance"
  | "capability"
  | "wisdom";

/** Brain Module 14 — see `schema.ts`'s own comment on `decisionOutcomeEnum`. Meaningful only for `classification: "decision"` items. */
export type DecisionOutcome = "pending" | "succeeded" | "failed" | "mixed";

/**
 * The full eight-state lifecycle (`MODULE_3_BRAIN_ARCHITECTURE.md` §4),
 * extended in place from Module 1's original two-value `draft`/`archived`
 * set by Brain Modules 8/9 — see `MODULE_5_BRAIN_MODULE_8_9_LIFECYCLE.md`
 * and `src/lib/brain/lifecycle.ts` for the state machine, transition
 * guards, and why `idea`/`purged` have no code path that produces them yet.
 */
export type KnowledgeItemStatus = "idea" | "draft" | "review" | "approved" | "published" | "archived" | "retired" | "purged";

/**
 * The composed, client-facing shape (Brain Module 2) — `title`/`content`/
 * `classification` are no longer columns on `knowledge_items` itself; they
 * are resolved from whichever `knowledge_item_versions` row is currently
 * current, via `currentVersionId`. `currentVersionNumber` replaces Module
 * 1's `revision` as the concurrency token; the raw `currentVersionId` UUID
 * is deliberately never exposed here (Module 2's "don't expose unnecessary
 * internal IDs where version number is sufficient" rule).
 */
export interface KnowledgeItem {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  domain: KnowledgeDomain;
  classification: string;
  title: string;
  content: string;
  status: KnowledgeItemStatus;
  authorUserId: string | null;
  /** Brain Module 17 — see `authorUserId`'s own comment above; at most one of the two is ever non-null. `authorType` is `null` only for the rare legacy row where both the human author and (structurally impossible pre-Module-17) an agent author are absent. */
  authorAgentId: string | null;
  authorType: "human" | "agent" | null;
  currentVersionNumber: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  /** Brain Modules 8/9 — see `src/lib/brain/lifecycle.ts` for the state machine that populates these. */
  approvedByUserId: string | null;
  approvedAt: Date | null;
  publishedByUserId: string | null;
  publishedAt: Date | null;
  retiredByUserId: string | null;
  retiredAt: Date | null;
  retiredReason: string | null;
  outcome: DecisionOutcome;
}

/**
 * Every read of a knowledge item joins through its current version — there
 * is no other source for title/content/classification now. Exported
 * (Brain Module 16) so `src/lib/agents/brain-reads.ts` can compose the
 * identical item+version shape for an agent reader, rather than
 * re-deriving this column list a second time.
 */
export function composedItemSelection() {
  return {
    id: knowledgeItems.id,
    organizationId: knowledgeItems.organizationId,
    workspaceId: knowledgeItems.workspaceId,
    domain: knowledgeItems.domain,
    status: knowledgeItems.status,
    authorUserId: knowledgeItems.authorUserId,
    // Brain Module 17 — the agent-authored counterpart. Both are exposed
    // together (never collapsed into one "authorId" field) so a reader
    // never has to guess which kind of id it received.
    authorAgentId: knowledgeItems.authorAgentId,
    authorType: knowledgeItems.authorType,
    createdAt: knowledgeItems.createdAt,
    updatedAt: knowledgeItems.updatedAt,
    archivedAt: knowledgeItems.archivedAt,
    approvedByUserId: knowledgeItems.approvedByUserId,
    approvedAt: knowledgeItems.approvedAt,
    publishedByUserId: knowledgeItems.publishedByUserId,
    publishedAt: knowledgeItems.publishedAt,
    retiredByUserId: knowledgeItems.retiredByUserId,
    retiredAt: knowledgeItems.retiredAt,
    retiredReason: knowledgeItems.retiredReason,
    outcome: knowledgeItems.outcome,
    title: knowledgeItemVersions.title,
    content: knowledgeItemVersions.content,
    classification: knowledgeItemVersions.classification,
    currentVersionNumber: knowledgeItemVersions.versionNumber,
  };
}

export interface CreateKnowledgeItemInput {
  organizationId: string;
  workspaceId?: string | null;
  domain: KnowledgeDomain;
  classification: string;
  title: string;
  content: string;
  actorUserId: string;
}

/**
 * Creates a new Draft-status knowledge item AND its first immutable version
 * (version 1) atomically, then points `currentVersionId` at it — one never
 * exists in a persisted state without the other. Authorization requires the
 * `draft_write` Brain-domain capability at this exact scope
 * (`requireBrainCreateAccess`, `./authz.ts`, Module 7) — never inherited
 * from organization or workspace role.
 */
export async function createKnowledgeItem(db: Db, rawSql: RawSql, input: CreateKnowledgeItemInput): Promise<KnowledgeItem> {
  const workspaceId = input.workspaceId ?? null;
  await requireBrainCreateAccess(
    db,
    { organizationId: input.organizationId, workspaceId, domain: input.domain, classification: input.classification },
    input.actorUserId
  );

  const itemId = randomUUID();
  const versionId = randomUUID();
  const now = new Date();

  await rawSql.transaction([
    rawSql`INSERT INTO knowledge_items (id, organization_id, workspace_id, domain, status, author_user_id, created_at, updated_at)
           VALUES (${itemId}, ${input.organizationId}, ${workspaceId}, ${input.domain}::knowledge_domain, 'draft'::knowledge_item_status, ${input.actorUserId}, ${now}, ${now})`,
    rawSql`INSERT INTO knowledge_item_versions (id, knowledge_item_id, version_number, title, content, classification, created_by_user_id, change_reason, created_at)
           VALUES (${versionId}, ${itemId}, 1, ${input.title}, ${input.content}, ${input.classification}, ${input.actorUserId}, NULL, ${now})`,
    rawSql`UPDATE knowledge_items SET current_version_id = ${versionId} WHERE id = ${itemId}`,
  ]);

  await recordAuditEvent(db, {
    eventType: "knowledge_item_created",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    targetId: itemId,
    metadata: { domain: input.domain, classification: input.classification, workspaceScoped: Boolean(workspaceId) },
  });

  return {
    id: itemId,
    organizationId: input.organizationId,
    workspaceId,
    domain: input.domain,
    classification: input.classification,
    title: input.title,
    content: input.content,
    status: "draft",
    authorUserId: input.actorUserId,
    authorAgentId: null,
    authorType: "human",
    currentVersionNumber: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    approvedByUserId: null,
    approvedAt: null,
    publishedByUserId: null,
    publishedAt: null,
    retiredByUserId: null,
    retiredAt: null,
    retiredReason: null,
    outcome: "pending",
  };
}

/**
 * Resolves one knowledge item (composed with its current version's content)
 * enforcing the full read-access chain: the item must belong to
 * `organizationId` (a cross-tenant id is a 404, never distinguishable from
 * "doesn't exist"), and — if the item is workspace-scoped — the actor must
 * hold EXPLICIT membership in that exact workspace, AND an explicit `read`
 * Brain-domain capability at that exact scope (Module 7, `./authz.ts`).
 * Organization membership alone, including owner/admin, is never
 * sufficient for a workspace-scoped item, and no role ever substitutes for
 * the Domain Grant. Archived items remain readable — there is no
 * restriction on `status` here.
 */
export async function getKnowledgeItemForUser(
  db: Db,
  organizationId: string,
  knowledgeItemId: string,
  actorUserId: string
): Promise<KnowledgeItem> {
  const item = (await requireTenantScopedResource(async () => {
    const [row] = await db
      .select(composedItemSelection())
      .from(knowledgeItems)
      .innerJoin(knowledgeItemVersions, eq(knowledgeItems.currentVersionId, knowledgeItemVersions.id))
      .where(and(eq(knowledgeItems.id, knowledgeItemId), eq(knowledgeItems.organizationId, organizationId)));
    return row;
  })) as KnowledgeItem;

  // Gates 2–4 (organization membership, workspace membership if scoped, and
  // the `read` Domain Grant capability, Brain Module 7) — one call now
  // covers everything `requireBrainReadAccess` itself is responsible for;
  // no bespoke inline membership check is duplicated here anymore.
  await requireBrainReadAccess(
    db,
    { organizationId, workspaceId: item.workspaceId, domain: item.domain, classification: item.classification },
    actorUserId
  );

  return item;
}

export interface ListKnowledgeItemsInput {
  organizationId: string;
  workspaceId?: string | null;
  domain?: KnowledgeDomain;
  classification?: string;
  status?: KnowledgeItemStatus;
  cursor?: string | null;
  limit?: number;
  actorUserId: string;
}

export interface ListKnowledgeItemsResult {
  items: KnowledgeItem[];
  nextCursor: string | null;
}

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(item: Pick<KnowledgeItem, "createdAt" | "id">): string {
  const payload: Cursor = { createdAt: item.createdAt.toISOString(), id: item.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed?.createdAt === "string" && typeof parsed?.id === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The list of workspace ids, within one organization, that an actor holds
 * EXPLICIT membership in — the same "org-scoped items, plus items in any
 * workspace this actor explicitly belongs to" visibility computation
 * `listKnowledgeItemsForUser` needs, factored out here (Brain Module 3) so
 * `listRelationshipsForItem` (`src/lib/brain/relationships.ts`) can reuse
 * the identical query rather than duplicating this business rule a second
 * time.
 */
export async function getMemberWorkspaceIds(db: Db, organizationId: string, actorUserId: string): Promise<string[]> {
  const memberWorkspaces = await db
    .select({ id: workspaceMemberships.workspaceId })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(and(eq(workspaceMemberships.userId, actorUserId), eq(workspaces.organizationId, organizationId)));
  return memberWorkspaces.map((row) => row.id);
}

/** `${domain}:${workspaceId ?? "org"}` — the exact-scope-match key `resolveEffectiveBrainCapabilities` (`./authz.ts`) reasons about, reused here so list-filtering and single-item authorization apply the identical scope-matching rule. Exported so Module 10's `search.ts`/Module 11's `retrieval.ts` reuse the identical batched scope-filtering rule rather than re-deriving it. */
export function scopeKey(domain: string, workspaceId: string | null): string {
  return `${domain}:${workspaceId ?? "org"}`;
}

/**
 * The set of exact (domain, workspace-or-org) scopes, within one
 * organization, for which the actor holds an active `read` Domain Grant
 * (Brain Module 7) — the bulk equivalent of `resolveEffectiveBrainCapabilities`,
 * fetched once per list call rather than once per candidate row (avoiding
 * the N+1 a naive per-item capability check would require). Exported for
 * the identical reason `scopeKey` is — Modules 10/11 filter candidate rows
 * from a different query shape (full-text search, graph traversal) but
 * must apply this exact same permission rule, never a re-derived one.
 */
export async function getReadableBrainScopes(db: Db, organizationId: string, actorUserId: string): Promise<Set<string>> {
  const rows = await db
    .select({ domain: brainPermissionGrants.domain, workspaceId: brainPermissionGrants.workspaceId })
    .from(brainPermissionGrants)
    .where(
      and(
        eq(brainPermissionGrants.organizationId, organizationId),
        eq(brainPermissionGrants.granteeUserId, actorUserId),
        eq(brainPermissionGrants.capability, "read"),
        isNull(brainPermissionGrants.revokedAt)
      )
    );
  return new Set(rows.map((row) => scopeKey(row.domain, row.workspaceId)));
}

/**
 * Brain Module 16/8 — the agent-grantee equivalent of
 * `getReadableBrainScopes`, living here (not in `src/lib/agents/`) for the
 * same layering reason `resolveEffectiveBrainCapabilitiesForAgent` lives in
 * `brain/authz.ts` rather than `agents/`: Brain owns the permission model,
 * `agents/`/`tools/` only ever consume it, never the reverse. Same
 * bulk-fetch-once-per-list-call shape as its human sibling, to avoid an
 * N+1 per-item capability check.
 */
export async function getReadableBrainScopesForAgent(db: Db, organizationId: string, agentId: string): Promise<Set<string>> {
  const rows = await db
    .select({ domain: brainPermissionGrants.domain, workspaceId: brainPermissionGrants.workspaceId })
    .from(brainPermissionGrants)
    .where(
      and(
        eq(brainPermissionGrants.organizationId, organizationId),
        eq(brainPermissionGrants.granteeAgentId, agentId),
        eq(brainPermissionGrants.capability, "read"),
        isNull(brainPermissionGrants.revokedAt)
      )
    );
  return new Set(rows.map((row) => scopeKey(row.domain, row.workspaceId)));
}

/**
 * Lists knowledge items visible to the actor, bounded (never full-text or
 * semantic search — explicitly deferred to later Brain modules). Supports
 * only the essential filters Module 1 requires: workspace, domain,
 * classification, lifecycle status. Cursor-based, never offset-based
 * (Module 2 §14's pagination principle).
 *
 * When `workspaceId` is omitted, the result set is still never allowed to
 * include a workspace-scoped item the actor doesn't explicitly belong to —
 * organization-wide visibility is computed as "org-scoped items, plus items
 * in any workspace this actor is an explicit member of," never "every item
 * in the organization." **Brain Module 7 adds a second, independent
 * filter on top**: even within that workspace-visible set, an item is only
 * returned if the actor also holds an active `read` Domain Grant for its
 * exact (domain, workspace-or-org) scope — the identical gate-4 check
 * `getKnowledgeItemForUser` applies to a single item, batched here via
 * `getReadableBrainScopes` rather than one grant-resolution query per row.
 * As with Module 3's relationship-listing precedent, filtering happens
 * *after* the database page is fetched, so a returned page may legitimately
 * contain fewer than `limit` rows when some candidates are filtered out —
 * `nextCursor` is still computed from the last *fetched* row, so pagination
 * continues correctly past filtered rows.
 */
export async function listKnowledgeItemsForUser(db: Db, input: ListKnowledgeItemsInput): Promise<ListKnowledgeItemsResult> {
  await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  const status = input.status ?? "draft";
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

  const conditions: SQL[] = [eq(knowledgeItems.organizationId, input.organizationId), eq(knowledgeItems.status, status)];

  if (input.workspaceId) {
    await requireWorkspaceMembership(db, input.workspaceId, input.actorUserId);
    conditions.push(eq(knowledgeItems.workspaceId, input.workspaceId));
  } else {
    const memberWorkspaceIds = await getMemberWorkspaceIds(db, input.organizationId, input.actorUserId);
    const workspaceVisibility =
      memberWorkspaceIds.length > 0
        ? or(isNull(knowledgeItems.workspaceId), inArray(knowledgeItems.workspaceId, memberWorkspaceIds))
        : isNull(knowledgeItems.workspaceId);
    if (workspaceVisibility) conditions.push(workspaceVisibility);
  }

  if (input.domain) conditions.push(eq(knowledgeItems.domain, input.domain));
  if (input.classification) conditions.push(eq(knowledgeItemVersions.classification, input.classification));

  if (input.cursor) {
    const decoded = decodeCursor(input.cursor);
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
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;

  const readableScopes = await getReadableBrainScopes(db, input.organizationId, input.actorUserId);
  const visible = page.filter((item) => readableScopes.has(scopeKey(item.domain, item.workspaceId)));

  return { items: visible, nextCursor };
}

export interface CreateNextVersionInput {
  knowledgeItemId: string;
  expectedVersionNumber: number;
  title?: string;
  content?: string;
  classification?: string;
  actorUserId: string;
  changeReason?: string | null;
}

export interface NextVersionResult {
  versionId: string;
  knowledgeItemId: string;
  versionNumber: number;
}

/**
 * The shared atomic engine behind every content-changing write to a
 * knowledge item (a plain update, or a Module 2 restore/rollback): resolves
 * the current version, validates `expectedVersionNumber` against it,
 * creates the next immutable version (any field not provided falls back to
 * the current version's own value via `COALESCE`, so a partial update never
 * silently blanks an untouched field), and moves `currentVersionId` to
 * point at it — all as ONE Postgres statement, so there is no observable
 * window where a new version exists but the pointer hasn't moved, or vice
 * versa. Never touches an archived item (`status != 'archived'` is part of
 * the same guarded read).
 *
 * Returns `null` (never throws) when the guarded read matched zero rows —
 * either because `expectedVersionNumber` is stale, or (a rarer race) the
 * item was archived between the caller's own read and this call. Both are
 * reported to the caller identically as "conflict, refresh and retry."
 *
 * The per-item `(knowledge_item_id, version_number)` unique constraint is
 * the final concurrency guard for the remaining race this single guarded
 * read cannot fully close: two concurrent calls that both observe the same
 * current version before either commits. One of the two `INSERT`s will
 * violate that constraint; this function surfaces that exact case as a
 * conflict too, identically to the "stale expected version" case above.
 */
export async function createNextKnowledgeItemVersion(db: Db, input: CreateNextVersionInput): Promise<NextVersionResult | null> {
  try {
    const result = await db.execute<{ id: string; knowledge_item_id: string; version_number: number }>(drizzleSql`
      WITH current AS (
        SELECT ki.id AS item_id, kiv.title, kiv.content, kiv.classification, kiv.version_number
        FROM knowledge_items ki
        JOIN knowledge_item_versions kiv ON kiv.id = ki.current_version_id
        WHERE ki.id = ${input.knowledgeItemId}
          AND ki.status != 'archived'
          AND kiv.version_number = ${input.expectedVersionNumber}
      ),
      new_version AS (
        INSERT INTO knowledge_item_versions (id, knowledge_item_id, version_number, title, content, classification, created_by_user_id, change_reason, created_at)
        SELECT gen_random_uuid(), current.item_id, current.version_number + 1,
               COALESCE(${input.title ?? null}, current.title),
               COALESCE(${input.content ?? null}, current.content),
               COALESCE(${input.classification ?? null}, current.classification),
               ${input.actorUserId}, ${input.changeReason ?? null}, now()
        FROM current
        RETURNING id, knowledge_item_id, version_number
      ),
      updated_item AS (
        UPDATE knowledge_items
        SET current_version_id = (SELECT id FROM new_version), updated_at = now()
        WHERE id = (SELECT knowledge_item_id FROM new_version)
        RETURNING id
      )
      SELECT nv.id, nv.knowledge_item_id, nv.version_number
      FROM new_version nv
      JOIN updated_item ui ON ui.id = nv.knowledge_item_id
    `);

    const row = result.rows[0];
    if (!row) return null;
    return { versionId: row.id, knowledgeItemId: row.knowledge_item_id, versionNumber: Number(row.version_number) };
  } catch (err) {
    if (isPostgresUniqueViolation(err)) return null;
    throw err;
  }
}

export interface UpdateKnowledgeItemInput {
  organizationId: string;
  knowledgeItemId: string;
  actorUserId: string;
  expectedVersionNumber: number;
  updates: {
    title?: string;
    content?: string;
    classification?: string;
  };
  changeReason?: string | null;
}

/**
 * Updates a knowledge item's content by creating a new immutable version
 * (Brain Module 2) rather than overwriting anything in place. `domain` is
 * deliberately NOT updatable here — see `knowledgeItems`' own schema comment
 * for why domain is a stable ownership/permission boundary, not content.
 * Protected against lost updates via `expectedVersionNumber` (optimistic
 * concurrency) — a stale value is rejected, never silently overwritten.
 */
export async function updateKnowledgeItem(db: Db, input: UpdateKnowledgeItemInput): Promise<KnowledgeItem> {
  const existing = await getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);

  // Runs its own full gate 2–4 check (org/workspace membership + the
  // edit_own_draft/edit_any_draft Domain Grant capability, Brain Module 7)
  // and audits its own denial — no separate ctx-fetch or try/catch needed
  // here anymore.
  await requireBrainMutateAccess(
    db,
    { organizationId: input.organizationId, workspaceId: existing.workspaceId, domain: existing.domain, classification: existing.classification },
    existing.authorUserId,
    input.actorUserId,
    "update"
  );

  if (existing.status === "archived") {
    throw new KnowledgeItemArchivedViolationError();
  }
  if (existing.status !== "draft") {
    throw new KnowledgeItemNotEditableError(existing.status);
  }

  const result = await createNextKnowledgeItemVersion(db, {
    knowledgeItemId: input.knowledgeItemId,
    expectedVersionNumber: input.expectedVersionNumber,
    title: input.updates.title,
    content: input.updates.content,
    classification: input.updates.classification,
    actorUserId: input.actorUserId,
    changeReason: input.changeReason ?? null,
  });

  if (!result) {
    await recordAuditEvent(db, {
      eventType: "knowledge_version_conflict",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "knowledge_item",
      targetId: existing.id,
      metadata: {
        action: "update",
        expectedVersionNumber: input.expectedVersionNumber,
        domain: existing.domain,
        workspaceScoped: Boolean(existing.workspaceId),
      },
    });
    throw new KnowledgeVersionConflictError();
  }

  await recordAuditEvent(db, {
    eventType: "knowledge_version_created",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    targetId: existing.id,
    metadata: {
      versionNumber: result.versionNumber,
      previousVersionNumber: input.expectedVersionNumber,
      changeReason: input.changeReason ?? null,
      fieldsChanged: Object.keys(input.updates),
      domain: existing.domain,
      workspaceScoped: Boolean(existing.workspaceId),
    },
  });

  return getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
}

export interface ArchiveKnowledgeItemInput {
  organizationId: string;
  knowledgeItemId: string;
  actorUserId: string;
  expectedVersionNumber: number;
}

/**
 * Archives a knowledge item — legal from any non-terminal status (Module
 * 1's original `idea`/`draft`/`review` behavior, preserved unchanged, plus
 * `approved`/`published` per `MODULE_3_BRAIN_ARCHITECTURE.md` §4's
 * explicit diagram edges), never from `retired`/`purged`. Reversible via
 * `restoreKnowledgeItem` (Brain Module 9, `lifecycle.ts`) — a genuine
 * re-approval, not a technicality. No hard-delete endpoint exists anywhere
 * in this module. Archiving is purely an item-level lifecycle transition:
 * it never creates a new content version and never rewrites any historical
 * version — the current version stays current, and all versions (including
 * it) remain readable per Module 1's "archived items remain readable" rule.
 */
export async function archiveKnowledgeItem(db: Db, input: ArchiveKnowledgeItemInput): Promise<KnowledgeItem> {
  const existing = await getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);

  await requireBrainMutateAccess(
    db,
    { organizationId: input.organizationId, workspaceId: existing.workspaceId, domain: existing.domain, classification: existing.classification },
    existing.authorUserId,
    input.actorUserId,
    "archive"
  );

  if (existing.status === "archived") {
    throw new KnowledgeItemAlreadyArchivedError();
  }
  if (existing.status === "retired" || existing.status === "purged") {
    throw new InvalidLifecycleTransitionError(existing.status, "archived");
  }

  const [updated] = await db
    .update(knowledgeItems)
    .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeItems.id, input.knowledgeItemId),
        drizzleSql`${knowledgeItems.currentVersionId} = (SELECT id FROM knowledge_item_versions WHERE knowledge_item_id = ${input.knowledgeItemId} AND version_number = ${input.expectedVersionNumber})`
      )
    )
    .returning();

  if (!updated) {
    await recordAuditEvent(db, {
      eventType: "knowledge_version_conflict",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "knowledge_item",
      targetId: existing.id,
      metadata: {
        action: "archive",
        expectedVersionNumber: input.expectedVersionNumber,
        domain: existing.domain,
        workspaceScoped: Boolean(existing.workspaceId),
      },
    });
    throw new KnowledgeVersionConflictError();
  }

  await recordAuditEvent(db, {
    eventType: "knowledge_item_archived",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    targetId: updated.id,
    metadata: { domain: existing.domain, classification: existing.classification, workspaceScoped: Boolean(existing.workspaceId) },
  });

  return getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
}
