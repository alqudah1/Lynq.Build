import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNull, inArray, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { z } from "zod";
import { marketingChannelAccounts, marketingBrandProfiles, integrationConnections, integrationCredentials } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { DomainRuleViolationError } from "@/lib/authz/errors";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { loadEnv } from "@/lib/env";
import { loadAuthEnv } from "@/lib/auth/env";
import { encryptCredentialSecret, decryptCredentialSecret } from "@/lib/communications-os/secrets";
import { resolveMarketingAuthContext, requireMarketingViewAuthority, requireMarketingManageConnectionsAuthority } from "@/lib/marketing-os/authz";
import { resolveBrandById, requireActiveBrand } from "./brands";
import {
  SOCIAL_PLATFORM_PROVIDER,
  SOCIAL_PLATFORM_LABELS,
  SOCIAL_ACCOUNT_CONNECTION_STATUSES,
  socialPlatformSchema,
  isAdPlatform,
  isOrganicPlatform,
  type SocialPlatform,
  type SocialAccountConnectionStatus,
  type SocialAccountKind,
} from "./validation";
import {
  StaleSocialUpdateError,
  SocialAccountNotConnectedError,
  SocialCredentialMissingError,
  SocialTokenExpiredError,
  SocialProviderError,
  SocialProviderNotConfiguredError,
} from "./errors";
import { resolveSocialProviderAdapter, SOCIAL_PROVIDER_IDS, SOCIAL_PROVIDER_LABELS, type SocialProviderEnv } from "./providers/social/registry";
import { redactSecrets } from "./providers/social/http";
import { buildProviderAuthorizationUrl, exchangeProviderCode, socialOAuthRedirectUri, type StoredSocialTokenBundle } from "./oauth/providers";
import { generateState, isSafeSocialRedirectPath, type NewSocialOAuthPayload } from "./oauth/state";
import type { DiscoveredAsset, FetchLike, SocialAccountCredential, SocialProviderAdapter, SocialProviderId, SocialTokenBundle } from "./providers/social/types";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type AccountRow = typeof marketingChannelAccounts.$inferSelect;
type ConnectionRow = typeof integrationConnections.$inferSelect;

/**
 * Module 19 — the Connection Center service. OAuth grants live on
 * `integration_connections` (one row per organization × provider × granting
 * principal); their token bundle is encrypted on `integration_credentials`;
 * every asset the grant can act on (Page, Instagram account, organization,
 * ad account) is a `marketing_channel_accounts` row linked to the grant.
 *
 * Status honesty: an account is `connected` only after a provider call
 * succeeded with a decryptable credential; expiry, revocation and errors
 * are written back as `token_expired` / `authorization_required` / `error`.
 * Tokens never leave this module except as the decrypted bundle handed to
 * an adapter inside the server.
 */

export interface SocialConnectionDeps {
  fetchImpl?: FetchLike;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Provider keys; defaults to `loadEnv()`. */
  env?: SocialProviderEnv;
}

export class SocialAccountNameTakenError extends DomainRuleViolationError {
  readonly reason = "social_account_name_taken";
  constructor() {
    super("Another account on this brand and platform already uses that name");
    this.name = "SocialAccountNameTakenError";
  }
}

const SOCIAL_PROVIDERS: readonly SocialProviderId[] = SOCIAL_PROVIDER_IDS;
const EXPIRY_WARNING_MS = 7 * 24 * 3600 * 1000;

function providerEnv(deps?: SocialConnectionDeps): SocialProviderEnv {
  return deps?.env ?? loadEnv();
}

function clock(deps?: SocialConnectionDeps): Date {
  return deps?.now ? deps.now() : new Date();
}

function adapterDeps(deps?: SocialConnectionDeps) {
  return { fetchImpl: deps?.fetchImpl, now: deps?.now, sleep: deps?.sleep };
}

