import "server-only";
import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { listingsVow } from "@/db/schema";
import { createVowReaderDbClient } from "@/db/client";
import { requireBonaFideConsumer } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { loadEnv } from "@/lib/env";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface VowData {
  listingId: string;
  soldPrice: number | null;
  soldDate: Date | null;
  priceHistory: Array<{ date: string; price: number; event: string }>;
  domHistorical: number | null;
}

/**
 * The ONLY function in this codebase that may return VOW-tier data
 * (BYOOT_TRANSFORMATION_PLAN.md Section C). No route, component, AI search
 * tool, or other service function queries `listingsVow` directly — this is
 * both an application convention (enforced by code review / this comment)
 * and, independently, a database-level guarantee (RLS + the `vow_reader`
 * role — see schema.ts), so violating the convention still doesn't work.
 *
 * Two gates, in order, both required:
 *
 * 1. `requireBonaFideConsumer(db, sessionToken)` — authenticated session
 *    AND a completed bona-fide-consumer acknowledgment. Throws
 *    (UnauthenticatedError or BonaFideConsumerRequiredError) if either is
 *    missing. This check runs against the NORMAL db client (the `db`
 *    parameter), which has no access to listings_vow at all — so even if
 *    this function had a bug and skipped straight to step 2, the normal
 *    client passed in from the caller still couldn't read the table.
 *
 * 2. Only after step 1 succeeds does this function construct a
 *    vow_reader-credentialed client (`createVowReaderDbClient`) — the one
 *    and only place `DATABASE_URL_VOW_READER` is read. That credential
 *    exists nowhere else in this function's call stack; a caller cannot
 *    obtain it by calling this function with bad arguments, only by the
 *    gate above already having passed.
 *
 * An AI search tool must never receive VOW data for a request it hasn't
 * already resolved tier for — the calling route resolves
 * requireBonaFideConsumer (or catches its failure) BEFORE ever assembling
 * the context/tools handed to a model. If that check fails, this function
 * is simply never called, and no VOW data enters the model's context at
 * all — there is nothing for a prompt-injected or hallucinating model to
 * leak, because it was never given anything to leak.
 *
 * Every denial is audited (`vow_access_denied`), not just every grant —
 * BYOOT_TRANSFORMATION_PLAN.md Section C treats this as the highest-stakes
 * surface in the codebase.
 */
export async function getVowData(db: Db, sessionToken: string | null, listingId: string): Promise<VowData | null> {
  try {
    await requireBonaFideConsumer(db, sessionToken);
  } catch (err) {
    await recordAuditEvent(db, {
      eventType: "vow_access_denied",
      targetType: "listing",
      targetId: listingId,
      metadata: { reason: err instanceof Error ? err.name : "unknown" },
    }).catch(() => {
      // Auditing the denial must never itself become the reason the denial
      // fails to propagate — swallow an audit-write failure, never swallow
      // the original auth error below.
    });
    throw err;
  }

  const env = loadEnv();
  const vowDb = createVowReaderDbClient(env);

  const [row] = await vowDb.select().from(listingsVow).where(eq(listingsVow.listingId, listingId));

  await recordAuditEvent(db, {
    eventType: "vow_access_granted",
    targetType: "listing",
    targetId: listingId,
  }).catch(() => {});

  if (!row) {
    return null;
  }

  return {
    listingId: row.listingId,
    soldPrice: row.soldPrice,
    soldDate: row.soldDate,
    priceHistory: row.priceHistory,
    domHistorical: row.domHistorical,
  };
}
