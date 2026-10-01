export { db, rawSql, env, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, pollUntilJobDone } from "@/lib/agent-runtime/test-helpers";
export { addOrgMember } from "@/lib/crm/test-helpers";
export { makeMarketingUser } from "@/lib/marketing-os/test-helpers";

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/agent-runtime/test-helpers";
import { marketingChannelAccounts, integrationConnections, integrationCredentials } from "@/db/schema";
import { encryptCredentialSecret } from "@/lib/communications-os/secrets";
import { createBrand, type SocialBrand } from "./brands";
import type { SocialPlatform } from "./validation";
import type { SocialTokenBundle } from "./providers/social/types";

/**
 * Module 19 test fixtures. Everything created here is tenant-scoped under
 * an org `makeOrgWithOwner` registered, so `cleanupAgentRuntimeTestData`
 * (which deletes the organization with cascades) removes it.
 */

export function randSocialKey(prefix = "brand"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A real org with an owner and one brand. */
export async function makeSocialOrg(): Promise<{ orgId: string; ownerId: string; brand: SocialBrand }> {
  const { makeUser, makeOrgWithOwner } = await import("@/lib/agent-runtime/test-helpers");
  const ownerId = await makeUser();
  const orgId = await makeOrgWithOwner(ownerId);
  const brand = await makeSocialBrand(orgId, ownerId);
  return { orgId, ownerId, brand };
}

export async function makeSocialBrand(orgId: string, actorUserId: string, overrides: Partial<Parameters<typeof createBrand>[1]["brand"]> = {}): Promise<SocialBrand> {
  return createBrand(db, {
    organizationId: orgId,
    actorUserId,
    brand: {
      brandKey: randSocialKey(),
      name: "Test Brand",
      positioning: "A test brand for the Social Command Center.",
      audience: "Owners of local service businesses.",
      voice: "Direct and warm.",
      visualRules: "Black and white.",
      productContext: "Websites and marketing.",
      claimsGuardrails: "Never promise guaranteed revenue.",
      callsToAction: ["Book a call"],
      approvedExamples: ["Your website should work as hard as you do."],
      companyInfo: "",
      brandStory: "",
      writingStyle: "",
      visualIdentity: { colors: [], typography: { heading: "", body: "" }, logoAssetIds: [], notes: "" },
      websites: [],
      competitors: [],
      contentPillars: ["education", "proof"],
      preferredPlatforms: ["instagram", "linkedin"],
      prohibitedLanguage: ["guaranteed"],
      neverClaim: [],
      geographicMarket: "Greater Toronto Area",
      objectives: [],
      ...overrides,
    },
  });
}

/** The test encryption key the Communications tests use (32 raw bytes, base64). Set the env for the duration of a test when a real credential round-trip is needed. */
export function ensureTestEncryptionKey(): string {
  if (!process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY) process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  return process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;
}

/** A manual (no-credential) channel account — the honest pre-connection state. */
export async function makeManualAccount(orgId: string, brandProfileId: string, platform: SocialPlatform, displayName = `${platform} test account`) {
  const [row] = await db
    .insert(marketingChannelAccounts)
    .values({ organizationId: orgId, brandProfileId, platform, accountKind: platform.endsWith("_ads") ? "paid" : "organic", displayName, connectionStatus: "manual" })
    .returning();
  return row;
}

/**
 * A "connected" account backed by a real `integration_connections` row with
 * an encrypted token bundle — exactly what the OAuth callback produces —
 * so publishing/sync code paths can be exercised with an injected fetch.
 */
export async function makeConnectedAccount(orgId: string, brandProfileId: string, platform: SocialPlatform, options: { externalAccountId?: string; bundle?: Partial<SocialTokenBundle>; connectedByUserId?: string; tokenExpiresAt?: Date | null } = {}) {
  const key = ensureTestEncryptionKey();
  const provider = platform === "linkedin" || platform === "linkedin_ads" ? "linkedin" : platform === "google_ads" ? "google_ads" : "meta";
  const externalAccountId = options.externalAccountId ?? `ext-${Math.random().toString(36).slice(2, 10)}`;
  const [connection] = await db
    .insert(integrationConnections)
    .values({ organizationId: orgId, provider, integrationType: platform.endsWith("_ads") ? "ads" : "social", displayName: `${provider} grant`, status: "connected", externalAccountId: `principal-${externalAccountId}`, scopesMetadata: ["test_scope"], connectedByUserId: options.connectedByUserId ?? null, lastVerifiedAt: new Date() })
    .returning();
  const bundle: SocialTokenBundle = { accessToken: "test-user-token", scopes: ["test_scope"], assets: { [externalAccountId]: { accessToken: "test-asset-token" } }, ...options.bundle };
  const encrypted = encryptCredentialSecret(key, JSON.stringify(bundle));
  await db.insert(integrationCredentials).values({ organizationId: orgId, connectionId: connection.id, ciphertext: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag, issuedByUserId: options.connectedByUserId ?? null });
  const [account] = await db
    .insert(marketingChannelAccounts)
    .values({ organizationId: orgId, brandProfileId, platform, accountKind: platform.endsWith("_ads") ? "paid" : "organic", displayName: `${platform} ${externalAccountId}`, handle: externalAccountId, connectionStatus: "connected", integrationConnectionId: connection.id, externalAccountId, scopes: ["test_scope"], tokenExpiresAt: options.tokenExpiresAt === undefined ? new Date(Date.now() + 30 * 24 * 3600 * 1000) : options.tokenExpiresAt, lastSyncAt: new Date() })
    .returning();
  return { account, connection, bundle };
}

export async function setAccountStatus(accountId: string, connectionStatus: string) {
  await db.update(marketingChannelAccounts).set({ connectionStatus }).where(eq(marketingChannelAccounts.id, accountId));
}

/** A minimal 1×1 JPEG so image-requiring platforms accept a test asset. */
export const TINY_JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x03, 0x02, 0x02, 0x02, 0x02, 0x02, 0x03, 0x02, 0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x04, 0x06, 0x04, 0x04, 0x04, 0x04, 0x04, 0x08, 0x06,
  0x06, 0x05, 0x06, 0x09, 0x08, 0x0a, 0x0a, 0x09, 0x08, 0x09, 0x09, 0x0a, 0x0c, 0x0f, 0x0c, 0x0a, 0x0b, 0x0e, 0x0b, 0x09, 0x09, 0x0d, 0x11, 0x0d, 0x0e, 0x0f, 0x10, 0x10, 0x11, 0x10, 0x0a, 0x0c, 0x12, 0x13, 0x12, 0x10, 0x13, 0x0f, 0x10, 0x10, 0x10, 0xff, 0xc9, 0x00, 0x0b, 0x08, 0x00,
  0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xcc, 0x00, 0x06, 0x00, 0x10, 0x10, 0x05, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xd2, 0xcf, 0x20, 0xff, 0xd9,
]);

/** Builds a fake `fetch` from an ordered list of (matcher → response) pairs; unmatched calls fail loudly. */
export function fakeFetch(routes: { match: (url: string, init?: RequestInit) => boolean; respond: (url: string, init?: RequestInit) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> } }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find((r) => r.match(url, init));
    if (!route) return new Response(JSON.stringify({ error: { message: `unexpected request: ${init?.method ?? "GET"} ${url}` } }), { status: 599, headers: { "content-type": "application/json" } });
    const out = route.respond(url, init);
    const body = out.json !== undefined ? JSON.stringify(out.json) : (out.text ?? "");
    return new Response(body, { status: out.status ?? 200, headers: { "content-type": out.json !== undefined ? "application/json" : "text/plain", ...(out.headers ?? {}) } });
  };
  return { fetchImpl, calls };
}