function sanitizeMessage(message: string, max = 500): string {
  const clean = redactSecrets(message);
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asStatus(value: string): SocialAccountConnectionStatus {
  return (SOCIAL_ACCOUNT_CONNECTION_STATUSES as readonly string[]).includes(value) ? (value as SocialAccountConnectionStatus) : "error";
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface SocialAccountView {
  id: string;
  organizationId: string;
  brandProfileId: string;
  brandName: string | null;
  platform: SocialPlatform;
  platformLabel: string;
  accountKind: SocialAccountKind;
  displayName: string;
  handle: string | null;
  externalUrl: string | null;
  connectionStatus: SocialAccountConnectionStatus;
  provider: SocialProviderId | null;
  /** False for platforms without an official-API adapter in this build (TikTok, YouTube, X). */
  supported: boolean;
  integrationConnectionId: string | null;
  externalAccountId: string | null;
  scopes: string[];
  tokenExpiresAt: Date | null;
  lastSyncAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorAt: Date | null;
  metadata: Record<string, unknown>;
  canPublish: boolean;
  canReadInsights: boolean;
  canReadEngagement: boolean;
  canManageAds: boolean;
  archivedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SocialConnectionView {
  id: string;
  provider: SocialProviderId;
  displayName: string;
  status: string;
  connectedByUserId: string | null;
  lastVerifiedAt: Date | null;
  scopes: string[];
  accountCount: number;
  disconnectedAt: Date | null;
  revision: number;
}

export interface SocialProviderOverview {
  provider: SocialProviderId;
  label: string;
  platforms: readonly SocialPlatform[];
  configured: boolean;
  missing: string[];
  redirectUri: string | null;
}

class AdapterCache {
  private readonly cache = new Map<SocialProviderId, SocialProviderAdapter>();
  constructor(private readonly env: SocialProviderEnv) {}
  get(provider: SocialProviderId): SocialProviderAdapter {
    let a = this.cache.get(provider);
    if (!a) {
      a = resolveSocialProviderAdapter(provider, this.env);
      this.cache.set(provider, a);
    }
    return a;
  }
}

function toAccountView(row: AccountRow, brandName: string | null, adapters: AdapterCache): SocialAccountView {
  const platform = socialPlatformSchema.safeParse(row.platform).success ? (row.platform as SocialPlatform) : ("x" as SocialPlatform);
  const provider = SOCIAL_PLATFORM_PROVIDER[platform] ?? null;
  const status = asStatus(row.connectionStatus);
  const connected = status === "connected" && Boolean(row.integrationConnectionId) && !row.archivedAt;
  const adapter = provider ? adapters.get(provider) : null;
  const memberProfile = platform === "linkedin" && (row.externalAccountId ?? "").startsWith("person:");
  const organic = isOrganicPlatform(platform);
  return {
    id: row.id,
    organizationId: row.organizationId,
    brandProfileId: row.brandProfileId,
    brandName,
    platform,
    platformLabel: SOCIAL_PLATFORM_LABELS[platform],
    accountKind: row.accountKind === "paid" ? "paid" : "organic",
    displayName: row.displayName,
    handle: row.handle,
    externalUrl: row.externalUrl,
    connectionStatus: status,
    provider,
    supported: provider !== null,
    integrationConnectionId: row.integrationConnectionId,
    externalAccountId: row.externalAccountId,
    scopes: stringArray(row.scopes),
    tokenExpiresAt: row.tokenExpiresAt,
    lastSyncAt: row.lastSyncAt,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    lastErrorAt: row.lastErrorAt,
    metadata: row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {},
    canPublish: connected && organic && Boolean(adapter?.publish),
    canReadInsights: connected && !memberProfile && Boolean(organic ? adapter?.fetchAccountInsights : adapter?.listAdCampaigns),
    canReadEngagement: connected && organic && Boolean(adapter?.fetchEngagement),
    canManageAds: connected && isAdPlatform(platform) && Boolean(adapter?.executeAdChange),
    archivedAt: row.archivedAt,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function brandNames(db: Db, organizationId: string): Promise<Map<string, string>> {
  const rows = await db.select({ id: marketingBrandProfiles.id, name: marketingBrandProfiles.name }).from(marketingBrandProfiles).where(eq(marketingBrandProfiles.organizationId, organizationId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function viewsFor(db: Db, organizationId: string, rows: AccountRow[], env: SocialProviderEnv): Promise<SocialAccountView[]> {
  const names = await brandNames(db, organizationId);
  const adapters = new AdapterCache(env);
  return rows.map((r) => toAccountView(r, names.get(r.brandProfileId) ?? null, adapters));
}

async function viewFor(db: Db, row: AccountRow, env: SocialProviderEnv): Promise<SocialAccountView> {
  const [brand] = await db.select({ name: marketingBrandProfiles.name }).from(marketingBrandProfiles).where(and(eq(marketingBrandProfiles.id, row.brandProfileId), eq(marketingBrandProfiles.organizationId, row.organizationId)));
  return toAccountView(row, brand?.name ?? null, new AdapterCache(env));
}

function toConnectionView(row: ConnectionRow, accountCount: number): SocialConnectionView {
  return {
    id: row.id,
    provider: row.provider as SocialProviderId,
    displayName: row.displayName,
    status: row.status,
    connectedByUserId: row.connectedByUserId,
    lastVerifiedAt: row.lastVerifiedAt,
    scopes: stringArray(row.scopesMetadata),
    accountCount,
    disconnectedAt: row.disconnectedAt,
    revision: row.revision,
  };
}

function safeAuthBaseUrl(): string | null {
  try {
    return loadAuthEnv().AUTH_BASE_URL;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tenant-scoped loaders
// ---------------------------------------------------------------------------

async function resolveAccount(db: Db, organizationId: string, channelAccountId: string): Promise<AccountRow> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(marketingChannelAccounts).where(and(eq(marketingChannelAccounts.id, channelAccountId), eq(marketingChannelAccounts.organizationId, organizationId)));
    return row;
  });
}

async function resolveSocialConnection(db: Db, organizationId: string, connectionId: string): Promise<ConnectionRow> {
  return requireTenantScopedResource(async () => {
    const [row] = await db
      .select()
      .from(integrationConnections)
      .where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.organizationId, organizationId), inArray(integrationConnections.provider, [...SOCIAL_PROVIDERS])));
    return row;
  });
}

async function readActiveBundle(db: Db, organizationId: string, connectionId: string): Promise<StoredSocialTokenBundle> {
  const [cred] = await db
    .select({ ciphertext: integrationCredentials.ciphertext, iv: integrationCredentials.iv, authTag: integrationCredentials.authTag })
    .from(integrationCredentials)
    .where(and(eq(integrationCredentials.connectionId, connectionId), eq(integrationCredentials.organizationId, organizationId), isNull(integrationCredentials.revokedAt)));
  if (!cred) throw new SocialCredentialMissingError();
  const plaintext = decryptCredentialSecret(loadEnv().INTEGRATION_CREDENTIAL_ENCRYPTION_KEY, cred);
  const parsed = JSON.parse(plaintext) as StoredSocialTokenBundle;
  if (!parsed || typeof parsed.accessToken !== "string") throw new SocialCredentialMissingError();
  return { ...parsed, scopes: stringArray(parsed.scopes) };
}

/** The date the account's authorization actually lapses (not the access token's: a refresh token or a non-expiring asset token outlives it). */
function authorizationExpiry(bundle: StoredSocialTokenBundle, externalAccountId: string): Date | null {
  const asset = bundle.assets?.[externalAccountId];
  if (asset?.accessToken) return asset.expiresAt ? new Date(asset.expiresAt) : null;
  if (bundle.refreshToken) return bundle.refreshTokenExpiresAt ? new Date(bundle.refreshTokenExpiresAt) : null;
  return bundle.expiresAt ? new Date(bundle.expiresAt) : null;
}

// ---------------------------------------------------------------------------
// Connection Center
// ---------------------------------------------------------------------------

export async function describeConnectionCenter(db: Db, input: { organizationId: string; actorUserId: string; deps?: SocialConnectionDeps }): Promise<{ providers: SocialProviderOverview[]; accounts: SocialAccountView[]; connections: SocialConnectionView[] }> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "integration_connection", "list");
  const env = providerEnv(input.deps);
  const baseUrl = safeAuthBaseUrl();
  const adapters = new AdapterCache(env);
  const providers = SOCIAL_PROVIDERS.map((provider) => {
    const adapter = adapters.get(provider);
    const missing = adapter.missingConfiguration();
    return { provider, label: SOCIAL_PROVIDER_LABELS[provider], platforms: adapter.platforms, configured: missing.length === 0, missing, redirectUri: baseUrl ? socialOAuthRedirectUri(baseUrl, provider) : null };
  });
  const accountRows = await db
    .select()
    .from(marketingChannelAccounts)
    .where(and(eq(marketingChannelAccounts.organizationId, input.organizationId), isNull(marketingChannelAccounts.archivedAt)))
    .orderBy(marketingChannelAccounts.platform, marketingChannelAccounts.displayName);
  const accounts = await viewsFor(db, input.organizationId, accountRows, env);
  const connectionRows = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.organizationId, input.organizationId), inArray(integrationConnections.provider, [...SOCIAL_PROVIDERS])))
    .orderBy(desc(integrationConnections.createdAt));
  const counts = new Map<string, number>();
  for (const a of accountRows) if (a.integrationConnectionId) counts.set(a.integrationConnectionId, (counts.get(a.integrationConnectionId) ?? 0) + 1);
  return { providers, accounts, connections: connectionRows.map((c) => toConnectionView(c, counts.get(c.id) ?? 0)) };
}

