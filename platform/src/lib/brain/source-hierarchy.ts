import "server-only";
import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { knowledgeItemSources } from "@/db/schema";
import { resolveKnowledgeItemVersionForUser } from "./knowledge-item-versions";
import type { SourceType } from "./trust";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * The nine-tier Source Hierarchy (`marketing/LYNQ_BRAIN.md` §7), preserved
 * exactly as approved — labels and descriptions quoted directly from that
 * document, not paraphrased or invented. `rank` is a strict total order
 * (1 = highest authority, 9 = lowest); every one of the nine `source_type`
 * enum values (Brain Module 4) appears exactly once, so no two DIFFERENT
 * source types can ever compare as equal — the only way `compareSourceRanks`
 * returns `"equal"` is comparing a type to itself. This is a deliberate
 * consequence of the design, not an oversight: `MODULE_3_BRAIN_ARCHITECTURE.md`
 * §5's "same-tier conflict... never resolved by an agent picking one" rule
 * is about two items sharing the same TRUST tier (a genuinely different,
 * six-value axis — Brain Module 4), not about Source rank, which has no
 * ties between distinct types to begin with.
 *
 * A plain, static, in-code constant — deliberately NOT a database table.
 * The hierarchy is fixed company-wide policy (LYNQ_BRAIN §7 presents it as
 * a settled ranking, never as something organizations configure), has zero
 * per-tenant variation, and would never be written to after initial
 * definition — a lookup table holding nine rows that can never change
 * offers no real benefit over this constant and is exactly the kind of
 * low-value, speculative table this module was told to avoid. The existing
 * `source_type` Postgres enum (Module 4) already IS the database-level
 * representation of the valid set; this constant adds the rank/label/
 * description dimension on top of it, in code.
 */
export interface SourceHierarchyEntry {
  sourceType: SourceType;
  rank: number;
  label: string;
  description: string;
}

export const SOURCE_HIERARCHY: readonly SourceHierarchyEntry[] = [
  {
    sourceType: "founder_decision",
    rank: 1,
    label: "Founder decisions",
    description: "The highest authority; can only be overridden by a newer founder decision.",
  },
  {
    sourceType: "official_documentation",
    rank: 2,
    label: "Official company documentation",
    description: "The codified version of founder intent, authoritative until formally revised.",
  },
  {
    sourceType: "client_approved",
    rank: 3,
    label: "Client-approved information",
    description: "Anything a client has explicitly confirmed about themselves or their project; nobody outranks the client on facts about the client.",
  },
  {
    sourceType: "internal_documentation",
    rank: 4,
    label: "Internal documentation and SOPs",
    description: "The company's own working standards, authoritative for how things are done absent a founder decision saying otherwise.",
  },
  {
    sourceType: "meeting_notes",
    rank: 5,
    label: "Meeting notes and informal records",
    description: "Useful context, not authoritative on their own until distilled into a Decision.",
  },
  {
    sourceType: "ai_generated_draft",
    rank: 6,
    label: "AI-generated drafts",
    description: "Informative, never authoritative until reviewed and promoted.",
  },
  {
    sourceType: "external_research",
    rank: 7,
    label: "External research",
    description: "Useful for context and benchmarking, always understood as being about the outside world, not a statement about the company.",
  },
  {
    sourceType: "open_internet_search",
    rank: 8,
    label: "Open internet search",
    description: "The least trusted source by default; useful for surfacing possibilities, never sufficient on its own to establish something as company knowledge.",
  },
  {
    sourceType: "unverified",
    rank: 9,
    label: "Unverified information",
    description: "Informally heard, unconfirmed — treated as a lead to check, never as an answer.",
  },
] as const;

const HIERARCHY_BY_TYPE: ReadonlyMap<SourceType, SourceHierarchyEntry> = new Map(SOURCE_HIERARCHY.map((entry) => [entry.sourceType, entry]));

