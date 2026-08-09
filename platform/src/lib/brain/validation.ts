import { z } from "zod";

/** The eight fixed Brain domains (MODULE_3_BRAIN_ARCHITECTURE.md §3) — a real, closed set for Module 1, matching the `knowledge_domain` Postgres enum exactly. */
export const knowledgeDomainSchema = z.enum([
  "identity",
  "offerings",
  "market",
  "execution",
  "growth",
  "governance",
  "capability",
  "wisdom",
]);

/**
 * The smallest approved useful classification set for Module 1, drawn
 * directly from this task's own worked examples. Deliberately an
 * application-level allow-list, not a database enum or CHECK constraint —
 * MODULE_3_BRAIN_ARCHITECTURE.md §3 explicitly describes `knowledgeType`
 * (what this codebase names `classification`, see schema.ts's own note) as
 * "a separate, extensible classification," meant to grow without a schema
 * migration. Adding a new value later is a one-line change to this array.
 */
export const KNOWLEDGE_CLASSIFICATIONS = [
  "fact",
  "instruction",
  "policy",
  "procedure",
  "decision",
  "observation",
  "note",
  "summary",
  "template",
  "prompt",
  "reference",
] as const;

export const knowledgeClassificationSchema = z.enum(KNOWLEDGE_CLASSIFICATIONS);

/** Matches `nameSchema`'s own max(200) convention (src/lib/http/validation.ts) for consistency across the platform. */
export const knowledgeTitleSchema = z.string().trim().min(1).max(200);

/**
 * ~20,000 characters (~20KB) — a deliberate, documented Module 1 limit for
 * "the simplest durable format," per this task's own requirement to set
 * explicit, reasonable limits. Large enough for a real policy, SOP, or
 * decision write-up; small enough to keep row size and query performance
 * predictable before any chunking/attachment strategy (explicitly deferred
 * to later Brain modules) exists.
 */
export const knowledgeContentSchema = z.string().trim().min(1).max(20_000);

/**
 * Brain Modules 8/9 — the full lifecycle status set, matching the
 * `knowledge_item_status` Postgres enum exactly (extended from Module 1's
 * original two-value `draft`/`archived` set). `idea` and `purged` round-trip
 * on read but no request body schema ever accepts them as a client-requested
 * target status — every forward transition has its own dedicated, narrow
 * endpoint instead of a generic "set status to X" operation, precisely so
 * illegal transitions (Draft straight to Approved, anyone to Purged) are
 * structurally unrepresentable as a request, not just rejected after the fact.
 */
export const KNOWLEDGE_ITEM_STATUSES = ["idea", "draft", "review", "approved", "published", "archived", "retired", "purged"] as const;

export const knowledgeItemStatusSchema = z.enum(KNOWLEDGE_ITEM_STATUSES);

export const knowledgeListLimitSchema = z.coerce.number().int().min(1).max(100).default(20);

/** The optimistic-concurrency token for Module 2 writes — the version_number the client last saw. Always required on update/restore; never inferred from `updated_at`. */
export const versionNumberSchema = z.coerce.number().int().min(1);

/**
 * Mandatory on restore (records *why* a historical version was brought
 * back), optional on a plain content update. Bounded like the other free-
 * text fields here so it can safely appear in audit metadata (Module 2's
 * "change reason summary, bounded, non-sensitive" requirement).
 */
export const changeReasonSchema = z.string().trim().min(1).max(500);

/**
 * The fixed nine-type relationship taxonomy (MODULE_3_BRAIN_ARCHITECTURE.md
 * §7), matching the `relationship_type` Postgres enum exactly (schema.ts's
 * own note explains why this is a real enum, not an extensible allow-list
 * like `classification`).
 */
export const RELATIONSHIP_TYPES = [
  "supports",
  "contradicts",
  "depends_on",
  "supersedes",
  "related_to",
  "created_from",
  "references",
  "used_by",
  "required_for",
] as const;

export const relationshipTypeSchema = z.enum(RELATIONSHIP_TYPES);

/** Optional on every relationship — explaining *why* two items relate is often self-evident (e.g. a plain `references` edge). Bounded like every other free-text field in this module. */
export const relationshipExplanationSchema = z.string().trim().min(1).max(1000);

