/**
 * TRREB/PropTx (AMPRE RESO Web API) sync — STUB. No live calls. Sketches
 * the structure BYOOT_TRANSFORMATION_PLAN.md Section A committed to,
 * informed directly by what BYOOT_AUDIT.md Section B found in the client's
 * own sync implementation (`trebb-sync`, `trebb-reconcile` — the git log
 * for those two functions alone shows ~10 commits fixing chunk sizing,
 * statement timeouts, resumability, and write idempotency). The point of
 * writing the structure now, before any real implementation, is to not
 * relearn those lessons from scratch.
 *
 * Do not implement the real fetch/write logic against this stub without
 * first re-reading BYOOT_AUDIT.md Section B and BYOOT_DATA_CONSTRAINTS.md —
 * this is the highest-compliance-stakes code path in the entire codebase.
 *
 * TREBB_API_TOKEN / TREBB_VOW_TOKEN / TREBB_BASE_URL are read by
 * src/lib/env.ts but never used here yet — see byoot/.env.example.
 */

export interface SyncCursor {
  /** Last successfully processed ModificationTimestamp, RESO-standard field. Persisted, not in-memory — see the design note below. */
  lastModificationTimestamp: string | null;
  /** Opaque pagination token/offset for the current in-progress page, if a run was interrupted mid-page. */
  pageCursor: string | null;
  updatedAt: Date;
}

export interface SyncRunResult {
  mode: "incremental" | "reconcile";
  listingsUpserted: number;
  listingsFailed: number;
  durationMs: number;
  cursorAtCompletion: SyncCursor;
}

/**
 * Incremental sync — the frequent, cheap pass. Design notes (not yet
 * implemented):
 *
 * - Pages through AMPRE's RESO Web API, `$orderby=ModificationTimestamp`,
 *   `$filter=ModificationTimestamp gt {cursor.lastModificationTimestamp}`.
 * - Maps each row into `listings` (see schema.ts) — property type/style/
 *   status normalization should port the client's existing lookup tables
 *   (PROPERTY_TYPE_MAP, STYLE_MAP, STATUS_MAP — BYOOT_AUDIT.md Section B),
 *   not reinvent them.
 * - `listOfficeName` is NOT NULL on `listings` (schema.ts) — a row missing
 *   it should fail that row's upsert loudly (increment listingsFailed,
 *   log which mlsNumber), never insert with a placeholder value.
 * - Respects `InternetEntireListingDisplayYN`/`InternetAddressDisplayYN`
 *   exactly as the client's current sync does.
 * - Must complete well inside whatever the runtime's wall-clock limit is
 *   (the client's own TIMEOUT_MS ≈ 145s under Supabase Edge Functions —
 *   Vercel's limits differ and should be re-checked, not assumed equal).
 *   On approaching the limit: stop, persist `pageCursor`, return a partial
 *   SyncRunResult — never let the process be killed mid-write.
 * - Sold/price-history data goes to `listings_vow` via a SEPARATE
 *   authenticated write path using TREBB_VOW_TOKEN — this stub
 *   deliberately does not sketch that path yet; it needs its own review
 *   given VOW's stricter access rules (BYOOT_DATA_CONSTRAINTS.md Section 3)
 *   apply to writes too, not just reads.
 */
export async function runIncrementalSync(_cursor: SyncCursor): Promise<SyncRunResult> {
  throw new Error(
    "runIncrementalSync is a stub — no live TRREB/PropTx calls exist yet. " +
      "See the design notes in this file and BYOOT_TRANSFORMATION_PLAN.md Section A."
  );
}

/**
 * Full reconcile — the less-frequent, expensive pass that catches listings
 * the incremental sync silently missed. Design notes (not yet
 * implemented):
 *
 * - A resumable cursor (`pageCursor`), persisted to the database between
 *   invocations — not an in-memory position, which a timeout would lose.
 *   This directly answers the failure mode the client's own
 *   `trebb-reconcile` git history shows being discovered the hard way
 *   (chunk-per-RPC-call writes, statement-timeout increases, a dedicated
 *   "resumable pass + SQL-side diff + stale detector" commit).
 * - Sweeps `listings` for rows whose `last_seen_active_at` (or equivalent —
 *   not yet added to schema.ts; add it when this is implemented) has aged
 *   past a threshold without appearing in a recent incremental pass, and
 *   marks them off-market — never delete a row outright, per the same
 *   reasoning the client's own code already applied.
 * - Chunked writes, bounded batch size, explicit statement timeout — sized
 *   empirically once a real database exists, not guessed in advance.
 */
export async function runFullReconcile(_cursor: SyncCursor): Promise<SyncRunResult> {
  throw new Error(
    "runFullReconcile is a stub — no live TRREB/PropTx calls exist yet. " +
      "See the design notes in this file and BYOOT_TRANSFORMATION_PLAN.md Section A."
  );
}
