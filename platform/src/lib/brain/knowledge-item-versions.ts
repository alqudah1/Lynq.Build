import "server-only";
import { and, eq, lt, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { knowledgeItemVersions } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireBrainMutateAccess } from "./authz";
import { KnowledgeVersionConflictError, KnowledgeItemArchivedViolationError } from "./errors";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getKnowledgeItemForUser, createNextKnowledgeItemVersion, type KnowledgeItem } from "./knowledge-items";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * The client-facing version shape (Module 2 §"Version metadata exposed"):
 * version number, author, timestamp, change reason, and a `isCurrent` flag
 * — deliberately never the version row's own internal `id`, since the
 * version number is sufficient to address it within its item (see the
 * `versions/:versionNumber` routes).
 */
export interface KnowledgeItemVersionSummary {
  versionNumber: number;
  title: string;
  content: string;
  classification: string;
  createdByUserId: string | null;
  /** Brain Module 17 — see `knowledgeItems.authorAgentId`'s own comment; at most one of `createdByUserId`/`createdByAgentId` is ever non-null. */
  createdByAgentId: string | null;
  createdByType: "human" | "agent" | null;
  changeReason: string | null;
  createdAt: Date;
  isCurrent: boolean;
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

export interface ListKnowledgeItemVersionsInput {
  organizationId: string;
  knowledgeItemId: string;
  actorUserId: string;
  cursor?: string | null;
  limit?: number;
}

export interface ListKnowledgeItemVersionsResult {
  versions: KnowledgeItemVersionSummary[];
  nextCursor: string | null;
}

/**
 * Lists a knowledge item's complete version history, newest first. Requires
 * the identical tenant/workspace authorization as the parent item — an
 * inaccessible or nonexistent item is a 404 here too (via
 * `getKnowledgeItemForUser`), never distinguishable from "exists but has no
 * versions the actor can see." Bounded, cursor-based (never offset-based).
 */
export async function listKnowledgeItemVersionsForUser(db: Db, input: ListKnowledgeItemVersionsInput): Promise<ListKnowledgeItemVersionsResult> {
  const item = await getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);

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

  return {
    versions: page.map((row) => ({
      versionNumber: row.versionNumber,
      title: row.title,
      content: row.content,
      classification: row.classification,
      createdByUserId: row.createdByUserId,
      createdByAgentId: row.createdByAgentId,
      createdByType: row.createdByType,
      changeReason: row.changeReason,
      createdAt: row.createdAt,
      isCurrent: row.versionNumber === item.currentVersionNumber,
    })),
    nextCursor: nextCursor,
  };
}

export interface ResolvedKnowledgeItemVersion {
  item: KnowledgeItem;
  /** The raw row, including its internal `id` — deliberately NOT part of `KnowledgeItemVersionSummary` (never exposed over HTTP; version number is the public identifier). Brain Module 4's `trust.ts`/`evidence.ts` need this real UUID as their tables' own FK target. */
  version: {
    id: string;
    knowledgeItemId: string;
    versionNumber: number;
    title: string;
    content: string;
    classification: string;
    createdByUserId: string | null;
    createdByAgentId: string | null;
    createdByType: "human" | "agent" | null;
    changeReason: string | null;
    createdAt: Date;
  };
}

/**
 * Resolves exactly one historical version by its per-item version number,
 * returning the raw row (including its internal id) alongside the parent
 * item — the shared internal engine behind `getKnowledgeItemVersionForUser`
 * below, factored out so other Brain modules that genuinely need the
 * version's own UUID (Module 4's trust/evidence tables, which FK to it
 * directly) can resolve+authorize a version without duplicating this exact
 * query. `TenantResourceNotFoundError` (404) covers both "the item is
 * inaccessible" (via `getKnowledgeItemForUser`) and "this version number
 * doesn't exist for this item."
 */
export async function resolveKnowledgeItemVersionForUser(
  db: Db,
  organizationId: string,
  knowledgeItemId: string,
  versionNumber: number,
  actorUserId: string
): Promise<ResolvedKnowledgeItemVersion> {
  const item = await getKnowledgeItemForUser(db, organizationId, knowledgeItemId, actorUserId);

  const [row] = await db
    .select()
    .from(knowledgeItemVersions)
    .where(and(eq(knowledgeItemVersions.knowledgeItemId, item.id), eq(knowledgeItemVersions.versionNumber, versionNumber)));

  if (!row) {
    throw new TenantResourceNotFoundError();
  }

  return { item, version: row };
}

