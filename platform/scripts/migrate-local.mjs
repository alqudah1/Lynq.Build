// Applies ./drizzle migrations to the database in DATABASE_URL_UNPOOLED.
// Intended for local development; honours NEON_HTTP_FETCH_ENDPOINT so a
// local Postgres behind a Neon-protocol shim works. Refuses to run against
// a Vercel production environment — production uses apply-release-migrations.mjs.
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

if (process.env.VERCEL_ENV === "production") {
  throw new Error("migrate-local refuses to run in a Vercel production environment.");
}
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url || url === "[SENSITIVE]") throw new Error("DATABASE_URL_UNPOOLED is required.");
if (process.env.NEON_HTTP_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.NEON_HTTP_FETCH_ENDPOINT;
const db = drizzle(neon(url));
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Local migrations: complete.");