export async function beginConnection(
  db: Db,
  input: { organizationId: string; brandProfileId: string; provider: SocialProviderId; actorUserId: string; redirectTo: string; deps?: SocialConnectionDeps },
): Promise<{ authorizationUrl: string; cookiePayload: NewSocialOAuthPayload }> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageConnectionsAuthority(db, ctx, "integration_connection", "new");
  await requireActiveBrand(db, input.organizationId, input.brandProfileId);
  const env = providerEnv(input.deps);
  const adapter = resolveSocialProviderAdapter(input.provider, env);
  const missing = adapter.missingConfiguration();
  if (missing.length) throw new SocialProviderNotConfiguredError(input.provider, missing);
  const authEnv = loadAuthEnv();
  const state = generateState();
  const redirectUri = socialOAuthRedirectUri(authEnv.AUTH_BASE_URL, input.provider);
  const authorizationUrl = buildProviderAuthorizationUrl(input.provider, env, { redirectUri, state });
  const redirectTo = isSafeSocialRedirectPath(input.redirectTo) ? input.redirectTo : "/";
  await recordAuditEvent(db, { eventType: "social_connection_started", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_brand_profile", targetId: input.brandProfileId, metadata: { provider: input.provider } });
  return { authorizationUrl, cookiePayload: { provider: input.provider, state, organizationId: input.organizationId, brandProfileId: input.brandProfileId, actorUserId: input.actorUserId, redirectTo } };
}

/**
 * Encrypts and stores a token bundle as the connection's single active
 * credential (revoking any prior one). Fails closed with no encryption key.
 */
export async function storeSocialCredential(
  db: Db,
  input: { organizationId: string; connectionId: string; bundle: StoredSocialTokenBundle | SocialTokenBundle; actorUserId: string | null; audit?: boolean },
): Promise<{ credentialId: string }> {
  // Encrypt first: no key → nothing is revoked or written.
  const encrypted = encryptCredentialSecret(loadEnv().INTEGRATION_CREDENTIAL_ENCRYPTION_KEY, JSON.stringify(input.bundle));
  const insertActive = async () => {
    await db
      .update(integrationCredentials)
      .set({ revokedAt: new Date(), revokedByUserId: input.actorUserId })
      .where(and(eq(integrationCredentials.connectionId, input.connectionId), eq(integrationCredentials.organizationId, input.organizationId), isNull(integrationCredentials.revokedAt)));
    const [row] = await db
      .insert(integrationCredentials)
      .values({ organizationId: input.organizationId, connectionId: input.connectionId, ciphertext: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag, issuedByUserId: input.actorUserId })
      .returning({ id: integrationCredentials.id });
    return row;
  };
  let row: { id: string };
  try {
    row = await insertActive();
  } catch (err) {
    // A concurrent writer inserted between our revoke and insert — revoke theirs and retry once.
    if (!isPostgresUniqueViolation(err)) throw err;
    row = await insertActive();
  }
  if (input.audit !== false) {
    await recordAuditEvent(db, {
      eventType: "social_connection_completed",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "integration_connection",
      targetId: input.connectionId,
      metadata: { scopes: stringArray(input.bundle.scopes), assetCount: Object.keys(input.bundle.assets ?? {}).length, expiresAt: input.bundle.expiresAt ?? null },
    });
  }
  return { credentialId: row.id };
}

function principalIdFor(bundle: SocialTokenBundle, assets: DiscoveredAsset[]): string {
  if (bundle.principal?.externalId) return bundle.principal.externalId;
  const ids = assets.map((a) => `${a.platform}:${a.externalAccountId}`).sort();
  return `grant:${createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 24)}`;
}

async function upsertGrantConnection(db: Db, input: { organizationId: string; provider: SocialProviderId; principalId: string; displayName: string; scopes: string[]; actorUserId: string; now: Date }): Promise<ConnectionRow> {
  const find = async () => {
    const [row] = await db
      .select()
      .from(integrationConnections)
      .where(and(eq(integrationConnections.organizationId, input.organizationId), eq(integrationConnections.provider, input.provider), eq(integrationConnections.externalAccountId, input.principalId), isNull(integrationConnections.disconnectedAt)));
    return row;
  };
  const refreshExisting = async (existing: ConnectionRow) => {
    const [row] = await db
      .update(integrationConnections)
      .set({ status: "connected", displayName: input.displayName, scopesMetadata: input.scopes, connectedByUserId: input.actorUserId, lastVerifiedAt: input.now, revision: existing.revision + 1, updatedAt: input.now })
      .where(and(eq(integrationConnections.id, existing.id), eq(integrationConnections.organizationId, input.organizationId)))
      .returning();
    return row;
  };
  const existing = await find();
  if (existing) return refreshExisting(existing);
  try {
    const [row] = await db
      .insert(integrationConnections)
      .values({
        organizationId: input.organizationId,
        provider: input.provider,
        integrationType: input.provider === "google_ads" ? "ads" : "social",
        displayName: input.displayName,
        status: "connected",
        externalAccountId: input.principalId,
        scopesMetadata: input.scopes,
        connectedByUserId: input.actorUserId,
        lastVerifiedAt: input.now,
      })
      .returning();
    return row;
  } catch (err) {
    if (!isPostgresUniqueViolation(err)) throw err;
    const raced = await find();
    if (!raced) throw err;
    return refreshExisting(raced);
  }
}

async function upsertDiscoveredAccount(
  db: Db,
  input: { organizationId: string; brandProfileId: string; connectionId: string; asset: DiscoveredAsset; scopes: string[]; tokenExpiresAt: Date | null; now: Date },
): Promise<{ row: AccountRow; linkedManual: boolean }> {
  const { asset } = input;
  const common = {
    handle: asset.handle ?? null,
    externalUrl: asset.externalUrl ?? null,
    metadata: asset.metadata,
    scopes: input.scopes,
    tokenExpiresAt: input.tokenExpiresAt,
    integrationConnectionId: input.connectionId,
    connectionStatus: "connected" as const,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastErrorAt: null,
    updatedAt: input.now,
  };

  const [byExternal] = await db
    .select()
    .from(marketingChannelAccounts)
    .where(and(eq(marketingChannelAccounts.organizationId, input.organizationId), eq(marketingChannelAccounts.platform, asset.platform), eq(marketingChannelAccounts.externalAccountId, asset.externalAccountId), isNull(marketingChannelAccounts.archivedAt)));
  if (byExternal) {
    const update = async (withName: boolean) => {
      const [row] = await db
        .update(marketingChannelAccounts)
        .set({ ...common, ...(withName ? { displayName: asset.displayName } : {}), revision: byExternal.revision + 1 })
        .where(and(eq(marketingChannelAccounts.id, byExternal.id), eq(marketingChannelAccounts.organizationId, input.organizationId)))
        .returning();
      return row;
    };
    try {
      return { row: await update(true), linkedManual: false };
    } catch (err) {
      if (!isPostgresUniqueViolation(err)) throw err;
      return { row: await update(false), linkedManual: false };
    }
  }

  const [manual] = await db
    .select()
    .from(marketingChannelAccounts)
    .where(
      and(
        eq(marketingChannelAccounts.organizationId, input.organizationId),
        eq(marketingChannelAccounts.brandProfileId, input.brandProfileId),
        eq(marketingChannelAccounts.platform, asset.platform),
        eq(marketingChannelAccounts.displayName, asset.displayName),
        isNull(marketingChannelAccounts.externalAccountId),
        isNull(marketingChannelAccounts.archivedAt),
      ),
    );
  if (manual) {
    const [row] = await db
      .update(marketingChannelAccounts)
      .set({ ...common, externalAccountId: asset.externalAccountId, accountKind: asset.accountKind, revision: manual.revision + 1 })
      .where(and(eq(marketingChannelAccounts.id, manual.id), eq(marketingChannelAccounts.organizationId, input.organizationId)))
      .returning();
    return { row, linkedManual: true };
  }

  const insert = async (displayName: string) => {
    const [row] = await db
      .insert(marketingChannelAccounts)
      .values({ organizationId: input.organizationId, brandProfileId: input.brandProfileId, platform: asset.platform, accountKind: asset.accountKind, displayName, externalAccountId: asset.externalAccountId, ...common })
      .returning();
    return row;
  };
  try {
    return { row: await insert(asset.displayName), linkedManual: false };
  } catch (err) {
    if (!isPostgresUniqueViolation(err)) throw err;
    return { row: await insert(`${asset.displayName} (${asset.externalAccountId})`), linkedManual: false };
  }
}

export async function completeConnection(
  db: Db,
  input: { organizationId: string; brandProfileId: string; provider: SocialProviderId; actorUserId: string; code: string; codeVerifier?: string; deps?: SocialConnectionDeps },
): Promise<{ connectionId: string; accounts: SocialAccountView[] }> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageConnectionsAuthority(db, ctx, "integration_connection", "new");
  await requireActiveBrand(db, input.organizationId, input.brandProfileId);
  const env = providerEnv(input.deps);
  const fetchImpl: FetchLike = input.deps?.fetchImpl ?? ((u, i) => fetch(u, i));
  const now = clock(input.deps);

  try {
    const adapter = resolveSocialProviderAdapter(input.provider, env, adapterDeps(input.deps));
    const missing = adapter.missingConfiguration();
    if (missing.length) throw new SocialProviderNotConfiguredError(input.provider, missing);
    const redirectUri = socialOAuthRedirectUri(loadAuthEnv().AUTH_BASE_URL, input.provider);
    const bundle = await exchangeProviderCode(input.provider, env, { code: input.code, redirectUri, codeVerifier: input.codeVerifier, fetchImpl, now });
    const assets = await adapter.discoverAssets(bundle);
    if (!assets.length && !bundle.principal) throw new SocialProviderError(input.provider, "no_assets", "the authorization did not grant access to any page or account", { retryable: false });

    const assetTokens: NonNullable<SocialTokenBundle["assets"]> = {};
    for (const a of assets) if (a.accessToken) assetTokens[a.externalAccountId] = { accessToken: a.accessToken, ...(a.tokenExpiresAt ? { expiresAt: a.tokenExpiresAt } : {}) };
    const stored: StoredSocialTokenBundle = { ...bundle, assets: assetTokens };

    const principalId = principalIdFor(bundle, assets);
    const principalName = bundle.principal?.name ?? (assets[0]?.displayName ?? principalId);
    const connection = await upsertGrantConnection(db, {
      organizationId: input.organizationId,
      provider: input.provider,
      principalId,
      displayName: `${SOCIAL_PROVIDER_LABELS[input.provider].split(" (")[0]} · ${principalName}`.slice(0, 200),
      scopes: bundle.scopes,
      actorUserId: input.actorUserId,
      now,
    });
    await storeSocialCredential(db, { organizationId: input.organizationId, connectionId: connection.id, bundle: stored, actorUserId: input.actorUserId });

    const rows: AccountRow[] = [];
    for (const asset of assets) {
      const { row, linkedManual } = await upsertDiscoveredAccount(db, {
        organizationId: input.organizationId,
        brandProfileId: input.brandProfileId,
        connectionId: connection.id,
        asset,
        scopes: bundle.scopes,
        tokenExpiresAt: authorizationExpiry(stored, asset.externalAccountId),
        now,
      });
      rows.push(row);
      await recordAuditEvent(db, {
        eventType: "social_account_linked",
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        targetType: "marketing_channel_account",
        targetId: row.id,
        metadata: { platform: asset.platform, externalAccountId: asset.externalAccountId, connectionId: connection.id, linkedManual },
      });
    }
    return { connectionId: connection.id, accounts: await viewsFor(db, input.organizationId, rows, env) };
  } catch (err) {
    await recordAuditEvent(db, {
      eventType: "social_connection_failed",
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      targetType: "marketing_brand_profile",
      targetId: input.brandProfileId,
      metadata: { provider: input.provider, code: err instanceof SocialProviderError ? err.code : err instanceof DomainRuleViolationError ? err.reason : "internal_error" },
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Credentials for publishing / sync (internal — callers check authority)
// ---------------------------------------------------------------------------

export interface ResolvedSocialAccountCredential {
  account: AccountRow;
  connection: ConnectionRow;
  provider: SocialProviderId;
  credential: SocialAccountCredential;
}

async function markAccountsAuthState(db: Db, input: { organizationId: string; accounts: AccountRow[]; status: "token_expired" | "authorization_required"; code: string; message: string; provider: string; now: Date }): Promise<void> {
  for (const account of input.accounts) {
    await db
      .update(marketingChannelAccounts)
      .set({ connectionStatus: input.status, lastErrorCode: input.code, lastErrorMessage: sanitizeMessage(input.message), lastErrorAt: input.now, revision: account.revision + 1, updatedAt: input.now })
      .where(and(eq(marketingChannelAccounts.id, account.id), eq(marketingChannelAccounts.organizationId, input.organizationId)));
    await recordAuditEvent(db, { eventType: "social_connection_token_expired", organizationId: input.organizationId, targetType: "marketing_channel_account", targetId: account.id, metadata: { provider: input.provider, status: input.status, code: input.code } });
  }
}

export async function resolveSocialAccountCredential(db: Db, input: { organizationId: string; channelAccountId: string; deps?: SocialConnectionDeps }): Promise<ResolvedSocialAccountCredential> {
  const account = await resolveAccount(db, input.organizationId, input.channelAccountId);
  if (account.archivedAt) throw new SocialAccountNotConnectedError("archived");
  if (account.connectionStatus !== "connected") throw new SocialAccountNotConnectedError(account.connectionStatus);
  if (!account.integrationConnectionId || !account.externalAccountId) throw new SocialCredentialMissingError();
  const connection = await resolveSocialConnection(db, input.organizationId, account.integrationConnectionId);
  if (connection.disconnectedAt || connection.status === "disconnected") throw new SocialAccountNotConnectedError("disconnected");
  const provider = connection.provider as SocialProviderId;
  const now = clock(input.deps);

  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= now.getTime()) {
    await markAccountsAuthState(db, { organizationId: input.organizationId, accounts: [account], status: "token_expired", code: "token_expired", message: "The stored authorization has expired — reconnect the account", provider, now });
    throw new SocialTokenExpiredError(provider);
  }

  let bundle = await readActiveBundle(db, input.organizationId, connection.id);
  const accessExpired = bundle.expiresAt && new Date(bundle.expiresAt).getTime() - 120_000 <= now.getTime();
  if (accessExpired && bundle.refreshToken && !bundle.assets?.[account.externalAccountId]) {
    const adapter = resolveSocialProviderAdapter(provider, providerEnv(input.deps), adapterDeps(input.deps));
    if (adapter.refresh) {
      await refreshConnectionToken(db, { organizationId: input.organizationId, connectionId: connection.id, deps: input.deps });
      bundle = await readActiveBundle(db, input.organizationId, connection.id);
    }
  }
  return { account, connection, provider, credential: { bundle, externalAccountId: account.externalAccountId, platform: account.platform as SocialPlatform } };
}

/**
 * Records a provider failure on an account. Only a lost authorization
 * changes `connectionStatus` (→ `token_expired` / `authorization_required`);
 * an ordinary failure (a rejected image, a throttle) is recorded in
 * `lastError*` without blocking the account.
 */
export async function recordAccountError(db: Db, input: { organizationId: string; channelAccountId: string; code: string; message: string; authorizationLost: boolean }): Promise<void> {
  const account = await resolveAccount(db, input.organizationId, input.channelAccountId);
  const now = new Date();
  const status = input.authorizationLost ? (input.code === "token_expired" || /_190(_|$)/.test(input.code) ? "token_expired" : "authorization_required") : null;
  await db
    .update(marketingChannelAccounts)
    .set({ ...(status ? { connectionStatus: status } : {}), lastErrorCode: input.code.slice(0, 100), lastErrorMessage: sanitizeMessage(input.message), lastErrorAt: now, revision: account.revision + 1, updatedAt: now })
    .where(and(eq(marketingChannelAccounts.id, account.id), eq(marketingChannelAccounts.organizationId, input.organizationId)));
  if (status) {
    await recordAuditEvent(db, { eventType: "social_connection_token_expired", organizationId: input.organizationId, targetType: "marketing_channel_account", targetId: account.id, metadata: { status, code: input.code } });
  }
}

export async function verifyAccount(db: Db, input: { organizationId: string; channelAccountId: string; actorUserId: string; deps?: SocialConnectionDeps }): Promise<SocialAccountView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageConnectionsAuthority(db, ctx, "marketing_channel_account", input.channelAccountId);
  const account = await resolveAccount(db, input.organizationId, input.channelAccountId);
  if (account.archivedAt) throw new SocialAccountNotConnectedError("archived");
  if (!account.integrationConnectionId || !account.externalAccountId || account.connectionStatus === "disconnected") throw new SocialAccountNotConnectedError(account.connectionStatus);
  const connection = await resolveSocialConnection(db, input.organizationId, account.integrationConnectionId);
  if (connection.disconnectedAt) throw new SocialAccountNotConnectedError("disconnected");
  const env = providerEnv(input.deps);
  const provider = connection.provider as SocialProviderId;
  const adapter = resolveSocialProviderAdapter(provider, env, adapterDeps(input.deps));
  const now = clock(input.deps);

  let bundle: StoredSocialTokenBundle;
  try {
    bundle = await readActiveBundle(db, input.organizationId, connection.id);
  } catch (err) {
    if (!(err instanceof SocialCredentialMissingError)) throw err;
    const [row] = await db
      .update(marketingChannelAccounts)
      .set({ connectionStatus: "authorization_required", lastErrorCode: "credential_missing", lastErrorMessage: "No stored authorization — reconnect the account", lastErrorAt: now, revision: account.revision + 1, updatedAt: now })
      .where(and(eq(marketingChannelAccounts.id, account.id), eq(marketingChannelAccounts.organizationId, input.organizationId)))
      .returning();
    return viewFor(db, row, env);
  }

  let status: SocialAccountConnectionStatus;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let tokenExpiresAt: Date | null = account.tokenExpiresAt;
  let scopes: string[] | null = null;
  try {
    if (bundle.refreshToken && bundle.expiresAt && new Date(bundle.expiresAt).getTime() <= now.getTime() && adapter.refresh) {
      await refreshConnectionToken(db, { organizationId: input.organizationId, connectionId: connection.id, deps: input.deps });
      bundle = await readActiveBundle(db, input.organizationId, connection.id);
    }
    const result = await adapter.verify({ bundle, externalAccountId: account.externalAccountId, platform: account.platform as SocialPlatform });
    if (result.ok) {
      status = "connected";
      if (result.tokenExpiresAt) tokenExpiresAt = new Date(result.tokenExpiresAt);
      if (result.scopes?.length) scopes = result.scopes;
      if (tokenExpiresAt && tokenExpiresAt.getTime() <= now.getTime()) {
        status = "token_expired";
        errorCode = "token_expired";
        errorMessage = "The stored authorization has expired — reconnect the account";
      }
    } else if (result.authorizationLost) {
      status = "authorization_required";
      errorCode = "authorization_lost";
      errorMessage = result.detail;
    } else {
      status = "error";
      errorCode = "verify_failed";
      errorMessage = result.detail;
    }
  } catch (err) {
    if (err instanceof SocialProviderError) {
      status = err.authorizationLost ? (err.code === "token_expired" ? "token_expired" : "authorization_required") : "error";
      errorCode = err.code;
      errorMessage = err.message;
    } else throw err;
  }

  const [row] = await db
    .update(marketingChannelAccounts)
    .set({
      connectionStatus: status,
      tokenExpiresAt,
      ...(scopes ? { scopes } : {}),
      lastErrorCode: errorCode,
      lastErrorMessage: errorMessage ? sanitizeMessage(errorMessage) : null,
      lastErrorAt: errorCode ? now : null,
      ...(status === "connected" ? { lastSyncAt: now } : {}),
      revision: account.revision + 1,
      updatedAt: now,
    })
    .where(and(eq(marketingChannelAccounts.id, account.id), eq(marketingChannelAccounts.organizationId, input.organizationId)))
    .returning();
  if (status === "connected") {
    await db.update(integrationConnections).set({ lastVerifiedAt: now, status: "connected", updatedAt: now }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, input.organizationId)));
  }
  await recordAuditEvent(db, { eventType: "social_account_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_channel_account", targetId: account.id, metadata: { action: "verify", status, code: errorCode } });
  return viewFor(db, row, env);
}

