import { describe, it, expect, afterEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { auditLogs, integrationConnections, integrationCredentials, marketingChannelAccounts, communicationProviderEvents, runtimeJobs } from "@/db/schema";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";
import { decryptCredentialSecret } from "@/lib/communications-os/secrets";
import { db, makeSocialOrg, makeManualAccount, makeConnectedAccount, makeMarketingUser, cleanupAgentRuntimeTestData, ensureTestEncryptionKey, fakeFetch } from "./test-helpers";
import {
  beginConnection,
  completeConnection,
  resolveSocialAccountCredential,
  describeConnectionCenter,
  disconnectConnection,
  getAccountForUser,
  watchConnectionTokens,
  verifyAccount,
  createManualAccount,
  updateAccount,
  archiveAccount,
  listAccountsForBrand,
  SocialAccountNameTakenError,
} from "./connections";
import { handleMetaWebhookEvent } from "./webhooks";
import { SocialProviderNotConfiguredError, SocialTokenExpiredError, SocialAccountNotConnectedError, StaleSocialUpdateError } from "./errors";

const META_ENV = { META_APP_ID: "test-app", META_APP_SECRET: "test-app-secret", META_GRAPH_API_VERSION: "v25.0" };
const LINKEDIN_ENV = { LINKEDIN_CLIENT_ID: "li-client", LINKEDIN_CLIENT_SECRET: "li-secret" };

function metaGraphFake(pageId: string, igId: string) {
  return fakeFetch([
    { match: (u) => u.includes("/oauth/access_token") && u.includes("fb_exchange_token="), respond: () => ({ json: { access_token: "LONG_USER_TOKEN_SECRET", expires_in: 5184000 } }) },
    { match: (u) => u.includes("/oauth/access_token") && u.includes("code="), respond: () => ({ json: { access_token: "SHORT_TOKEN" } }) },
    { match: (u) => u.includes("/me?fields=id,name"), respond: () => ({ json: { id: "fb-user-1", name: "Owner Person" } }) },
    { match: (u) => u.includes("/debug_token"), respond: () => ({ json: { data: { is_valid: true, expires_at: Math.floor(Date.now() / 1000) + 50 * 86400, scopes: ["pages_show_list", "instagram_basic"] } } }) },
    { match: (u) => u.includes("/me/accounts"), respond: () => ({ json: { data: [{ id: pageId, name: "Lynq Page", access_token: "PAGE_TOKEN_SECRET", category: "Agency" }] } }) },
    { match: (u) => u.includes(`/${pageId}?`) && u.includes("instagram_business_account"), respond: () => ({ json: { instagram_business_account: { id: igId, username: "lynq.build", followers_count: 10 } } }) },
    { match: (u) => u.includes("/me/adaccounts"), respond: () => ({ json: { data: [] } }) },
    { match: (u) => u.includes(`/${pageId}?fields=id%2Cname`), respond: () => ({ json: { id: pageId, name: "Lynq Page" } }) },
  ]);
}

describe("Connection Center (integration)", () => {
  afterEach(cleanupAgentRuntimeTestData);

  it("completes a Meta connection end to end: encrypted bundle, linked accounts, decryptable credential", async () => {
    ensureTestEncryptionKey();
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const pageId = `p${Date.now()}`;
    const igId = `ig${Date.now()}`;
    const manual = await makeManualAccount(orgId, brand.id, "facebook", "Lynq Page");
    const { fetchImpl } = metaGraphFake(pageId, igId);

    const result = await completeConnection(db, { organizationId: orgId, brandProfileId: brand.id, provider: "meta", actorUserId: ownerId, code: "auth-code", deps: { fetchImpl, env: META_ENV } });
    expect(result.accounts.map((a) => a.platform).sort()).toEqual(["facebook", "instagram"]);
    const fb = result.accounts.find((a) => a.platform === "facebook")!;
    expect(fb.id).toBe(manual.id); // linked, not duplicated
    expect(fb).toMatchObject({ connectionStatus: "connected", externalAccountId: pageId, canPublish: true, canReadInsights: true, canReadEngagement: true, canManageAds: false, tokenExpiresAt: null });
    const ig = result.accounts.find((a) => a.platform === "instagram")!;
    expect(ig.handle).toBe("@lynq.build");

    const [connection] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, result.connectionId));
    expect(connection).toMatchObject({ provider: "meta", integrationType: "social", status: "connected", externalAccountId: "fb-user-1", connectedByUserId: ownerId });
    expect(connection.scopesMetadata).toEqual(["pages_show_list", "instagram_basic"]);

    const creds = await db.select().from(integrationCredentials).where(and(eq(integrationCredentials.connectionId, result.connectionId), isNull(integrationCredentials.revokedAt)));
    expect(creds).toHaveLength(1);
    expect(creds[0].ciphertext).not.toContain("PAGE_TOKEN_SECRET");
    const bundle = JSON.parse(decryptCredentialSecret(process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY, creds[0]));
    expect(bundle.accessToken).toBe("LONG_USER_TOKEN_SECRET");
    expect(bundle.assets[pageId].accessToken).toBe("PAGE_TOKEN_SECRET");

    const resolved = await resolveSocialAccountCredential(db, { organizationId: orgId, channelAccountId: fb.id });
    expect(resolved.provider).toBe("meta");
    expect(resolved.credential).toMatchObject({ externalAccountId: pageId, platform: "facebook" });
    expect(resolved.credential.bundle.assets?.[pageId]?.accessToken).toBe("PAGE_TOKEN_SECRET");

    // Reconnecting reuses the grant row and rotates the credential.
    const again = await completeConnection(db, { organizationId: orgId, brandProfileId: brand.id, provider: "meta", actorUserId: ownerId, code: "auth-code-2", deps: { fetchImpl: metaGraphFake(pageId, igId).fetchImpl, env: META_ENV } });
    expect(again.connectionId).toBe(result.connectionId);
    const allCreds = await db.select().from(integrationCredentials).where(eq(integrationCredentials.connectionId, result.connectionId));
    expect(allCreds.filter((c) => !c.revokedAt)).toHaveLength(1);
    expect(allCreds).toHaveLength(2);

    const center = await describeConnectionCenter(db, { organizationId: orgId, actorUserId: ownerId, deps: { env: META_ENV } });
    expect(center.providers.find((p) => p.provider === "meta")).toMatchObject({ configured: true, missing: [] });
    expect(center.providers.find((p) => p.provider === "linkedin")).toMatchObject({ configured: false, missing: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"] });
    expect(center.connections.find((c) => c.id === result.connectionId)?.accountCount).toBe(2);
    expect(JSON.stringify(center)).not.toContain("TOKEN_SECRET");

    const verified = await verifyAccount(db, { organizationId: orgId, channelAccountId: fb.id, actorUserId: ownerId, deps: { fetchImpl: metaGraphFake(pageId, igId).fetchImpl, env: META_ENV } });
    expect(verified.connectionStatus).toBe("connected");
    expect(verified.lastSyncAt).not.toBeNull();

    const audits = await db.select({ eventType: auditLogs.eventType }).from(auditLogs).where(eq(auditLogs.organizationId, orgId));
    expect(audits.map((a) => a.eventType)).toEqual(expect.arrayContaining(["social_connection_completed", "social_account_linked"]));
  });

  it("audits and rethrows provider failures during the code exchange", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const { fetchImpl } = fakeFetch([{ match: () => true, respond: () => ({ status: 400, json: { error: { message: "Invalid verification code format.", type: "OAuthException", code: 100 } } }) }]);
    await expect(completeConnection(db, { organizationId: orgId, brandProfileId: brand.id, provider: "meta", actorUserId: ownerId, code: "bad", deps: { fetchImpl, env: META_ENV } })).rejects.toMatchObject({ code: "meta_100", retryable: false });
    const [failed] = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, orgId), eq(auditLogs.eventType, "social_connection_failed")));
    expect(failed.metadata).toMatchObject({ provider: "meta", code: "meta_100" });
  });

  it("beginConnection builds the consent URL; viewers/contributors are denied; missing config is honest", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const started = await beginConnection(db, { organizationId: orgId, brandProfileId: brand.id, provider: "meta", actorUserId: ownerId, redirectTo: "/app/x/social", deps: { env: META_ENV } });
    const url = new URL(started.authorizationUrl);
    expect(url.searchParams.get("state")).toBe(started.cookiePayload.state);
    expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/social\/oauth\/meta\/callback$/);
    expect(started.cookiePayload).toMatchObject({ organizationId: orgId, brandProfileId: brand.id, actorUserId: ownerId, redirectTo: "/app/x/social", provider: "meta" });
    const unsafe = await beginConnection(db, { organizationId: orgId, brandProfileId: brand.id, provider: "meta", actorUserId: ownerId, redirectTo: "https://evil.example", deps: { env: META_ENV } });
    expect(unsafe.cookiePayload.redirectTo).toBe("/");

    await expect(beginConnection(db, { organizationId: orgId, brandProfileId: brand.id, provider: "linkedin", actorUserId: ownerId, redirectTo: "/", deps: { env: {} } })).rejects.toBeInstanceOf(SocialProviderNotConfiguredError);

    const viewer = await makeMarketingUser(orgId, "viewer", ownerId);
    const contributor = await makeMarketingUser(orgId, "marketing_contributor", ownerId);
    for (const actorUserId of [viewer, contributor]) {
      await expect(beginConnection(db, { organizationId: orgId, brandProfileId: brand.id, provider: "meta", actorUserId, redirectTo: "/", deps: { env: META_ENV } })).rejects.toBeInstanceOf(InsufficientRoleError);
    }
    // viewers can still see the Connection Center
    await expect(describeConnectionCenter(db, { organizationId: orgId, actorUserId: viewer })).resolves.toBeTruthy();
  });

  it("an expired authorization marks the account token_expired and refuses the credential", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const { account } = await makeConnectedAccount(orgId, brand.id, "instagram", { tokenExpiresAt: new Date(Date.now() - 60_000), connectedByUserId: ownerId });
    await expect(resolveSocialAccountCredential(db, { organizationId: orgId, channelAccountId: account.id })).rejects.toBeInstanceOf(SocialTokenExpiredError);
    const [row] = await db.select().from(marketingChannelAccounts).where(eq(marketingChannelAccounts.id, account.id));
    expect(row.connectionStatus).toBe("token_expired");
    await expect(resolveSocialAccountCredential(db, { organizationId: orgId, channelAccountId: account.id })).rejects.toBeInstanceOf(SocialAccountNotConnectedError);
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, orgId), eq(auditLogs.eventType, "social_connection_token_expired")));
    expect(audit.targetId).toBe(account.id);
  });

  it("cross-tenant ids 404", async () => {
    const a = await makeSocialOrg();
    const b = await makeSocialOrg();
    const { account, connection } = await makeConnectedAccount(a.orgId, a.brand.id, "facebook");
    await expect(getAccountForUser(db, { organizationId: b.orgId, channelAccountId: account.id, actorUserId: b.ownerId })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    await expect(resolveSocialAccountCredential(db, { organizationId: b.orgId, channelAccountId: account.id })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    await expect(disconnectConnection(db, { organizationId: b.orgId, connectionId: connection.id, actorUserId: b.ownerId, expectedRevision: 1 })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    await expect(listAccountsForBrand(db, { organizationId: b.orgId, brandProfileId: a.brand.id, actorUserId: b.ownerId })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("disconnect revokes the credential and keeps the accounts as disconnected; stale revision is refused", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const { account, connection } = await makeConnectedAccount(orgId, brand.id, "linkedin");
    await expect(disconnectConnection(db, { organizationId: orgId, connectionId: connection.id, actorUserId: ownerId, expectedRevision: 99 })).rejects.toBeInstanceOf(StaleSocialUpdateError);
    const view = await disconnectConnection(db, { organizationId: orgId, connectionId: connection.id, actorUserId: ownerId, expectedRevision: connection.revision });
    expect(view).toMatchObject({ status: "disconnected", accountCount: 1 });
    const creds = await db.select().from(integrationCredentials).where(eq(integrationCredentials.connectionId, connection.id));
    expect(creds.every((c) => c.revokedAt !== null)).toBe(true);
    const [row] = await db.select().from(marketingChannelAccounts).where(eq(marketingChannelAccounts.id, account.id));
    expect(row.connectionStatus).toBe("disconnected");
    expect(row.archivedAt).toBeNull();
    await expect(resolveSocialAccountCredential(db, { organizationId: orgId, channelAccountId: account.id })).rejects.toBeInstanceOf(SocialAccountNotConnectedError);
  });

  it("watchConnectionTokens flags expired accounts and refreshes refreshable grants nearing expiry", async () => {
    const { orgId, brand } = await makeSocialOrg();
    const expired = await makeConnectedAccount(orgId, brand.id, "facebook", { tokenExpiresAt: new Date(Date.now() - 1000) });
    const soonNoRefresh = await makeConnectedAccount(orgId, brand.id, "instagram", { tokenExpiresAt: new Date(Date.now() + 2 * 86400_000) });
    const refreshable = await makeConnectedAccount(orgId, brand.id, "linkedin", { tokenExpiresAt: new Date(Date.now() + 3 * 86400_000), bundle: { accessToken: "OLD", refreshToken: "RT", expiresAt: new Date(Date.now() + 3 * 86400_000).toISOString(), assets: {} } });
    const fine = await makeConnectedAccount(orgId, brand.id, "linkedin_ads", { tokenExpiresAt: new Date(Date.now() + 40 * 86400_000) });
    const { fetchImpl, calls } = fakeFetch([{ match: (u) => u.includes("linkedin.com/oauth/v2/accessToken"), respond: () => ({ json: { access_token: "NEW_ACCESS", expires_in: 5184000, refresh_token: "RT2", refresh_token_expires_in: 300 * 86400 } }) }]);

    const res = await watchConnectionTokens(db, { organizationId: orgId, deps: { fetchImpl, env: LINKEDIN_ENV } });
    expect(res).toMatchObject({ checked: 4, expired: 1, refreshed: 1, failed: 0 });
    expect(res.expiringSoon.map((e) => e.accountId)).toEqual([soonNoRefresh.account.id]);
    expect(calls).toHaveLength(1);

    const [e] = await db.select().from(marketingChannelAccounts).where(eq(marketingChannelAccounts.id, expired.account.id));
    expect(e.connectionStatus).toBe("token_expired");
    const [r] = await db.select().from(marketingChannelAccounts).where(eq(marketingChannelAccounts.id, refreshable.account.id));
    expect(r.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 200 * 86400_000);
    const resolved = await resolveSocialAccountCredential(db, { organizationId: orgId, channelAccountId: refreshable.account.id });
    expect(resolved.credential.bundle).toMatchObject({ accessToken: "NEW_ACCESS", refreshToken: "RT2" });
    const [f] = await db.select().from(marketingChannelAccounts).where(eq(marketingChannelAccounts.id, fine.account.id));
    expect(f.connectionStatus).toBe("connected");
  });

  it("verify records a lost authorization honestly", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const { account } = await makeConnectedAccount(orgId, brand.id, "facebook");
    const { fetchImpl } = fakeFetch([{ match: () => true, respond: () => ({ status: 400, json: { error: { message: "Error validating access token", type: "OAuthException", code: 190 } } }) }]);
    const view = await verifyAccount(db, { organizationId: orgId, channelAccountId: account.id, actorUserId: ownerId, deps: { fetchImpl, env: META_ENV } });
    expect(view).toMatchObject({ connectionStatus: "authorization_required", lastErrorCode: "authorization_lost", canPublish: false });
  });

  it("manual accounts: create, duplicate name refused, update with CAS, archive", async () => {
    const { orgId, ownerId, brand } = await makeSocialOrg();
    const created = await createManualAccount(db, { organizationId: orgId, brandProfileId: brand.id, platform: "tiktok", displayName: "Lynq TikTok", handle: "@lynq", actorUserId: ownerId });
    expect(created).toMatchObject({ connectionStatus: "manual", supported: false, canPublish: false, provider: null });
    await expect(createManualAccount(db, { organizationId: orgId, brandProfileId: brand.id, platform: "tiktok", displayName: "Lynq TikTok", actorUserId: ownerId })).rejects.toBeInstanceOf(SocialAccountNameTakenError);
    const updated = await updateAccount(db, { organizationId: orgId, channelAccountId: created.id, actorUserId: ownerId, expectedRevision: created.revision, changes: { displayName: "LYNQ on TikTok" } });
    expect(updated.displayName).toBe("LYNQ on TikTok");
    await expect(updateAccount(db, { organizationId: orgId, channelAccountId: created.id, actorUserId: ownerId, expectedRevision: created.revision, changes: { handle: "@x" } })).rejects.toBeInstanceOf(StaleSocialUpdateError);
    const archived = await archiveAccount(db, { organizationId: orgId, channelAccountId: created.id, actorUserId: ownerId, expectedRevision: updated.revision });
    expect(archived.archivedAt).not.toBeNull();
    expect((await listAccountsForBrand(db, { organizationId: orgId, brandProfileId: brand.id, actorUserId: ownerId })).map((a) => a.id)).not.toContain(created.id);
  });

  it("Meta webhooks dedupe and enqueue one engagement sync per account", async () => {
    const { orgId, brand } = await makeSocialOrg();
    const pageId = `page-${Date.now()}`;
    const { account, connection } = await makeConnectedAccount(orgId, brand.id, "facebook", { externalAccountId: pageId });
    const payload = { object: "page", entry: [{ id: pageId, time: 1727800000, changes: [{ field: "feed", value: { item: "comment", comment_id: "c-1", verb: "add" } }, { field: "feed", value: { item: "like", verb: "add" } }] }] };
    const first = await handleMetaWebhookEvent(db, { rawPayload: JSON.stringify(payload) });
    expect(first).toEqual({ received: 2, enqueued: 1, duplicates: 0, ignored: 1 });
    const second = await handleMetaWebhookEvent(db, { rawPayload: payload });
    expect(second).toMatchObject({ enqueued: 0, duplicates: 1 });
    const events = await db.select().from(communicationProviderEvents).where(eq(communicationProviderEvents.connectionId, connection.id));
    expect(events).toHaveLength(1);
    const jobs = await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.organizationId, orgId), eq(runtimeJobs.jobType, "social_engagement_sync")));
    expect(jobs.map((j) => j.idempotencyKey)).toEqual([`social_engagement_sync:${account.id}`]);
    await db.delete(communicationProviderEvents).where(eq(communicationProviderEvents.connectionId, connection.id));
  });
});