/** Lists the full nine-tier hierarchy, in rank order. Read-only, immutable data — no authorization beyond authentication is required (see this module's own doc in MODULE_5_BRAIN_MODULE_5_SOURCE_HIERARCHY.md for why). */
export function listSourceHierarchy(): readonly SourceHierarchyEntry[] {
  return SOURCE_HIERARCHY;
}

/** Retrieves one source type's hierarchy definition (rank, label, description). */
export function getSourceDefinition(sourceType: SourceType): SourceHierarchyEntry {
  const entry = HIERARCHY_BY_TYPE.get(sourceType);
  if (!entry) {
    // Structurally unreachable given `SourceType`'s own TypeScript union and
    // the `source_type` Postgres enum both being exhaustively covered by
    // `SOURCE_HIERARCHY` (proven by a unit test) — this is defense against a
    // future enum value being added without a matching hierarchy entry,
    // never an expected runtime path.
    throw new Error(`No Source Hierarchy definition exists for source type "${sourceType}"`);
  }
  return entry;
}

export type RankComparison = "higher" | "lower" | "equal";

/**
 * Compares two source types' rank — `"higher"` if `a` outranks `b`,
 * `"lower"` if `b` outranks `a`, `"equal"` only when `a === b` (see this
 * file's own top comment for why distinct types never tie). A pure,
 * deterministic function — no database access, no tenant context, nothing
 * to authorize.
 */
export function compareSourceRanks(a: SourceType, b: SourceType): RankComparison {
  const rankA = getSourceDefinition(a).rank;
  const rankB = getSourceDefinition(b).rank;
  if (rankA < rankB) return "higher";
  if (rankA > rankB) return "lower";
  return "equal";
}

export interface SourceOrderingResult {
  a: SourceHierarchyEntry;
  b: SourceHierarchyEntry;
  comparison: RankComparison;
  /** The higher-ranked of the two — always resolvable, since distinct source types never tie. This is a plain, deterministic lookup, never a judgment call — no conflict is being "resolved" here in the reasoning sense (Module 3.1's territory, explicitly out of scope). */
  winner: SourceHierarchyEntry;
}

/** Resolves deterministic ordering between two source types — which one is the more authoritative, per the fixed hierarchy alone. Does not consider Trust tier, Evidence, recency, or anything situational; that composition is Module 3.1's reasoning layer, not this one. */
export function resolveSourceOrdering(a: SourceType, b: SourceType): SourceOrderingResult {
  const entryA = getSourceDefinition(a);
  const entryB = getSourceDefinition(b);
  const comparison = compareSourceRanks(a, b);
  const winner = comparison === "lower" ? entryB : entryA;
  return { a: entryA, b: entryB, comparison, winner };
}

export interface SourceAssignmentValidation {
  isValid: boolean;
  sourceType: SourceType | null;
  rank: number | null;
  reason?: string;
}

/**
 * Validates the Source assignment already recorded for one version (Brain
 * Module 4's `knowledge_item_sources`), confirming it maps to a genuine
 * hierarchy entry. Tenant-scoped — the only operation in this module that
 * needs to be, since it resolves a real, organization-owned version rather
 * than operating on the static hierarchy alone. Reuses
 * `resolveKnowledgeItemVersionForUser` unmodified, so it inherits the
 * identical cross-tenant/workspace-membership gate every other Brain read
 * uses; a cross-tenant or invisible version is a 404 here too.
 */
export async function validateSourceAssignment(
  db: Db,
  organizationId: string,
  knowledgeItemId: string,
  versionNumber: number,
  actorUserId: string
): Promise<SourceAssignmentValidation> {
  const { version } = await resolveKnowledgeItemVersionForUser(db, organizationId, knowledgeItemId, versionNumber, actorUserId);

  const [sourceRow] = await db.select().from(knowledgeItemSources).where(eq(knowledgeItemSources.knowledgeItemVersionId, version.id));

  if (!sourceRow) {
    return { isValid: false, sourceType: null, rank: null, reason: "no source has been recorded for this version yet" };
  }

  const definition = getSourceDefinition(sourceRow.sourceType);
  return { isValid: true, sourceType: sourceRow.sourceType, rank: definition.rank };
}
