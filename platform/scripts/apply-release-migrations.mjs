import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const enabled = process.env.LYNQ_APPLY_MIGRATIONS_ON_BUILD === "1";

if (!enabled) {
  console.log("Release migrations: skipped (explicit release flag is off).");
  process.exit(0);
}

if (process.env.VERCEL_ENV !== "production") {
  throw new Error("Release migrations may run only in a Vercel production build.");
}

const databaseUrl = process.env.DATABASE_URL_UNPOOLED;
if (!databaseUrl || databaseUrl === "[SENSITIVE]") {
  throw new Error("DATABASE_URL_UNPOOLED is required for production release migrations.");
}

console.log("Release migrations: applying pending production migrations.");
const client = neon(databaseUrl);
const database = drizzle(client);
await migrate(database, { migrationsFolder: "./drizzle" });
console.log("Release migrations: complete.");
