import "server-only";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { knowledgeItemSources, knowledgeItemTrust } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireBrainApproveAccess } from "./authz";
import { TrustAssessmentConflictError, SourceImmutableViolationError, KnowledgeItemArchivedViolationError, ObservationTrustCeilingError } from "./errors";
import { resolveKnowledgeItemVersionForUser } from "./knowledge-item-versions";
import { isPostgresUniqueViolation } from "./db-errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export type TrustTier = "verified" | "approved" | "observed" | "hypothesis" | "unknown" | "deprecated";

export type SourceType =
  | "founder_decision"
  | "official_documentation"
  | "client_approved"
  | "internal_documentation"
  | "meeting_notes"
  | "ai_generated_draft"
  | "external_research"
  | "open_internet_search"
  | "unverified";

export interface SourceRecord {
  sourceType: SourceType;
  sourceDetail: string | null;
  recordedByUserId: string | null;
  recordedAt: Date;
}

export interface TrustAssessment {
  /** `"unknown"` and `revision: 0` when no assessment has ever been recorded — see `getTrustAssessmentForVersion`'s doc comment for why this is synthesized rather than requiring a materialized row. */
  trustTier: TrustTier;
  revision: number;
  lastAssessedByUserId: string | null;
  assessedAt: Date | null;
}

export interface VersionTrustView {
  knowledgeItemId: string;
  versionNumber: number;
  trust: TrustAssessment;
  source: SourceRecord | null;
}

/**
 * Retrieves the combined Trust + Source view for one version. Never
 * requires a materialized `knowledge_item_trust`/`knowledge_item_sources`
 * row to exist — a version nobody has ever assessed yet is not an error,
 * it is exactly `MODULE_3_BRAIN_ARCHITECTURE.md` §5's "Unknown: an
 * explicit, tracked gap" tier, synthesized here (`trustTier: "unknown"`,
 * `revision: 0`, `source: null`) rather than requiring Module 4 to reach
 * backward into Module 2's version-creation code path just to guarantee a
 * row always exists.
 */
export async function getTrustAssessmentForVersion(
  db: Db,
  organizationId: string,
  knowledgeItemId: string,
  versionNumber: number,
  actorUserId: string
): Promise<VersionTrustView> {
  const { item, version } = await resolveKnowledgeItemVersionForUser(db, organizationId, knowledgeItemId, versionNumber, actorUserId);

  const [trustRow] = await db.select().from(knowledgeItemTrust).where(eq(knowledgeItemTrust.knowledgeItemVersionId, version.id));
  const [sourceRow] = await db.select().from(knowledgeItemSources).where(eq(knowledgeItemSources.knowledgeItemVersionId, version.id));

  return {
    knowledgeItemId: item.id,
    versionNumber: version.versionNumber,
    trust: trustRow
      ? { trustTier: trustRow.trustTier, revision: trustRow.revision, lastAssessedByUserId: trustRow.lastAssessedByUserId, assessedAt: trustRow.updatedAt }
      : { trustTier: "unknown", revision: 0, lastAssessedByUserId: null, assessedAt: null },
    source: sourceRow
      ? { sourceType: sourceRow.sourceType, sourceDetail: sourceRow.sourceDetail, recordedByUserId: sourceRow.recordedByUserId, recordedAt: sourceRow.createdAt }
      : null,
  };
}

export interface AttachTrustMetadataInput {
  organizationId: string;
  knowledgeItemId: string;
  versionNumber: number;
  trustTier: TrustTier;
  /** `0` means "I believe no assessment exists yet for this version" — the sentinel for a first-ever attach. Always required; never inferred from `updated_at`. */
  expectedRevision: number;
  sourceType: SourceType;
  sourceDetail?: string | null;
  actorUserId: string;
}

/**
 * Attaches (first time) or reassesses (every later time) a version's trust
 * metadata — the single operation behind both "attach trust metadata to a
 * new version" and "update trust" in this module's scope, since both are,
 * structurally, the identical atomic upsert against `knowledge_item_trust`
 * (see MODULE_5_BRAIN_MODULE_4_TRUST_AND_EVIDENCE.md's "Trust Model"
 * section for the full reasoning — Trust is reassessed in place, per
 * `MODULE_3_BRAIN_ARCHITECTURE.md` §13 entity 6, never re-versioned).
 *
 * Requires `requireBrainApproveAccess` — the `approve` Brain-domain
 * capability at this exact scope (Module 7; a strictly higher bar than
 * ordinary content-edit authority, never substitutable by authorship or
 * any organization/workspace role; see that function's own doc comment in
 * `authz.ts`). Rejects archived items
 * (creating/reassessing a trust record is itself a content-graph mutation
 * touching the item, mirroring Module 3's identical rule for relationships).
 *
 * Source is recorded once, on the first successful call for a version, and
 * is immutable thereafter (entity 5: "correcting a misattributed source
 * requires a new version, not an edit to the source record") — every
 * subsequent call must restate the identical `sourceType` (a fresh
 * reviewer re-confirming context) or be rejected with
 * `SourceImmutableViolationError`; it is never silently ignored or
 * silently overwritten.
 */