export async function disconnectConnection(db: Db, input: { organizationId: string; connectionId: string; actorUserId: string; expectedRevision: number }): Promise<SocialConnectionView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageConnectionsAuthority(db, ctx, "integration_connection", input.connectionId);
  await resolveSocialConnection(db, input.organizationId, input.connectionId);
  const now = new Date();
  const [row] = await db
    .update(integrationConnections)
    .set({ status: "disconnected", disconnectedAt: now, revision: input.expectedRevision + 1, updatedAt: now })
    .where(and(eq(integrationConnections.id, input.connectionId), eq(integrationConnections.organizationId, input.organizationId), eq(integrationConnections.revision, input.expectedRevision)))
    .returning();
  if (!row) throw new StaleSocialUpdateError("connection");
  await db
    .update(integrationCredentials)
    .set({ revokedAt: now, revokedByUserId: input.actorUserId })
    .where(and(eq(integrationCredentials.connectionId, input.connectionId), eq(integrationCredentials.organizationId, input.organizationId), isNull(integrationCredentials.revokedAt)));
  const linked = await db
    .update(marketingChannelAccounts)
    .set({ connectionStatus: "disconnected", updatedAt: now })
    .where(and(eq(marketingChannelAccounts.integrationConnectionId, input.connectionId), eq(marketingChannelAccounts.organizationId, input.organizationId)))
    .returning({ id: marketingChannelAccounts.id });
  await recordAuditEvent(db, { eventType: "social_connection_disconnected", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "integration_connection", targetId: input.connectionId, metadata: { provider: row.provider, accountCount: linked.length } });
  return toConnectionView(row, linked.length);
}

