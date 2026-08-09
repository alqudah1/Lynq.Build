import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createKnowledgeItem, type KnowledgeDomain, type KnowledgeItem } from "./knowledge-items";
import { createRelationship, type KnowledgeRelationship, type RelationshipType } from "./relationships";
import { ObservationRequiresSourceError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

/**
 * ============================================================================
 * Brain observations — Module 13 (Observation Generation)
 * ============================================================================
 *
 * `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §4's worked example: three
 * meeting-derived Facts becoming one Observation. Observation is a
 * `classification` value on the existing `knowledge_items`/
 * `knowledge_item_versions` tables (Module 3 §1's explicit design decision
 * against a table per content shape) — this file is a thin wrapper over
 * Module 1's `createKnowledgeItem` and Module 3's `createRelationship`,
 * adding the one rule specific to this classification: it must cite at
 * least one source. There is no separate `POST .../observations` route —
 * `.../knowledge` (Module 1) already accepts `classification: "observation"`
 * directly; this function exists for the one call site that ALSO needs the
 * source-citation rule enforced atomically with creation (a future
 * dashboard/agent action would call this, not the bare item-creation path,
 * whenever it specifically means to create an Observation).
 */

export interface CreateObservationInput {
  organizationId: string;
  workspaceId?: string | null;
  domain: KnowledgeDomain;
  title: string;
  content: string;
  /** At least one required — an Observation with zero cited sources is rejected before any row is written. */
  sourceItemIds: string[];
  /** `created_from` (default) — "derived or distilled from"; `supports` — a weaker, non-derivational citation. Applied identically to every source in this call. */
  relationshipType?: Extract<RelationshipType, "created_from" | "supports">;
  actorUserId: string;
}

export interface CreateObservationResult {
  item: KnowledgeItem;
  relationships: KnowledgeRelationship[];
}

/**
 * Creates an Observation-classified item, then one outgoing relationship
 * (`created_from` by default) from the new item to each cited source —
 * `MODULE_3_BRAIN_ARCHITECTURE.md` §7's own direction convention ("A
 * created_from B" = "A was derived from B"). Authorization for both the
 * item creation and each relationship reuses Module 1/3's existing
 * `draft_write`/read-on-both-endpoints checks unchanged — no new capability
 * is introduced for Observations specifically.
 *
 * Not wrapped in a single DB transaction: `createKnowledgeItem` itself is
 * already atomic (Module 1's own `rawSql.transaction`), and each
 * relationship is created independently, matching how a human authoring an
 * Observation by hand through separate API calls would naturally proceed —
 * if a later relationship in the list fails (e.g. a cited source the actor
 * cannot read), the Observation item itself and any relationships already
 * created remain (a partial Observation with fewer citations than
 * intended, not silently rolled back) — the caller sees exactly which
 * relationship failed and can retry just that citation.
 */
export async function createObservation(db: Db, rawSql: RawSql, input: CreateObservationInput): Promise<CreateObservationResult> {
  if (input.sourceItemIds.length === 0) {
    throw new ObservationRequiresSourceError();
  }

  const item = await createKnowledgeItem(db, rawSql, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    domain: input.domain,
    classification: "observation",
    title: input.title,
    content: input.content,
    actorUserId: input.actorUserId,
  });

  const relationshipType = input.relationshipType ?? "created_from";
  const relationships: KnowledgeRelationship[] = [];
  for (const sourceItemId of input.sourceItemIds) {
    const relationship = await createRelationship(db, {
      organizationId: input.organizationId,
      sourceItemId: item.id,
      targetItemId: sourceItemId,
      relationshipType,
      actorUserId: input.actorUserId,
    });
    relationships.push(relationship);
  }

  return { item, relationships };
}