/**
 * Resolves exactly one historical version by its per-item version number.
 * `TenantResourceNotFoundError` (404) covers both "the item is inaccessible"
 * (via `getKnowledgeItemForUser`) and "this version number doesn't exist for
 * this item" — the same "never leak existence" reasoning applied everywhere
 * else in this codebase, now extended to version numbers too.
 */
export async function getKnowledgeItemVersionForUser(
  db: Db,
  organizationId: string,
  knowledgeItemId: string,
  versionNumber: number,
  actorUserId: string
): Promise<KnowledgeItemVersionSummary> {
  const { item, version: row } = await resolveKnowledgeItemVersionForUser(db, organizationId, knowledgeItemId, versionNumber, actorUserId);

  return {
    versionNumber: row.versionNumber,
    title: row.title,
    content: row.content,
    classification: row.classification,
    createdByUserId: row.createdByUserId,
    createdByAgentId: row.createdByAgentId,
    createdByType: row.createdByType,
    changeReason: row.changeReason,
    createdAt: row.createdAt,
    isCurrent: row.versionNumber === item.currentVersionNumber,
  };
}

/** Convenience wrapper — the current version is just the highest-numbered one, already known once the parent item is resolved. */
export async function getCurrentKnowledgeItemVersionForUser(
  db: Db,
  organizationId: string,
  knowledgeItemId: string,
  actorUserId: string
): Promise<KnowledgeItemVersionSummary> {
  const item = await getKnowledgeItemForUser(db, organizationId, knowledgeItemId, actorUserId);
  return getKnowledgeItemVersionForUser(db, organizationId, item.id, item.currentVersionNumber, actorUserId);
}

export interface RestoreKnowledgeItemVersionInput {
  organizationId: string;
  knowledgeItemId: string;
  sourceVersionNumber: number;
  expectedVersionNumber: number;
  changeReason: string;
  actorUserId: string;
}

/**
 * Restores a historical version by creating a brand-new current version
 * whose content copies `sourceVersionNumber` — never by moving the current
 * pointer backward. If the current version is v5 and a caller restores from
 * v2, the result is a new v6 whose title/content/classification match v2,
 * with `changeReason` recording the restoration. Requires the same
 * authorization as a plain update (current authority to update this item),
 * the current concurrency token, and a mandatory, non-empty change reason.
 * Rollback of an archived item is not permitted — Module 1's approved
 * lifecycle does not allow it.
 */
export async function restoreKnowledgeItemVersion(db: Db, input: RestoreKnowledgeItemVersionInput): Promise<KnowledgeItem> {
  const existing = await getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);

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

  const source = await getKnowledgeItemVersionForUser(db, input.organizationId, input.knowledgeItemId, input.sourceVersionNumber, input.actorUserId);

  const result = await createNextKnowledgeItemVersion(db, {
    knowledgeItemId: existing.id,
    expectedVersionNumber: input.expectedVersionNumber,
    title: source.title,
    content: source.content,
    classification: source.classification,
    actorUserId: input.actorUserId,
    changeReason: input.changeReason,
  });

  if (!result) {
    await recordAuditEvent(db, {
      eventType: "knowledge_version_conflict",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "knowledge_item",
      targetId: existing.id,
      metadata: {
        action: "restore",
        expectedVersionNumber: input.expectedVersionNumber,
        sourceVersionNumber: input.sourceVersionNumber,
        domain: existing.domain,
        workspaceScoped: Boolean(existing.workspaceId),
      },
    });
    throw new KnowledgeVersionConflictError();
  }

  await recordAuditEvent(db, {
    eventType: "knowledge_version_restored",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    targetId: existing.id,
    metadata: {
      versionNumber: result.versionNumber,
      previousVersionNumber: input.expectedVersionNumber,
      restoredFromVersionNumber: input.sourceVersionNumber,
      changeReason: input.changeReason,
      domain: existing.domain,
      workspaceScoped: Boolean(existing.workspaceId),
    },
  });

  return getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
}