export const relationshipDirectionSchema = z.enum(["outgoing", "incoming", "both"]);

export const relationshipStatusSchema = z.enum(["active", "archived"]);

/** The six-tier trust taxonomy (MODULE_3_BRAIN_ARCHITECTURE.md §5), matching the `trust_tier` Postgres enum exactly. Shared by a version's own trust assessment and a single piece of evidence's own, independently reassessable trust. */
export const TRUST_TIERS = ["verified", "approved", "observed", "hypothesis", "unknown", "deprecated"] as const;

export const trustTierSchema = z.enum(TRUST_TIERS);

/** The nine-tier Source Hierarchy (marketing/LYNQ_BRAIN.md §7), in rank order, matching the `source_type` Postgres enum exactly. */
export const SOURCE_TYPES = [
  "founder_decision",
  "official_documentation",
  "client_approved",
  "internal_documentation",
  "meeting_notes",
  "ai_generated_draft",
  "external_research",
  "open_internet_search",
  "unverified",
] as const;

export const sourceTypeSchema = z.enum(SOURCE_TYPES);

/** Optional — which named human, registered agent, import job, or external system specifically. Bounded like every other free-text field in this module. */
export const sourceDetailSchema = z.string().trim().min(1).max(500);

/** The five storable Evidence classes (MODULE_3_BRAIN_GRAPH_AND_REASONING.md §3) — deliberately excludes "Missing," a reasoning-time query result, never a stored row. Matches the `evidence_class` Postgres enum exactly. */
export const EVIDENCE_CLASSES = ["primary", "supporting", "weak", "historical", "conflicting"] as const;

export const evidenceClassSchema = z.enum(EVIDENCE_CLASSES);

/** What the evidence actually says/shows — a real citation body, not a title. */
export const evidenceDescriptionSchema = z.string().trim().min(1).max(2_000);

/** A URL, document id, or other external pointer justifying a piece of evidence. */
export const externalReferenceSchema = z.string().trim().min(1).max(500);

/**
 * The optimistic-concurrency token for `knowledge_item_trust` writes —
 * Module 1's plain-integer `revision` pattern, reused here (not Module 2's
 * version-number-via-pointer mechanism, since trust reassessment
 * deliberately does not create content history). `0` is the explicit
 * sentinel for "I believe no assessment exists yet for this version" — the
 * first-ever attach for a version passes `0`; every later reassessment
 * passes whatever revision it last observed.
 */
export const trustRevisionSchema = z.coerce.number().int().min(0);

/**
 * The Brain-domain capability set (MODULE_3_BRAIN_ARCHITECTURE.md §10's
 * DomainGrant `accessLevel`, plus this module's own non-contradictory
 * refinements), matching the `brain_capability` Postgres enum exactly. See
 * `schema.ts`'s own note on `brainCapabilityEnum` for the full reasoning
 * behind each value, including which five are the architecture's exact
 * terminology and which three are additive refinements.
 */
export const BRAIN_CAPABILITIES = [
  "read",
  "draft_write",
  "edit_own_draft",
  "edit_any_draft",
  "approve",
  "archive",
  "purge",
  "manage_permissions",
] as const;

export const brainCapabilitySchema = z.enum(BRAIN_CAPABILITIES);

/**
 * The optimistic-concurrency token for `brain_permission_grants` writes —
 * the identical `trustRevisionSchema` pattern (Module 1's plain-integer
 * `revision`), reused here for the same reason: a grant has no content
 * history to protect via Module 2's version-number mechanism, only a
 * single mutable `reason` field and a one-way revoke transition.
 */
export const grantRevisionSchema = z.coerce.number().int().min(0);

/** Optional, bounded context for why a grant exists or was revoked — never knowledge content, never a secret. */
export const grantReasonSchema = z.string().trim().min(1).max(500);

/** Mandatory, bounded explanation for retiring an item — §4's "Any → Retired: owning department + explicit reason recorded." Matches `changeReasonSchema`'s exact bounds for consistency. */
export const retireReasonSchema = z.string().trim().min(1).max(500);