export async function refreshConnectionToken(db: Db, input: { organizationId: string; connectionId: string; deps?: SocialConnectionDeps }): Promise<{ refreshed: boolean; expiresAt: string | null }> {
  const connection = await resolveSocialConnection(db, input.organizationId, input.connectionId);
  if (connection.disconnectedAt) throw new SocialAccountNotConnectedError("disconnected");
  const provider = connection.provider as SocialProviderId;
  const bundle = await readActiveBundle(db, input.organizationId, connection.id);
  const adapter = resolveSocialProviderAdapter(provider, providerEnv(input.deps), adapterDeps(input.deps));
  if (!adapter.refresh || !bundle.refreshToken) return { refreshed: false, expiresAt: bundle.expiresAt ?? null };
  const now = clock(input.deps);
  const accounts = await db
    .select()
    .from(marketingChannelAccounts)
    .where(and(eq(marketingChannelAccounts.integrationConnectionId, connection.id), eq(marketingChannelAccounts.organizationId, input.organizationId), isNull(marketingChannelAccounts.archivedAt)));

  let next: StoredSocialTokenBundle;
  try {
    next = (await adapter.refresh(bundle)) as StoredSocialTokenBundle;
  } catch (err) {
    if (err instanceof SocialProviderError && err.authorizationLost) {
      await markAccountsAuthState(db, { organizationId: input.organizationId, accounts: accounts.filter((a) => a.connectionStatus === "connected"), status: "authorization_required", code: err.code, message: err.message, provider, now });
    }
    throw err;
  }
  const merged: StoredSocialTokenBundle = { ...bundle, ...next, assets: next.assets ?? bundle.assets, principal: next.principal ?? bundle.principal };
  await storeSocialCredential(db, { organizationId: input.organizationId, connectionId: connection.id, bundle: merged, actorUserId: null, audit: false });
  for (const account of accounts) {
    if (!account.externalAccountId) continue;
    const restore = account.connectionStatus === "token_expired";
    await db
      .update(marketingChannelAccounts)
      .set({ tokenExpiresAt: authorizationExpiry(merged, account.externalAccountId), ...(restore ? { connectionStatus: "connected", lastErrorCode: null, lastErrorMessage: null, lastErrorAt: null } : {}), revision: account.revision + 1, updatedAt: now })
      .where(and(eq(marketingChannelAccounts.id, account.id), eq(marketingChannelAccounts.organizationId, input.organizationId)));
  }
  await db.update(integrationConnections).set({ lastVerifiedAt: now, updatedAt: now }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, input.organizationId)));
  await recordAuditEvent(db, { eventType: "social_connection_token_refreshed", organizationId: input.organizationId, targetType: "integration_connection", targetId: connection.id, metadata: { provider, expiresAt: merged.expiresAt ?? null } });
  return { refreshed: true, expiresAt: merged.expiresAt ?? null };
}

