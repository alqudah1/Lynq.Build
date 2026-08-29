import "server-only";
import { z } from "zod";

/**
 * Server-only environment validation. This module must never be imported
 * from a client component — the `server-only` import above turns any such
 * import into a build-time error.
 *
 * Validation is exposed as a function (not run at module import time) so
 * callers can catch `EnvValidationError` and decide exactly what, if
 * anything, to surface to a client — instead of an unhandled throw leaking
 * whatever Next.js's default error page happens to show.
 */

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_URL_UNPOOLED: z.string().min(1, "DATABASE_URL_UNPOOLED is required"),
  // Module 9 — the one platform-operational secret in this codebase that
  // isn't org-scoped or human-session-scoped: authorizes issuing a new
  // worker credential (an ops/deployment action, analogous to seeding),
  // never business-data access. Optional so existing environments/tests
  // that never touch the worker system keep working unmodified.
  WORKER_BOOTSTRAP_SECRET: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(32).optional(),
  OFFICE_PLANNING_MODEL: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i).optional(),
  OFFICE_ENGINEERING_MODEL: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i).optional(),
  OFFICE_REVIEW_MODEL: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i).optional(),
  // Lead-gen model routing — the same role-per-env-var shape the Office
  // uses, defaulting to Anthropic Claude through the AI Gateway. Optional:
  // `lib/lead-gen/models.ts` carries the defaults, so an unset environment
  // is fully working rather than broken.
  LEADGEN_RESEARCH_MODEL: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i).optional(),
  LEADGEN_CONTENT_MODEL: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i).optional(),
  LEADGEN_REVIEW_MODEL: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i).optional(),
  LEADGEN_CLASSIFICATION_MODEL: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i).optional(),
  // Module 16 — Communications Core. Symmetric key (32 raw bytes,
  // base64-encoded) used to encrypt integration connection credentials at
  // rest (`integration_credentials.ciphertext`, AES-256-GCM). Optional —
  // if absent, storing a real provider credential fails closed
  // (`IntegrationCredentialEncryptionUnavailableError`) rather than ever
  // persisting a plaintext secret; every other Communications capability
  // (development providers, drafts, templates) still works with no key
  // configured.
  INTEGRATION_CREDENTIAL_ENCRYPTION_KEY: z.string().min(1).optional(),
  // Resend (email) — optional. Absent in this environment; the adapter is
  // fully implemented but never claims a real send without a real key.
  RESEND_API_KEY: z.string().min(1).optional(),
  // Verifies Resend's (Svix-format) webhook signature. Optional, but
  // required in practice before any inbound Resend webhook is accepted —
  // see `providers/resend.ts`.
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
  // A shared, platform-level secret the development providers' own
  // webhook simulation route checks via a bearer header — never used for
  // a real provider. Optional; if absent, the dev webhook route rejects
  // every request rather than accepting one unauthenticated.
  COMMUNICATIONS_DEV_WEBHOOK_SECRET: z.string().min(1).optional(),
  // The public https origin prospect demo URLs are built from. Unset falls
  // back to the Vercel production URL and then to app.lynq.build, so a
  // preview deployment links to itself instead of to production.
  LYNQ_PUBLIC_APP_ORIGIN: z.string().regex(/^https:\/\/[^\s/]+$/).optional(),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  public readonly missingOrInvalidKeys: string[];

  constructor(missingOrInvalidKeys: string[]) {
    super(
      `Server misconfiguration: missing or invalid environment variables (${missingOrInvalidKeys.join(", ")}).`
    );
    this.name = "EnvValidationError";
    this.missingOrInvalidKeys = missingOrInvalidKeys;
  }
}

export function loadEnv(): Env {
  const parsed = envSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    WORKER_BOOTSTRAP_SECRET: process.env.WORKER_BOOTSTRAP_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    OFFICE_PLANNING_MODEL: process.env.OFFICE_PLANNING_MODEL,
    OFFICE_ENGINEERING_MODEL: process.env.OFFICE_ENGINEERING_MODEL,
    OFFICE_REVIEW_MODEL: process.env.OFFICE_REVIEW_MODEL,
    LEADGEN_RESEARCH_MODEL: process.env.LEADGEN_RESEARCH_MODEL,
    LEADGEN_CONTENT_MODEL: process.env.LEADGEN_CONTENT_MODEL,
    LEADGEN_REVIEW_MODEL: process.env.LEADGEN_REVIEW_MODEL,
    LEADGEN_CLASSIFICATION_MODEL: process.env.LEADGEN_CLASSIFICATION_MODEL,
    INTEGRATION_CREDENTIAL_ENCRYPTION_KEY: process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    // Was declared in the schema but never passed in, so it always parsed
    // as undefined and every reader fell back to `process.env` directly.
    COMMUNICATIONS_DEV_WEBHOOK_SECRET: process.env.COMMUNICATIONS_DEV_WEBHOOK_SECRET,
    LYNQ_PUBLIC_APP_ORIGIN: process.env.LYNQ_PUBLIC_APP_ORIGIN,
  });

  if (!parsed.success) {
    const keys = Object.keys(parsed.error.flatten().fieldErrors);
    // Server-side log only — the caller decides what (if anything) a client ever sees.
    console.error("[env] invalid or missing configuration:", keys);
    throw new EnvValidationError(keys);
  }

  return parsed.data;
}
