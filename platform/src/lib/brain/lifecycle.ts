import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import { knowledgeItems } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireBrainMutateAccess, requireBrainApproveAccess } from "./authz";
import { InvalidLifecycleTransitionError } from "./errors";
import { getKnowledgeItemForUser, type KnowledgeItem, type KnowledgeItemStatus } from "./knowledge-items";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Brain lifecycle — Modules 8 (Draft Workflow) & 9 (Review/Approval)
 * ============================================================================
 *
 * `MODULE_3_BRAIN_ARCHITECTURE.md` §4's state machine:
 *
 * ```
 * Idea → Draft → Review → Approved → Published
 *                   ↑↓        ↓          ↓
 *                 (back)   Archived ← Archived
 *                             ↓↑
 *                          Retired          (any non-terminal state → Retired)
 * ```
 *
 * `idea` and `purged` are real enum values with no code path in this file —
 * see `schema.ts`'s own comment on `knowledgeItemStatusEnum` for why.
 * Archiving itself is NOT duplicated here — `archiveKnowledgeItem`
 * (Module 1, extended for Modules 8/9's new source states) already lives in
 * `knowledge-items.ts`; this file only adds the transitions that table
 * didn't already have a home for, plus the one Archived → Approved restore
 * path.
 *
 * Every transition here is a pure status change — content never changes as
 * a side effect (Module 2's versioning is a fully separate concern). Each
 * function: (1) resolves the item (gates 1–4, same as every other Brain
 * read), (2) checks the specific capability the transition requires, (3)
 * checks the CURRENT status is a legal source for this transition
 * (`InvalidLifecycleTransitionError` if not — a business-rule violation,
 * not an authorization failure), (4) performs an atomic
 * `UPDATE ... WHERE status = <expected-from>` — the same "the WHERE clause
 * itself is the complete concurrency guard" precedent `archiveRelationship`
 * already established, since there is no other mutable field (like a
 * version number) to protect here. If the atomic update affects zero rows
 * despite step 3 having just confirmed the status was legal, a concurrent
 * transition won the race between the read and the write —
 * `knowledge_lifecycle_conflict` is recorded and the caller is rejected,
 * mirroring `knowledge_version_conflict`'s exact precedent.
 */

/**
 * The single hardest-enforced rule in this file
 * (`MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md` §9's Security Considerations):
 * only a named HUMAN may move an item to Approved, with no exception for
 * any future agent permission tier (`AGENT_FRAMEWORK` §4/§5 — even an
 * Executive-tier agent cannot self-promote). No agent identity concept
 * exists anywhere in this codebase yet (Brain Modules 16/17, deliberately
 * sequenced after Modules 8/9 in the implementation plan's own recommended
 * order) — every actor reaching this function today is necessarily a real
 * human session's user, so this check is currently a structural no-op and
 * deliberately takes no parameter yet. It exists now, as the one
 * designated call site, so that wiring "agents can never approve" in a
 * later module is a single-function change here (taking the actor's id and
 * checking its identity kind) — never an audit of every call site that
 * touches approval.
 */
function assertHumanActor(): void {
  // No-op today — see this function's own doc comment for why.
}

async function recordLifecycleConflict(
  db: Db,
  input: { actorUserId: string; organizationId: string; itemId: string; from: KnowledgeItemStatus; to: KnowledgeItemStatus }
): Promise<void> {
  await recordAuditEvent(db, {
    eventType: "knowledge_lifecycle_conflict",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    targetId: input.itemId,
    metadata: { from: input.from, to: input.to },
  });
}

export interface SubmitForReviewInput {
  organizationId: string;
  knowledgeItemId: string;
  actorUserId: string;
}

/** Draft → Review. Ordinary edit authority (`edit_own_draft`/`edit_any_draft`) — "any human or agent" per §4's authority table. */
export async function submitKnowledgeItemForReview(db: Db, input: SubmitForReviewInput): Promise<KnowledgeItem> {
  const existing = await getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
  await requireBrainMutateAccess(
    db,
    { organizationId: input.organizationId, workspaceId: existing.workspaceId, domain: existing.domain, classification: existing.classification },
    existing.authorUserId,
    input.actorUserId,
    "update"
  );
  if (existing.status !== "draft") {
    throw new InvalidLifecycleTransitionError(existing.status, "review");
  }

  const [updated] = await db
    .update(knowledgeItems)
    .set({ status: "review", updatedAt: new Date() })
    .where(and(eq(knowledgeItems.id, existing.id), eq(knowledgeItems.status, "draft")))
    .returning();

  if (!updated) {
    await recordLifecycleConflict(db, { actorUserId: input.actorUserId, organizationId: input.organizationId, itemId: existing.id, from: "draft", to: "review" });
    throw new InvalidLifecycleTransitionError(existing.status, "review");
  }

  await recordAuditEvent(db, {
    eventType: "knowledge_item_submitted_for_review",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    targetId: existing.id,
    metadata: { domain: existing.domain, workspaceScoped: Boolean(existing.workspaceId) },
  });

  return getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
}

export interface SendBackToDraftInput {
  organizationId: string;
  knowledgeItemId: string;
  actorUserId: string;
}

/** Review → Draft ("sent back"). Same ordinary edit authority as submission — the reviewer need not be the item's author, so this generally requires `edit_any_draft`. */
export async function sendKnowledgeItemBackToDraft(db: Db, input: SendBackToDraftInput): Promise<KnowledgeItem> {
  const existing = await getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
  await requireBrainMutateAccess(
    db,
    { organizationId: input.organizationId, workspaceId: existing.workspaceId, domain: existing.domain, classification: existing.classification },
    existing.authorUserId,
    input.actorUserId,
    "update"
  );
  if (existing.status !== "review") {
    throw new InvalidLifecycleTransitionError(existing.status, "draft");
  }

  const [updated] = await db
    .update(knowledgeItems)
    .set({ status: "draft", updatedAt: new Date() })
    .where(and(eq(knowledgeItems.id, existing.id), eq(knowledgeItems.status, "review")))
    .returning();

  if (!updated) {
    await recordLifecycleConflict(db, { actorUserId: input.actorUserId, organizationId: input.organizationId, itemId: existing.id, from: "review", to: "draft" });
    throw new InvalidLifecycleTransitionError(existing.status, "draft");
  }

  await recordAuditEvent(db, {
    eventType: "knowledge_item_sent_back_to_draft",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    targetId: existing.id,
    metadata: { domain: existing.domain, workspaceScoped: Boolean(existing.workspaceId) },
  });

  return getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
}

export interface ApproveKnowledgeItemInput {
  organizationId: string;
  knowledgeItemId: string;
  actorUserId: string;
}

/** Review → Approved. Requires the `approve` capability at this exact scope, AND a human actor — never substitutable by authorship, workspace role, or any future agent permission tier. */
export async function approveKnowledgeItem(db: Db, input: ApproveKnowledgeItemInput): Promise<KnowledgeItem> {
  assertHumanActor();
  const existing = await getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
  await requireBrainApproveAccess(
    db,
    { organizationId: input.organizationId, workspaceId: existing.workspaceId, domain: existing.domain, classification: existing.classification },
    input.actorUserId
  );
  if (existing.status !== "review") {
    throw new InvalidLifecycleTransitionError(existing.status, "approved");
  }

  const now = new Date();
  const [updated] = await db
    .update(knowledgeItems)
    .set({ status: "approved", approvedByUserId: input.actorUserId, approvedAt: now, updatedAt: now })
    .where(and(eq(knowledgeItems.id, existing.id), eq(knowledgeItems.status, "review")))
    .returning();

  if (!updated) {
    await recordLifecycleConflict(db, { actorUserId: input.actorUserId, organizationId: input.organizationId, itemId: existing.id, from: "review", to: "approved" });
    throw new InvalidLifecycleTransitionError(existing.status, "approved");
  }

  await recordAuditEvent(db, {
    eventType: "knowledge_item_approved",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    targetId: existing.id,
    metadata: { domain: existing.domain, workspaceScoped: Boolean(existing.workspaceId) },
  });

  return getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
}

export interface PublishKnowledgeItemInput {
  organizationId: string;
  knowledgeItemId: string;
  actorUserId: string;
}

/** Approved → Published. Shares the `approve` grant level for now (§4/§15.5's deferred decision on a separate `publish` grant) — an authorization-level policy, not a structural one, revisitable without a schema change. */
export async function publishKnowledgeItem(db: Db, input: PublishKnowledgeItemInput): Promise<KnowledgeItem> {
  const existing = await getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
  await requireBrainApproveAccess(
    db,
    { organizationId: input.organizationId, workspaceId: existing.workspaceId, domain: existing.domain, classification: existing.classification },
    input.actorUserId
  );
  if (existing.status !== "approved") {
    throw new InvalidLifecycleTransitionError(existing.status, "published");
  }

  const now = new Date();
  const [updated] = await db
    .update(knowledgeItems)
    .set({ status: "published", publishedByUserId: input.actorUserId, publishedAt: now, updatedAt: now })
    .where(and(eq(knowledgeItems.id, existing.id), eq(knowledgeItems.status, "approved")))
    .returning();

  if (!updated) {
    await recordLifecycleConflict(db, { actorUserId: input.actorUserId, organizationId: input.organizationId, itemId: existing.id, from: "approved", to: "published" });
    throw new InvalidLifecycleTransitionError(existing.status, "published");
  }

  await recordAuditEvent(db, {
    eventType: "knowledge_item_published",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    targetId: existing.id,
    metadata: { domain: existing.domain, workspaceScoped: Boolean(existing.workspaceId) },
  });

  return getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
}

export interface RestoreKnowledgeItemInput {
  organizationId: string;
  knowledgeItemId: string;
  actorUserId: string;
}

/** Archived → Approved. §4: "a re-approval, not a technicality" — identical authority and human-only requirement as the original approval. Note: distinct from `restoreKnowledgeItemVersion` (Module 2, content rollback) — this restores the ITEM's lifecycle status, never touches version content. */
export async function restoreKnowledgeItem(db: Db, input: RestoreKnowledgeItemInput): Promise<KnowledgeItem> {
  assertHumanActor();
  const existing = await getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
  await requireBrainApproveAccess(
    db,
    { organizationId: input.organizationId, workspaceId: existing.workspaceId, domain: existing.domain, classification: existing.classification },
    input.actorUserId
  );
  if (existing.status !== "archived") {
    throw new InvalidLifecycleTransitionError(existing.status, "approved");
  }

  const now = new Date();
  const [updated] = await db
    .update(knowledgeItems)
    .set({ status: "approved", approvedByUserId: input.actorUserId, approvedAt: now, archivedAt: null, updatedAt: now })
    .where(and(eq(knowledgeItems.id, existing.id), eq(knowledgeItems.status, "archived")))
    .returning();

  if (!updated) {
    await recordLifecycleConflict(db, { actorUserId: input.actorUserId, organizationId: input.organizationId, itemId: existing.id, from: "archived", to: "approved" });
    throw new InvalidLifecycleTransitionError(existing.status, "approved");
  }

  await recordAuditEvent(db, {
    eventType: "knowledge_item_restored",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    targetId: existing.id,
    metadata: { domain: existing.domain, workspaceScoped: Boolean(existing.workspaceId) },
  });

  return getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
}

export interface RetireKnowledgeItemInput {
  organizationId: string;
  knowledgeItemId: string;
  reason: string;
  actorUserId: string;
}

/**
 * Any non-terminal status → Retired. §4: "would actively mislead if
 * resurfaced; preserved for audit only, excluded from normal retrieval and
 * agent context by default" — and, per the authority table, "owning
 * department + explicit reason recorded." No department model exists yet
 * (Module 6, unresolved — see `MODULE_5_BRAIN_MODULE_7_PERMISSIONS.md`'s
 * own identical note), so this reuses the `archive` capability, the
 * closest existing "this actor may close out this item's lifecycle"
 * authority, never substitutable by authorship. Retired items remain
 * fully readable (never deleted) but never reappear in the default listing
 * — identical treatment to archived items, extended to this new status.
 */
export async function retireKnowledgeItem(db: Db, input: RetireKnowledgeItemInput): Promise<KnowledgeItem> {
  const existing = await getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
  await requireBrainMutateAccess(
    db,
    { organizationId: input.organizationId, workspaceId: existing.workspaceId, domain: existing.domain, classification: existing.classification },
    existing.authorUserId,
    input.actorUserId,
    "archive"
  );
  if (existing.status === "retired" || existing.status === "purged") {
    throw new InvalidLifecycleTransitionError(existing.status, "retired");
  }

  const now = new Date();
  const [updated] = await db
    .update(knowledgeItems)
    .set({ status: "retired", retiredByUserId: input.actorUserId, retiredAt: now, retiredReason: input.reason, updatedAt: now })
    .where(and(eq(knowledgeItems.id, existing.id), eq(knowledgeItems.status, existing.status)))
    .returning();

  if (!updated) {
    await recordLifecycleConflict(db, { actorUserId: input.actorUserId, organizationId: input.organizationId, itemId: existing.id, from: existing.status, to: "retired" });
    throw new InvalidLifecycleTransitionError(existing.status, "retired");
  }

  await recordAuditEvent(db, {
    eventType: "knowledge_item_retired",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "knowledge_item",
    targetId: existing.id,
    metadata: { domain: existing.domain, workspaceScoped: Boolean(existing.workspaceId), fromStatus: existing.status },
  });

  return getKnowledgeItemForUser(db, input.organizationId, input.knowledgeItemId, input.actorUserId);
}
