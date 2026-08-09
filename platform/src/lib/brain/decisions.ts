import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { knowledgeItems } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireBrainMutateAccess, requireBrainApproveAccess } from "./authz";
import {
  NotADecisionItemError,
  KnowledgeItemArchivedViolationError,
  KnowledgeVersionConflictError,
  SelfRelationshipViolationError,
  DuplicateRelationshipError,
} from "./errors";
import { isPostgresUniqueViolation } from "./db-errors";
import { getKnowledgeItemForUser, createNextKnowledgeItemVersion, type KnowledgeItem, type DecisionOutcome } from "./knowledge-items";
import { resolveKnowledgeItemVersionForUser } from "./knowledge-item-versions";
import { getTrustAssessmentForVersion } from "./trust";
import type { KnowledgeRelationship } from "./relationships";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

/**
 * ============================================================================
 * Brain decisions — Module 14 (Decision Tracking)
 * ============================================================================
 *
 * `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §5: Decision is a `classification`
 * value on the existing `knowledge_items` table (no dedicated table, same
 * "content shape is a classification, not a table" decision as Observation
 * — Module 3 §1). Who/why/evidence/alternatives/risks are already fully
 * expressible with existing Module 1–7 primitives (Source, `changeReason`,
 * `created_from`/`references`/`related_to` edges) — this file adds the two
 * operations §5 names that existing primitives don't already cover:
 * recording an Outcome, and superseding a standing Decision.
 */

export interface RecordDecisionOutcomeInput {
  organizationId: string;
  knowledgeItemId: string;
  outcome: DecisionOutcome;
  expectedVersionNumber: number;
  changeReason: string;
  actorUserId: string;
}

/**
 * §5/§12: Outcome starts `pending` and is updated once real-world results
 * are known — recorded as a NEW VERSION of the same item (the decision's
 * identity hasn't changed), never a new item and never an in-place mutation
 * of existing content. Deliberately calls `createNextKnowledgeItemVersion`
 * directly rather than `updateKnowledgeItem` — outcomes are typically only
 * knowable well after a Decision has left `draft` (Approved/Published), and
 * `updateKnowledgeItem`'s own Module 8/9 restriction ("only `draft` items
 * may be edited directly") does not apply to this operation; the version
 * this creates carries the identical title/content/classification
 * (COALESCE'd forward unchanged) with only a fresh `changeReason` — the
 * outcome explanation — and the item's own `outcome` column updated
 * alongside it.
 */
export async function recordDecisionOutcome(db: Db, input: RecordDecisionOutcomeInput): Promise<KnowledgeItem> {
  const existing = await getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
  if (existing.classification !== "decision") {
    throw new NotADecisionItemError();
  }

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

  const result = await createNextKnowledgeItemVersion(db, {
    knowledgeItemId: existing.id,
    expectedVersionNumber: input.expectedVersionNumber,
    changeReason: input.changeReason,
    actorUserId: input.actorUserId,
  });

  if (!result) {
    await recordAuditEvent(db, {
      eventType: "knowledge_version_conflict",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "knowledge_item",
      targetId: existing.id,
      metadata: { action: "record_decision_outcome", expectedVersionNumber: input.expectedVersionNumber, domain: existing.domain, workspaceScoped: Boolean(existing.workspaceId) },
    });
    throw new KnowledgeVersionConflictError();
  }

  await db.update(knowledgeItems).set({ outcome: input.outcome, updatedAt: new Date() }).where(eq(knowledgeItems.id, existing.id));

  await recordAuditEvent(db, {
    eventType: "knowledge_decision_outcome_recorded",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    targetId: existing.id,
    metadata: { outcome: input.outcome, versionNumber: result.versionNumber, domain: existing.domain, workspaceScoped: Boolean(existing.workspaceId) },
  });

  return getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
}

export interface SupersedeDecisionInput {
  organizationId: string;
  oldDecisionItemId: string;
  newDecisionItemId: string;
  actorUserId: string;
}

export interface SupersedeDecisionResult {
  oldItem: KnowledgeItem;
  relationship: KnowledgeRelationship;
}

