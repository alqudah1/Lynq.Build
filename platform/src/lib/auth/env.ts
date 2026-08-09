import "server-only";
import { z } from "zod";

/**
 * OAuth and Session Foundation (Module 2 Step 3) environment validation —
 * deliberately its own schema/loader, separate from src/lib/env.ts. That
 * module's loadEnv() backs the already-shipped health check and must keep
 * working with only DATABASE_URL/DATABASE_URL_UNPOOLED set; merging these
 * OAuth vars into it would make unrelated, already-working functionality
 * fail until OAuth is fully configured.
 *
 * Deliberately distinct from the Neon Auth-specific environment variables
 * (see the Neon Auth isolation boundaries), which must never be read
 * anywhere in this app — see
 * platform/docs/MODULE_2_AUTH_AND_TENANCY_DESIGN.md §19 point 6, enforced
 * by src/static-checks/no-neon-auth-usage.test.ts.
 */

const authEnvSchema = z.object({
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1, "GOOGLE_OAUTH_CLIENT_ID is required"),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1, "GOOGLE_OAUTH_CLIENT_SECRET is required"),
  MICROSOFT_OAUTH_CLIENT_ID: z.string().min(1, "MICROSOFT_OAUTH_CLIENT_ID is required"),
  MICROSOFT_OAUTH_CLIENT_SECRET: z.string().min(1, "MICROSOFT_OAUTH_CLIENT_SECRET is required"),
  // Recommended value: "organizations" (Entra ID work/school accounts only,
  // any tenant) — see Step 3 design §5's Microsoft-specific note.
  MICROSOFT_OAUTH_TENANT_ID: z.string().min(1, "MICROSOFT_OAUTH_TENANT_ID is required"),
  // HMAC key signing the pre-auth OAuth state/PKCE cookie (Step 3 design §7).
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  // Exact, pre-registered base URL used to construct the OAuth redirect URI
  // — deliberately explicit, never derived from request headers (Module 2
  // §2's "never dynamically constructed from request input" rule).
  AUTH_BASE_URL: z.string().url("AUTH_BASE_URL must be a valid URL"),
});

export type AuthEnv = z.infer<typeof authEnvSchema>;

export class AuthEnvValidationError extends Error {
  public readonly missingOrInvalidKeys: string[];

  constructor(missingOrInvalidKeys: string[]) {
    super(
      `Auth misconfiguration: missing or invalid environment variables (${missingOrInvalidKeys.join(", ")}).`
    );
    this.name = "AuthEnvValidationError";
    this.missingOrInvalidKeys = missingOrInvalidKeys;
  }
}

export function loadAuthEnv(): AuthEnv {
  const parsed = authEnvSchema.safeParse({
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    MICROSOFT_OAUTH_CLIENT_ID: process.env.MICROSOFT_OAUTH_CLIENT_ID,
    MICROSOFT_OAUTH_CLIENT_SECRET: process.env.MICROSOFT_OAUTH_CLIENT_SECRET,
    MICROSOFT_OAUTH_TENANT_ID: process.env.MICROSOFT_OAUTH_TENANT_ID,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_BASE_URL: process.env.AUTH_BASE_URL,
  });

  if (!parsed.success) {
    const keys = Object.keys(parsed.error.flatten().fieldErrors);
    console.error("[auth-env] invalid or missing configuration:", keys);
    throw new AuthEnvValidationError(keys);
  }

  return parsed.data;
}
