import { defineConfig } from "drizzle-kit";

// This file is only read by the drizzle-kit CLI (generate/migrate/check),
// never imported by the running application, so reading process.env
// directly here (rather than through src/lib/env.ts) is appropriate.
const databaseUrl = process.env.DATABASE_URL_UNPOOLED;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL_UNPOOLED must be set to run drizzle-kit commands. " +
      "Use the Neon direct (non-pooled) connection string — migrations run DDL, " +
      "which the pooled connection is not suitable for."
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
});