/**
 * §5: "Overturning a Decision requires the same or higher approval
 * authority as the original approval — the same rule Module 3 already
 * applies to restoring archived knowledge, applied here to reversing a
 * decision specifically." This codebase's capability model is flat (a
 * single `approve` grant per exact scope, no seniority tiers) — "same or
 * higher" therefore resolves identically to Module 9's own restore-authority
 * rule: the actor must hold `approve` at the OLD decision's exact scope,
 * full stop. Documented here rather than adopted silently, matching how
 * every other flat-vs-tiered ambiguity in this Brain implementation has
 * been resolved.
 *
 * Creates a `supersedes` edge (new → old, §7's "A supersedes B" direction)
 * and steps the old decision's current-version trust to `deprecated` in
 * ONE database transaction — never a window where one applies without the
 * other. Uses `stepTrustTier`-shaped raw SQL directly (not
 * `attachTrustMetadata`, which mandates a `sourceType` — nothing about a
 * side-effect trust step should ever fabricate or overwrite a Source
 * record) batched alongside the raw relationship insert, mirroring
 * `createKnowledgeItem`'s own established atomic-multi-statement pattern.
 */
export async function supersedeDecision(db: Db, rawSql: RawSql, input: SupersedeDecisionInput): Promise<SupersedeDecisionResult> {
  if (input.oldDecisionItemId === input.newDecisionItemId) {
    throw new SelfRelationshipViolationError();
  }

  const oldItem = await getKnowledgeItemForUser(db, input.organizationId, input.oldDecisionItemId, input.actorUserId);
  const newItem = await getKnowledgeItemForUser(db, input.organizationId, input.newDecisionItemId, input.actorUserId);

  if (oldItem.classification !== "decision" || newItem.classification !== "decision") {
    throw new NotADecisionItemError();
  }

  await requireBrainApproveAccess(
    db,
    { organizationId: input.organizationId, workspaceId: oldItem.workspaceId, domain: oldItem.domain, classification: oldItem.classification },
    input.actorUserId
  );

  const { version: oldVersion } = await resolveKnowledgeItemVersionForUser(db, input.organizationId, oldItem.id, oldItem.currentVersionNumber, input.actorUserId);
  const currentTrust = await getTrustAssessmentForVersion(db, input.organizationId, oldItem.id, oldItem.currentVersionNumber, input.actorUserId);

  const relationshipId = randomUUID();
  const now = new Date();
  try {
    await rawSql.transaction([
      rawSql`INSERT INTO knowledge_relationships (id, organization_id, source_item_id, target_item_id, relationship_type, creator_user_id, created_at, updated_at)
             VALUES (${relationshipId}, ${input.organizationId}, ${newItem.id}, ${oldItem.id}, 'supersedes', ${input.actorUserId}, ${now}, ${now})`,
      rawSql`INSERT INTO knowledge_item_trust (id, organization_id, knowledge_item_id, knowledge_item_version_id, trust_tier, revision, last_assessed_by_user_id, created_at, updated_at)
             VALUES (gen_random_uuid(), ${input.organizationId}, ${oldItem.id}, ${oldVersion.id}, 'deprecated', ${currentTrust.trust.revision + 1}, ${input.actorUserId}, ${now}, ${now})
             ON CONFLICT (knowledge_item_version_id) DO UPDATE
             SET trust_tier = 'deprecated', revision = knowledge_item_trust.revision + 1, last_assessed_by_user_id = excluded.last_assessed_by_user_id, updated_at = now()
             WHERE knowledge_item_trust.revision = ${currentTrust.trust.revision}`,
    ]);
  } catch (err) {
    if (isPostgresUniqueViolation(err)) {
      throw new DuplicateRelationshipError();
    }
    throw err;
  }

  await recordAuditEvent(db, {
    eventType: "knowledge_decision_superseded",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    targetId: oldItem.id,
    metadata: { newDecisionItemId: newItem.id, domain: oldItem.domain, workspaceScoped: Boolean(oldItem.workspaceId) },
  });

  const updatedOldItem = await getKnowledgeItemForUser(db, input.organizationId, input.oldDecisionItemId, input.actorUserId);
  const relationship: KnowledgeRelationship = {
    id: relationshipId,
    organizationId: input.organizationId,
    sourceItemId: newItem.id,
    targetItemId: oldItem.id,
    relationshipType: "supersedes",
    creatorUserId: input.actorUserId,
    explanation: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };

  return { oldItem: updatedOldItem, relationship };
}
