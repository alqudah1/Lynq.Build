import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { listings, listingsVow, users } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { getVowData } from "./vow-gate";
import { loadEnv } from "@/lib/env";

/**
 * THE genuinely adversarial test, per the task that created this scaffold:
 * proves an unauthenticated (and, separately, a merely-authenticated-but-
 * not-acknowledged) context cannot read listings_vow BY ANY PATH — not just
 * through getVowData(), but by connecting with the app's own normal
 * DATABASE_URL role and querying the table directly, completely bypassing
 * the service function. If this test is ever green using the normal role's
 * connection string, the RLS design has failed regardless of what
 * getVowData() itself does.
 *
 * Requires a real, non-production Postgres database with byoot/'s
 * migrations AND the `vow_reader` role/grant applied — see
 * byoot/README.md's manual database setup steps. Not runnable in this
 * scaffold: per the task that created it, no database was to be
 * provisioned. Run via `npm run test:integration` once one exists,
 * pointed at a database that is NOT the eventual production database
 * either (see byoot/README.md's synthetic-data-only rule).
 */

const env = loadEnv();
const normalSql = neon(env.DATABASE_URL);
const normalDb = drizzle(normalSql, { schema: { listings, listingsVow, users } });

let seededListingId: string;
let seededUserId: string;
let ackedUserId: string;

beforeAll(async () => {
  const [listing] = await normalDb
    .insert(listings)
    .values({
      mlsNumber: `TEST-${randomUUID()}`,
      title: "Integration test fixture — not a real listing",
      address: "1 Test Street",
      price: 500_000,
      listOfficeName: "Test Brokerage Inc., Brokerage",
      source: "synthetic",
    })
    .returning({ id: listings.id });
  seededListingId = listing.id;

  await normalDb.insert(listingsVow).values({
    listingId: seededListingId,
    soldPrice: 480_000,
    soldDate: new Date("2026-01-15"),
    domHistorical: 21,
  });

  const [noAckUser] = await normalDb
    .insert(users)
    .values({ email: `no-ack-${randomUUID()}@example.invalid` })
    .returning({ id: users.id });
  seededUserId = noAckUser.id;

  const [ackedUser] = await normalDb
    .insert(users)
    .values({ email: `acked-${randomUUID()}@example.invalid`, bonaFideConsumerAckAt: new Date() })
    .returning({ id: users.id });
  ackedUserId = ackedUser.id;
});

afterAll(async () => {
  await normalDb.delete(listingsVow).where(eq(listingsVow.listingId, seededListingId));
  await normalDb.delete(listings).where(eq(listings.id, seededListingId));
  await normalDb.delete(users).where(eq(users.id, seededUserId));
  await normalDb.delete(users).where(eq(users.id, ackedUserId));
});

describe("listings_vow — database-level enforcement (RLS + role separation)", () => {
  it("cannot be read by the normal application role via a direct, raw query — completely bypassing getVowData()", async () => {
    // This is the adversarial case: no call to getVowData() at all, no
    // session, no auth check attempted — just the app's own everyday
    // connection string querying the table directly, the way a bug
    // anywhere else in the codebase might.
    await expect(normalDb.select().from(listingsVow).where(eq(listingsVow.listingId, seededListingId))).rejects.toThrow(
      /permission denied|row-level security/i
    );
  });

  it("CAN be read via the vow_reader role directly (positive control — proves the policy isn't simply broken/blocking everyone)", async () => {
    const vowReaderUrl = env.DATABASE_URL_VOW_READER;
    if (!vowReaderUrl) throw new Error("DATABASE_URL_VOW_READER not set — see byoot/README.md");
    const vowSql = neon(vowReaderUrl);
    const vowDb = drizzle(vowSql, { schema: { listingsVow } });

    const rows = await vowDb.select().from(listingsVow).where(eq(listingsVow.listingId, seededListingId));
    expect(rows).toHaveLength(1);
    expect(rows[0].soldPrice).toBe(480_000);
  });

  it("getVowData() rejects an unauthenticated caller and never leaks a row", async () => {
    await expect(getVowData(normalDb, null, seededListingId)).rejects.toThrow();
  });

  it("getVowData() rejects an authenticated caller who has not acknowledged bona fide consumer status", async () => {
    const { rawToken } = await createSession(normalDb, { userId: seededUserId });
    await expect(getVowData(normalDb, rawToken, seededListingId)).rejects.toThrow();
  });

  it("getVowData() returns real data for an authenticated, acknowledged caller", async () => {
    const { rawToken } = await createSession(normalDb, { userId: ackedUserId });
    const result = await getVowData(normalDb, rawToken, seededListingId);
    expect(result?.soldPrice).toBe(480_000);
  });
});
