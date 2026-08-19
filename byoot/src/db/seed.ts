/**
 * Seed CLI — `npm run seed`. Requires DATABASE_URL to point at a real,
 * NON-PRODUCTION Postgres database (see byoot/README.md). Not run as part
 * of this scaffold's build/test pass: no database has been provisioned.
 *
 * Inserts only synthetic data (src/db/seed-data.ts) — never fetches from
 * or references any real TRREB/PropTx endpoint. Safe to run against any
 * environment precisely because of that; still never point it at a
 * database that also serves production, since it deletes existing
 * `source = 'synthetic'` rows before reinserting (idempotent reseeding),
 * and an operator mistake about which database a connection string points
 * to is exactly the kind of error this design should stay cheap to make.
 */
import { eq } from "drizzle-orm";
import { listings, listingsVow } from "./schema";
import { createDbClient } from "./client";
import { loadEnv } from "@/lib/env";
import { generateSyntheticListings, generateSyntheticVowRecord } from "./seed-data";

async function main() {
  const env = loadEnv();
  const db = createDbClient(env);

  console.log("[seed] deleting existing synthetic rows...");
  const existingSynthetic = await db.select({ id: listings.id }).from(listings).where(eq(listings.source, "synthetic"));
  for (const row of existingSynthetic) {
    await db.delete(listingsVow).where(eq(listingsVow.listingId, row.id));
  }
  await db.delete(listings).where(eq(listings.source, "synthetic"));

  console.log("[seed] generating synthetic listings...");
  const synthetic = generateSyntheticListings(300);

  console.log("[seed] inserting listings...");
  const inserted = await db.insert(listings).values(synthetic).returning({ id: listings.id, status: listings.status });

  console.log("[seed] inserting VOW records for sold listings...");
  const soldRows = inserted.filter((r) => r.status === "Sold");
  let vowSeed = 1;
  for (const row of soldRows) {
    const source = synthetic.find((_s, idx) => inserted[idx]?.id === row.id);
    if (!source) continue;
    const vow = generateSyntheticVowRecord(source, vowSeed++);
    await db.insert(listingsVow).values({ listingId: row.id, ...vow });
  }

  console.log(`[seed] done — ${inserted.length} listings, ${soldRows.length} with VOW records.`);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