export type WatchConnectionTokensResult = {
  checked: number;
  expired: number;
  refreshed: number;
  failed: number;
  expiringSoon: { accountId: string; displayName: string; tokenExpiresAt: string }[];
};

/** Worker entry (`social_token_watch`): flags expired grants, refreshes refreshable ones nearing expiry, reports the rest. */
export async function watchConnectionTokens(db: Db, input: { organizationId: string; deps?: SocialConnectionDeps }): Promise<WatchConnectionTokensResult> {
  const now = clock(input.deps);
  const accounts = await db
    .select()
    .from(marketingChannelAccounts)
    .where(and(eq(marketingChannelAccounts.organizationId, input.organizationId), eq(marketingChannelAccounts.connectionStatus, "connected"), isNull(marketingChannelAccounts.archivedAt)));
  let expired = 0;
  let refreshed = 0;
  let failed = 0;
  const soon: AccountRow[] = [];
  for (const account of accounts) {
    if (!account.tokenExpiresAt) continue;
    if (account.tokenExpiresAt.getTime() <= now.getTime()) {
      const [connection] = account.integrationConnectionId ? await db.select({ provider: integrationConnections.provider }).from(integrationConnections).where(and(eq(integrationConnections.id, account.integrationConnectionId), eq(integrationConnections.organizationId, input.organizationId))) : [];
      await markAccountsAuthState(db, { organizationId: input.organizationId, accounts: [account], status: "token_expired", code: "token_expired", message: "The stored authorization has expired — reconnect the account", provider: connection?.provider ?? "unknown", now });
      expired++;
    } else if (account.tokenExpiresAt.getTime() - now.getTime() <= EXPIRY_WARNING_MS) {
      soon.push(account);
    }
  }

  const connectionIds = [...new Set(soon.map((a) => a.integrationConnectionId).filter((id): id is string => Boolean(id)))];
  for (const connectionId of connectionIds) {
    try {
      const res = await refreshConnectionToken(db, { organizationId: input.organizationId, connectionId, deps: input.deps });
      if (res.refreshed) refreshed++;
    } catch {
      failed++;
    }
  }

  const expiringSoon: WatchConnectionTokensResult["expiringSoon"] = [];
  if (soon.length) {
    const rows = await db
      .select()
      .from(marketingChannelAccounts)
      .where(and(eq(marketingChannelAccounts.organizationId, input.organizationId), inArray(marketingChannelAccounts.id, soon.map((a) => a.id))));
    for (const r of rows) {
      if (r.connectionStatus === "connected" && r.tokenExpiresAt && r.tokenExpiresAt.getTime() - now.getTime() <= EXPIRY_WARNING_MS) {
        expiringSoon.push({ accountId: r.id, displayName: r.displayName, tokenExpiresAt: r.tokenExpiresAt.toISOString() });
      }
    }
  }
  return { checked: accounts.length, expired, refreshed, failed, expiringSoon };
}

