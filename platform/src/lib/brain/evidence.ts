import "server-only";
import { and, eq, lt, desc, or, type SQL } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { knowledgeItemEvidence } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireBrainMutateAccess } from "./authz";
import { KnowledgeItemArchivedViolationError } from "./errors";
import { resolveKnowledgeItemVersionForUser } from "./knowledge-item-versions";
import type { TrustTier } from "./trust";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export type EvidenceClass = "primary" | "supporting" | "weak" | "historical" | "conflicting";

export interface Evidence {
  id: string;
  knowledgeItemId: string;
  knowledgeItemVersionId: string;
  evidenceClass: EvidenceClass;
  description: string;
  externalReference: string | null;
  /** The evidence's OWN trust tier — independent of the version's trust assessment (`trust.ts`). `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §3: "evidence trust is reassessed the same way a version's trust is," reusing the identical six-tier vocabulary. */
  evidenceTrustTier: TrustTier;
  /** Storage-ready but not mutable in this module — see this file's own doc comment. */
  isStale: boolean;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEvidenceInput {
  organizationId: string;
  knowledgeItemId: string;
  versionNumber: number;
  evidenceClass: EvidenceClass;
  description: string;
  externalReference?: string | null;
  evidenceTrustTier: TrustTier;
  actorUserId: string;
}

/**
 * Adds one new evidence row to a version — **append-only**:
 * `MODULE_3_BRAIN_ARCHITECTURE.md` §13 entity 7, "superseding evidence is
 * added, not edited over." There is no `updateEvidence`/`deleteEvidence`
 * function anywhere in this module. Authorization is ordinary content-edit
 * authority (`requireBrainMutateAccess("update")`) — a deliberately LOWER
 * bar than `attachTrustMetadata`'s `requireBrainApproveAccess`, matching
 * entity 7's own "Ownership: whoever performed the verification" (a
 * broader set of people than whoever holds approve-level authority over
 * the official trust tier). Rejects archived items, mirroring every other
 * Brain content mutation.
 */
export async function createEvidence(db: Db, input: CreateEvidenceInput): Promise<Evidence> {
  const { item, version } = await resolveKnowledgeItemVersionForUser(db, input.organizationId, input.knowledgeItemId, input.versionNumber, input.actorUserId);

  await requireBrainMutateAccess(
    db,
    { organizationId: input.organizationId, workspaceId: item.workspaceId, domain: item.domain, classification: item.classification },
    item.authorUserId,
    input.actorUserId,
    "update"
  );

  if (item.status === "archived") {
    throw new KnowledgeItemArchivedViolationError();
  }

  const [row] = await db
    .insert(knowledgeItemEvidence)
    .values({
      organizationId: input.organizationId,
      knowledgeItemId: item.id,
      knowledgeItemVersionId: version.id,
      evidenceClass: input.evidenceClass,
      description: input.description,
      externalReference: input.externalReference ?? null,
      evidenceTrustTier: input.evidenceTrustTier,
      createdByUserId: input.actorUserId,
    })
    .returning();

  await recordAuditEvent(db, {
    eventType: "knowledge_evidence_created",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item_version",
    targetId: version.id,
    metadata: {
      evidenceId: row.id,
      knowledgeItemId: item.id,
      versionNumber: version.versionNumber,
      evidenceClass: input.evidenceClass,
      evidenceTrustTier: input.evidenceTrustTier,
      workspaceScoped: Boolean(item.workspaceId),
    },
  });

  return row as Evidence;
}

export interface ListEvidenceForVersionInput {
  organizationId: string;
  knowledgeItemId: string;
  versionNumber: number;
  actorUserId: string;
  cursor?: string | null;
  limit?: number;
}

export interface ListEvidenceForVersionResult {
  evidence: Evidence[];
  nextCursor: string | null;
}

interface EvidenceCursor {
  createdAt: string;
  id: string;
}

function encodeEvidenceCursor(row: Pick<Evidence, "createdAt" | "id">): string {
  const payload: EvidenceCursor = { createdAt: row.createdAt.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeEvidenceCursor(cursor: string): EvidenceCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed?.createdAt === "string" && typeof parsed?.id === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Lists a version's evidence, newest first, bounded and cursor-paginated (never offset-based) — the same read-access gate as fetching the version itself; no separate, stricter bar for viewing evidence than for viewing the version it supports. */
export async function listEvidenceForVersion(db: Db, input: ListEvidenceForVersionInput): Promise<ListEvidenceForVersionResult> {
  const { version } = await resolveKnowledgeItemVersionForUser(db, input.organizationId, input.knowledgeItemId, input.versionNumber, input.actorUserId);

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const conditions: SQL[] = [eq(knowledgeItemEvidence.knowledgeItemVersionId, version.id)];

  if (input.cursor) {
    const decoded = decodeEvidenceCursor(input.cursor);
    if (decoded) {
      const cursorDate = new Date(decoded.createdAt);
      const cursorCondition = or(
        lt(knowledgeItemEvidence.createdAt, cursorDate),
        and(eq(knowledgeItemEvidence.createdAt, cursorDate), lt(knowledgeItemEvidence.id, decoded.id))
      );
      if (cursorCondition) conditions.push(cursorCondition);
    }
  }

  const rows = await db
    .select()
    .from(knowledgeItemEvidence)
    .where(and(...conditions))
    .orderBy(desc(knowledgeItemEvidence.createdAt), desc(knowledgeItemEvidence.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit) as Evidence[];
  const nextCursor = hasMore ? encodeEvidenceCursor(page[page.length - 1]) : null;

  return { evidence: page, nextCursor };
}
