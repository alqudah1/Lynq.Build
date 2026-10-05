import type { SocialPlatform, SocialOrganicPlatform, SocialVariantFormat } from "../../validation";

/**
 * Module 19 — the provider adapter contract for social platforms. One
 * adapter per OAuth provider (`meta`, `linkedin`, `google_ads`); each
 * adapter may serve several platforms (Meta → facebook, instagram,
 * meta_ads). Adapters are pure HTTP clients over official APIs: they take
 * decrypted credentials as arguments, never read the database, never log a
 * token, and translate provider errors into `SocialProviderError` with an
 * honest `retryable` / `authorizationLost` classification.
 *
 * Every optional method is a capability the Connection Center can display
 * as "not supported" when absent.
 */

export type SocialProviderId = "meta" | "linkedin" | "google_ads";

/** What is stored (encrypted) on an `integration_credentials` row for a social connection. */
export interface SocialTokenBundle {
  accessToken: string;
  refreshToken?: string;
  /** ISO timestamp; absent when the provider says the token does not expire. */
  expiresAt?: string;
  tokenType?: string;
  scopes: string[];
  /** Per-asset tokens (Meta Page tokens) keyed by external account id. */
  assets?: Record<string, { accessToken: string; expiresAt?: string }>;
  /** Non-secret provider identity of the granting user/member. */
  principal?: { externalId: string; name?: string };
}

/** Credential handed to adapter methods — the bundle plus which asset we are acting as. */
export interface SocialAccountCredential {
  bundle: SocialTokenBundle;
  externalAccountId: string;
  platform: SocialPlatform;
}

export interface DiscoveredAsset {
  platform: SocialPlatform;
  externalAccountId: string;
  displayName: string;
  handle?: string;
  externalUrl?: string;
  accountKind: "organic" | "paid";
  /** Non-secret metadata surfaced in the UI (category, currency, follower count at discovery…). */
  metadata: Record<string, string | number | boolean | null>;
  /** Asset-level token when the provider issues one (Meta Pages). Never persisted outside the encrypted bundle. */
  accessToken?: string;
  tokenExpiresAt?: string;
}

export interface VerifyResult {
  ok: boolean;
  /** Provider-reported identity of the authorization (e.g. page name) — never a token. */
  detail: string;
  tokenExpiresAt?: string;
  scopes?: string[];
  authorizationLost?: boolean;
}

export interface PublishMediaInput {
  assetId: string;
  /** Publicly fetchable URL the provider can pull from (signed/temporary is fine), or bytes for upload-based APIs. */
  url?: string;
  bytes?: Uint8Array;
  contentType: string;
  role: "primary" | "carousel_item" | "cover" | "thumbnail";
  position: number;
  altText?: string;
}

export interface PublishInput {
  platform: SocialOrganicPlatform;
  format: SocialVariantFormat;
  body: string;
  hashtags: string[];
  linkUrl?: string | null;
  media: PublishMediaInput[];
  platformOptions: Record<string, unknown>;
  /** Our idempotency key — adapters that support request idempotency pass it through. */
  idempotencyKey: string;
  /** Resumable provider state from a previous attempt (e.g. Instagram container id). */
  providerState: Record<string, unknown>;
  /** For platforms with native scheduling (Facebook Pages) — otherwise the queue already waited. */
  scheduledFor?: Date | null;
}

export interface PublishResult {
  outcome: "published" | "scheduled_natively" | "pending";
  externalPostId: string;
  externalPostUrl?: string;
  /** Updated resumable state to persist (cleared on success by the caller). */
  providerState?: Record<string, unknown>;
}

export interface AccountInsights {
  periodStart: Date;
  periodEnd: Date;
  followers?: number;
  reach?: number;
  impressions?: number;
  views?: number;
  engagements?: number;
  profileViews?: number;
  websiteClicks?: number;
  /** Anything else the provider returned, by its own metric name. */
  extra: Record<string, number>;
}

export interface PostInsights {
  externalPostId: string;
  impressions?: number;
  reach?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  extra: Record<string, number>;
}

export interface FetchedEngagementItem {
  itemType: "comment" | "mention" | "direct_message" | "review";
  externalId: string;
  externalParentId?: string | null;
  externalPostId?: string | null;
  externalUrl?: string | null;
  authorExternalId?: string | null;
  authorName?: string | null;
  authorHandle?: string | null;
  text: string;
  postedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface AdCampaignRecord {
  externalCampaignId: string;
  name: string;
  status: string;
  objective?: string | null;
  currency: string;
  dailyBudgetMinor?: number | null;
  lifetimeBudgetMinor?: number | null;
  periodStart: Date;
  periodEnd: Date;
  spendMinor?: number | null;
  impressions?: number | null;
  clicks?: number | null;
  reach?: number | null;
  conversions?: number | null;
  metrics: Record<string, number | string>;
}

export interface AdChangeExecutionInput {
  changeType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

export interface AdChangeExecutionResult {
  externalIds: Record<string, string>;
  summary: string;
}

export interface SocialProviderAdapter {
  provider: SocialProviderId;
  platforms: readonly SocialPlatform[];
  /** Human-readable list of what the server is missing to use this provider (client id/secret…). Empty = configured. */
  missingConfiguration(): string[];
  /** Validate the stored authorization is still live; must never throw for a plain "revoked" — report `authorizationLost`. */
  verify(credential: SocialAccountCredential): Promise<VerifyResult>;
  /** Enumerate the assets (pages, IG accounts, ad accounts, organizations) the grant can act on. */
  discoverAssets(bundle: SocialTokenBundle): Promise<DiscoveredAsset[]>;
  /** Exchange a refresh token / long-lived token. Absent when the provider offers no programmatic refresh. */
  refresh?(bundle: SocialTokenBundle): Promise<SocialTokenBundle>;
  publish?(credential: SocialAccountCredential, input: PublishInput): Promise<PublishResult>;
  fetchAccountInsights?(credential: SocialAccountCredential, range: { since: Date; until: Date }): Promise<AccountInsights | null>;
  fetchPostInsights?(credential: SocialAccountCredential, externalPostIds: string[]): Promise<PostInsights[]>;
  fetchEngagement?(credential: SocialAccountCredential, options: { since?: Date | null; externalPostIds?: string[] }): Promise<FetchedEngagementItem[]>;
  replyToEngagement?(credential: SocialAccountCredential, item: { itemType: string; externalId: string; externalPostId?: string | null }, message: string): Promise<{ externalReplyId: string }>;
  hideEngagement?(credential: SocialAccountCredential, item: { itemType: string; externalId: string }): Promise<void>;
  listAdCampaigns?(credential: SocialAccountCredential, range: { since: Date; until: Date }): Promise<AdCampaignRecord[]>;
  executeAdChange?(credential: SocialAccountCredential, input: AdChangeExecutionInput): Promise<AdChangeExecutionResult>;
}

/** Minimal fetch abstraction so adapters are unit-testable with an injected fetch. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