// ---------------------------------------------------------------------------
// Account management (user-facing)
// ---------------------------------------------------------------------------

export async function listAccountsForBrand(db: Db, input: { organizationId: string; brandProfileId: string; actorUserId: string; includeArchived?: boolean }): Promise<SocialAccountView[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_brand_profile", input.brandProfileId);
  await resolveBrandById(db, input.organizationId, input.brandProfileId);
  const conditions = [eq(marketingChannelAccounts.organizationId, input.organizationId), eq(marketingChannelAccounts.brandProfileId, input.brandProfileId)];
  if (!input.includeArchived) conditions.push(isNull(marketingChannelAccounts.archivedAt));
  const rows = await db.select().from(marketingChannelAccounts).where(and(...conditions)).orderBy(marketingChannelAccounts.platform, marketingChannelAccounts.displayName);
  return viewsFor(db, input.organizationId, rows, providerEnv());
}

export async function getAccountForUser(db: Db, input: { organizationId: string; channelAccountId: string; actorUserId: string }): Promise<SocialAccountView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_channel_account", input.channelAccountId);
  const row = await resolveAccount(db, input.organizationId, input.channelAccountId);
  return viewFor(db, row, providerEnv());
}

export const socialAccountUpdateSchema = z
  .object({
    brandProfileId: z.string().uuid().optional(),
    displayName: z.string().trim().min(1).max(200).optional(),
    handle: z.string().trim().max(200).nullable().optional(),
    externalUrl: z.string().trim().url().max(2000).nullable().optional(),
  })
  .strict();
