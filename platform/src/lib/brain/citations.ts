import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { getTrustAssessmentForVersion, type TrustTier, type SourceType } from "./trust";
import { listEvidenceForVersion, type Evidence } from "./evidence";
import { getSourceDefinition } from "./source-hierarchy";
import type { RetrieveRelevantKnowledgeResult } from "./retrieval";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Brain citations — Module 12 (Citation Generation)
 * ============================================================================
 *
 * `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §11: mechanically builds the
 * `{node, version, evidence, source, assumptions}` structure from a REAL
 * retrieval trace — never reconstructed from finished text after the fact.
 *
 * **Anti-fabrication is enforced by the function signature itself, not a
 * runtime check that could be bypassed** (§9): `buildCitations` takes a
 * `RetrieveRelevantKnowledgeResult` — Module 11's own real output — as its
 * only source of which items to cite. There is no `itemIds: string[]`
 * parameter anywhere in this file; a caller cannot ask for a citation on a
 * node retrieval never actually returned, because there is no code path
 * that accepts one.
 *
 * **Assumptions are never folded into evidence** (§11's explicit rule): a
 * separate, caller-supplied list, passed through unchanged. The reasoning
 * layer that consumes retrieval (a future module) is the one thing that
 * knows what it assumed; this module only shapes and passes that list
 * along, next to — never merged with — real evidence.
 *
 * **Gaps are explicit, never silent omissions** (§9's "an explicit Unknown
 * is itself a valid, first-class answer" principle, restated for citations
 * by §11's own diagram, "Gaps ... never silently omitted"): a node with no
 * recorded trust assessment or no recorded source still gets a citation
 * entry (trust tier `"unknown"`, source `null`) AND a corresponding `gaps`
 * entry — it is never quietly dropped from the citation list.
 */

export interface CitationEvidenceEntry {
  id: string;
  evidenceClass: Evidence["evidenceClass"];
  description: string;
  externalReference: string | null;
  evidenceTrustTier: TrustTier;
}

export interface CitationSourceEntry {
  sourceType: SourceType;
  sourceDetail: string | null;
  rank: number;
}

export interface Citation {
  itemId: string;
  versionNumber: number;
  title: string;
  trustTier: TrustTier;
  evidence: CitationEvidenceEntry[];
  source: CitationSourceEntry | null;
  retrievalSource: "keyword" | "graph";
}

export interface Assumption {
  /** Free text describing what the reasoning layer filled in that the Brain did not explicitly state. */
  description: string;
}

export type CitationGapReason = "unknown_trust" | "no_source_recorded";

export interface CitationGap {
  itemId: string;
  reason: CitationGapReason;
}

export interface BuildCitationsResult {
  citations: Citation[];
  assumptions: Assumption[];
  gaps: CitationGap[];
}

export interface BuildCitationsInput {
  organizationId: string;
  trace: RetrieveRelevantKnowledgeResult;
  /** Passed through unchanged — see this file's own doc comment on why assumptions are never derived here. */
  assumptions?: Assumption[];
  actorUserId: string;
}

/**
 * Builds one citation entry per node in `trace.nodes` — never more, never
 * fewer; the returned `citations` array's item-id set is always exactly
 * `trace.nodes`' item-id set (proven directly by a test). Each entry's
 * trust/evidence/source come from `getTrustAssessmentForVersion`/
 * `listEvidenceForVersion` for that item's CURRENT version — already
 * tenant/permission-checked internally, exactly like every other Brain
 * read; retrieval already filtered `trace.nodes` to visible items, so this
 * is a second, cheap confirmation, not a new authorization surface.
 */
export async function buildCitations(db: Db, input: BuildCitationsInput): Promise<BuildCitationsResult> {
  const citations: Citation[] = [];
  const gaps: CitationGap[] = [];

  for (const node of input.trace.nodes) {
    const [trustView, evidenceResult] = await Promise.all([
      getTrustAssessmentForVersion(db, input.organizationId, node.item.id, node.item.currentVersionNumber, input.actorUserId),
      listEvidenceForVersion(db, { organizationId: input.organizationId, knowledgeItemId: node.item.id, versionNumber: node.item.currentVersionNumber, actorUserId: input.actorUserId }),
    ]);

    if (trustView.trust.trustTier === "unknown") {
      gaps.push({ itemId: node.item.id, reason: "unknown_trust" });
    }
    if (!trustView.source) {
      gaps.push({ itemId: node.item.id, reason: "no_source_recorded" });
    }

    citations.push({
      itemId: node.item.id,
      versionNumber: node.item.currentVersionNumber,
      title: node.item.title,
      trustTier: trustView.trust.trustTier,
      evidence: evidenceResult.evidence.map((e) => ({
        id: e.id,
        evidenceClass: e.evidenceClass,
        description: e.description,
        externalReference: e.externalReference,
        evidenceTrustTier: e.evidenceTrustTier,
      })),
      source: trustView.source
        ? { sourceType: trustView.source.sourceType, sourceDetail: trustView.source.sourceDetail, rank: getSourceDefinition(trustView.source.sourceType).rank }
        : null,
      retrievalSource: node.source,
    });
  }

  return { citations, assumptions: input.assumptions ?? [], gaps };
}