export async function attachTrustMetadata(db: Db, input: AttachTrustMetadataInput): Promise<VersionTrustView> {
  const { item, version } = await resolveKnowledgeItemVersionForUser(db, input.organizationId, input.knowledgeItemId, input.versionNumber, input.actorUserId);

  await requireBrainApproveAccess(
    db,
    { organizationId: input.organizationId, workspaceId: item.workspaceId, domain: item.domain, classification: item.classification },
    input.actorUserId
  );

  if (item.status === "archived") {
    throw new KnowledgeItemArchivedViolationError();
  }
  if (item.classification === "observation" && input.trustTier === "verified") {
    throw new ObservationTrustCeilingError();
  }

  const sourceJustRecorded = await recordSourceOnce(db, {
    organizationId: input.organizationId,
    knowledgeItemId: item.id,
    knowledgeItemVersionId: version.id,
    sourceType: input.sourceType,
    sourceDetail: input.sourceDetail ?? null,
    actorUserId: input.actorUserId,
  });

  if (sourceJustRecorded) {
    await recordAuditEvent(db, {
      eventType: "knowledge_source_recorded",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "knowledge_item_version",
      targetId: version.id,
      metadata: { knowledgeItemId: item.id, versionNumber: version.versionNumber, sourceType: input.sourceType, workspaceScoped: Boolean(item.workspaceId) },
    });
  }

  const result = await db.execute<{
    trust_tier: TrustTier;
    revision: number;
    last_assessed_by_user_id: string | null;
    updated_at: string;
  }>(drizzleSql`
    INSERT INTO knowledge_item_trust (id, organization_id, knowledge_item_id, knowledge_item_version_id, trust_tier, revision, last_assessed_by_user_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${input.organizationId}, ${item.id}, ${version.id}, ${input.trustTier}, 1, ${input.actorUserId}, now(), now())
    ON CONFLICT (knowledge_item_version_id) DO UPDATE
    SET trust_tier = excluded.trust_tier, revision = knowledge_item_trust.revision + 1, last_assessed_by_user_id = excluded.last_assessed_by_user_id, updated_at = now()
    WHERE knowledge_item_trust.revision = ${input.expectedRevision}
    RETURNING trust_tier, revision, last_assessed_by_user_id, updated_at
  `);

  const trustRow = result.rows[0];
  if (!trustRow) {
    await recordAuditEvent(db, {
      eventType: "knowledge_trust_conflict",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "knowledge_item_version",
      targetId: version.id,
      metadata: { knowledgeItemId: item.id, versionNumber: version.versionNumber, expectedRevision: input.expectedRevision, workspaceScoped: Boolean(item.workspaceId) },
    });
    throw new TrustAssessmentConflictError();
  }

  await recordAuditEvent(db, {
    eventType: "knowledge_trust_assessed",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item_version",
    targetId: version.id,
    metadata: {
      knowledgeItemId: item.id,
      versionNumber: version.versionNumber,
      trustTier: trustRow.trust_tier,
      revision: Number(trustRow.revision),
      workspaceScoped: Boolean(item.workspaceId),
    },
  });

  const [sourceRow] = await db.select().from(knowledgeItemSources).where(eq(knowledgeItemSources.knowledgeItemVersionId, version.id));

  return {
    knowledgeItemId: item.id,
    versionNumber: version.versionNumber,
    trust: {
      trustTier: trustRow.trust_tier,
      revision: Number(trustRow.revision),
      lastAssessedByUserId: trustRow.last_assessed_by_user_id,
      assessedAt: new Date(trustRow.updated_at),
    },
    source: sourceRow
      ? { sourceType: sourceRow.sourceType, sourceDetail: sourceRow.sourceDetail, recordedByUserId: sourceRow.recordedByUserId, recordedAt: sourceRow.createdAt }
      : null,
  };
}

interface RecordSourceOnceInput {
  organizationId: string;
  knowledgeItemId: string;
  knowledgeItemVersionId: string;
  sourceType: SourceType;
  sourceDetail: string | null;
  actorUserId: string;
}

/**
 * Records a version's Source the first time it is stated, or verifies a
 * later call restates the identical `sourceType` — never a second, silent
 * write. Attempts the insert directly rather than a pre-check `SELECT`
 * first (which would itself race); a genuine concurrent-first-attach race
 * is caught via `knowledge_item_sources_version_unique`'s `23505` and
 * resolved by re-reading whatever the winner actually recorded — matching
 * the case where a later, non-racing caller simply restates the same
 * source. Returns `true` only when this call is the one that actually
 * created the row (so the caller writes exactly one
 * `knowledge_source_recorded` audit event, never zero, never two).
 */
async function recordSourceOnce(db: Db, input: RecordSourceOnceInput): Promise<boolean> {
  try {
    await db.insert(knowledgeItemSources).values({
      organizationId: input.organizationId,
      knowledgeItemId: input.knowledgeItemId,
      knowledgeItemVersionId: input.knowledgeItemVersionId,
      sourceType: input.sourceType,
      sourceDetail: input.sourceDetail,
      recordedByUserId: input.actorUserId,
    });
    return true;
  } catch (err) {
    if (!isPostgresUniqueViolation(err)) throw err;

    const [existing] = await db
      .select()
      .from(knowledgeItemSources)
      .where(and(eq(knowledgeItemSources.knowledgeItemVersionId, input.knowledgeItemVersionId)));

    if (existing.sourceType !== input.sourceType) {
      throw new SourceImmutableViolationError();
    }
    return false;
  }
}