export type SocialAccountUpdate = z.infer<typeof socialAccountUpdateSchema>;

export async function updateAccount(db: Db, input: { organizationId: string; channelAccountId: string; actorUserId: string; expectedRevision: number; changes: SocialAccountUpdate }): Promise<SocialAccountView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageConnectionsAuthority(db, ctx, "marketing_channel_account", input.channelAccountId);
  const changes = socialAccountUpdateSchema.parse(input.changes);
  const account = await resolveAccount(db, input.organizationId, input.channelAccountId);
  if (account.archivedAt) throw new SocialAccountNotConnectedError("archived");
  if (changes.brandProfileId && changes.brandProfileId !== account.brandProfileId) await requireActiveBrand(db, input.organizationId, changes.brandProfileId);
  const set: Partial<typeof marketingChannelAccounts.$inferInsert> = {};
  if (changes.brandProfileId !== undefined) set.brandProfileId = changes.brandProfileId;
  if (changes.displayName !== undefined) set.displayName = changes.displayName;
  if (changes.handle !== undefined) set.handle = changes.handle || null;
  if (changes.externalUrl !== undefined) set.externalUrl = changes.externalUrl || null;
  let row: AccountRow | undefined;
  try {
    [row] = await db
      .update(marketingChannelAccounts)
      .set({ ...set, revision: input.expectedRevision + 1, updatedAt: new Date() })
      .where(and(eq(marketingChannelAccounts.id, account.id), eq(marketingChannelAccounts.organizationId, input.organizationId), eq(marketingChannelAccounts.revision, input.expectedRevision)))
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new SocialAccountNameTakenError();
    throw err;
  }
  if (!row) throw new StaleSocialUpdateError("account");
  await recordAuditEvent(db, { eventType: "social_account_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_channel_account", targetId: row.id, metadata: { fields: Object.keys(changes) } });
  return viewFor(db, row, providerEnv());
}

export async function archiveAccount(db: Db, input: { organizationId: string; channelAccountId: string; actorUserId: string; expectedRevision: number }): Promise<SocialAccountView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageConnectionsAuthority(db, ctx, "marketing_channel_account", input.channelAccountId);
  const account = await resolveAccount(db, input.organizationId, input.channelAccountId);
  if (account.archivedAt) return viewFor(db, account, providerEnv());
  const now = new Date();
  const [row] = await db
    .update(marketingChannelAccounts)
    .set({ archivedAt: now, revision: input.expectedRevision + 1, updatedAt: now })
    .where(and(eq(marketingChannelAccounts.id, account.id), eq(marketingChannelAccounts.organizationId, input.organizationId), eq(marketingChannelAccounts.revision, input.expectedRevision)))
    .returning();
  if (!row) throw new StaleSocialUpdateError("account");
  await recordAuditEvent(db, { eventType: "social_account_archived", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_channel_account", targetId: row.id, metadata: { platform: row.platform } });
  return viewFor(db, row, providerEnv());
}

export async function createManualAccount(
  db: Db,
  input: { organizationId: string; brandProfileId: string; platform: SocialPlatform; displayName: string; handle?: string | null; externalUrl?: string | null; actorUserId: string },
): Promise<SocialAccountView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageConnectionsAuthority(db, ctx, "marketing_channel_account", "new");
  const platform = socialPlatformSchema.parse(input.platform);
  const displayName = z.string().trim().min(1).max(200).parse(input.displayName);
  const handle = input.handle ? z.string().trim().max(200).parse(input.handle) : null;
  const externalUrl = input.externalUrl ? z.string().trim().url().max(2000).parse(input.externalUrl) : null;
  await requireActiveBrand(db, input.organizationId, input.brandProfileId);
  let row: AccountRow;
  try {
    [row] = await db
      .insert(marketingChannelAccounts)
      .values({ organizationId: input.organizationId, brandProfileId: input.brandProfileId, platform, accountKind: isAdPlatform(platform) ? "paid" : "organic", displayName, handle, externalUrl, connectionStatus: "manual", ownerUserId: input.actorUserId })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new SocialAccountNameTakenError();
    throw err;
  }
  await recordAuditEvent(db, { eventType: "social_account_linked", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_channel_account", targetId: row.id, metadata: { platform, manual: true } });
  return viewFor(db, row, providerEnv());
}
