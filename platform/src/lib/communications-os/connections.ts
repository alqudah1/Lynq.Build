import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { integrationConnections, integrationCredentials } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { resolveCommunicationAuthContext, requireCommunicationsViewAuthority, requireCommunicationsManageConnectionsAuthority } from "./authz";
import { StaleCommunicationUpdateError, ConnectionNotUsableError } from "./errors";
import { encryptCredentialSecret, decryptCredentialSecret } from "./secrets";
import { resolveProviderAdapter } from "./providers/registry";
import type { IntegrationProvider, CommunicationChannel, IntegrationConnectionStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface IntegrationConnection {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  provider: IntegrationProvider;
  integrationType: CommunicationChannel;
  displayName: string;
  status: IntegrationConnectionStatus;
  externalAccountId: string | null;
  scopesMetadata: unknown;
  connectedByUserId: string | null;
  lastVerifiedAt: Date | null;
  lastSyncAt: Date | null;
  revision: number;
  disconnectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function createConnection(
  db: Db,
  input: { organizationId: string; workspaceId?: string | null; provider: IntegrationProvider; integrationType: CommunicationChannel; displayName: string; actorUserId: string }
): Promise<IntegrationConnection> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageConnectionsAuthority(db, ctx, "integration_connection", "new");

  const [row] = await db
    .insert(integrationConnections)
    .values({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId ?? null,
      provider: input.provider,
      integrationType: input.integrationType,
      displayName: input.displayName,
      connectedByUserId: input.actorUserId,
    })
    .returning();

  await recordAuditEvent(db, { eventType: "integration_connection_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "integration_connection", targetId: row.id, metadata: { provider: input.provider, integrationType: input.integrationType } });
  return row as IntegrationConnection;
}

export async function resolveConnectionById(db: Db, organizationId: string, connectionId: string): Promise<IntegrationConnection> {
  const [row] = await db.select().from(integrationConnections).where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.organizationId, organizationId)));
  if (!row) throw new TenantResourceNotFoundError();
  return row as IntegrationConnection;
}

export async function getConnectionForUser(db: Db, input: { organizationId: string; connectionId: string; actorUserId: string }): Promise<IntegrationConnection> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsViewAuthority(db, ctx, "integration_connection", input.connectionId);
  return resolveConnectionById(db, input.organizationId, input.connectionId);
}

export async function listConnectionsForUser(db: Db, input: { organizationId: string; actorUserId: string }): Promise<IntegrationConnection[]> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsViewAuthority(db, ctx, "integration_connection", "list");
  return db.select().from(integrationConnections).where(eq(integrationConnections.organizationId, input.organizationId)).orderBy(integrationConnections.createdAt) as Promise<IntegrationConnection[]>;
}

/** Stores a new active credential (encrypted), revoking any prior active one for the same connection — rotation-friendly, mirrors `agent_credentials`' shape. Fails closed (`IntegrationCredentialEncryptionUnavailableError`) with no encryption key configured — never falls back to plaintext. */
export async function storeConnectionCredential(db: Db, input: { organizationId: string; connectionId: string; secret: string; actorUserId: string }): Promise<{ credentialId: string }> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageConnectionsAuthority(db, ctx, "integration_connection", input.connectionId);
  await resolveConnectionById(db, input.organizationId, input.connectionId);

  const encrypted = encryptCredentialSecret(process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY, input.secret);

  await db
    .update(integrationCredentials)
    .set({ revokedAt: new Date(), revokedByUserId: input.actorUserId })
    .where(and(eq(integrationCredentials.connectionId, input.connectionId), isNull(integrationCredentials.revokedAt)));

  const [row] = await db
    .insert(integrationCredentials)
    .values({ organizationId: input.organizationId, connectionId: input.connectionId, ciphertext: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag, issuedByUserId: input.actorUserId })
    .returning();

  await recordAuditEvent(db, { eventType: "integration_credential_rotated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "integration_connection", targetId: input.connectionId, metadata: {} });
  return { credentialId: row.id };
}

/** Decrypts the connection's active credential for a provider adapter's own use, at the moment of send/verify — never returned to any API/UI caller. */
export async function resolveActiveCredentialSecret(db: Db, input: { organizationId: string; connectionId: string }): Promise<string | null> {
  const [row] = await db
    .select({ ciphertext: integrationCredentials.ciphertext, iv: integrationCredentials.iv, authTag: integrationCredentials.authTag })
    .from(integrationCredentials)
    .where(and(eq(integrationCredentials.connectionId, input.connectionId), eq(integrationCredentials.organizationId, input.organizationId), isNull(integrationCredentials.revokedAt)));
  if (!row) return null;
  return decryptCredentialSecret(process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY, row);
}

/** Calls the real provider adapter's `verifyConnection` — for a development provider this always succeeds (no real account exists to fail against); for Resend it makes a real, bounded API call. */
export async function verifyConnection(db: Db, input: { organizationId: string; connectionId: string; actorUserId: string }): Promise<IntegrationConnection> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageConnectionsAuthority(db, ctx, "integration_connection", input.connectionId);
  const connection = await resolveConnectionById(db, input.organizationId, input.connectionId);

  const adapter = resolveProviderAdapter(connection.provider);
  const secret = await resolveActiveCredentialSecret(db, { organizationId: input.organizationId, connectionId: input.connectionId });
  const result = await adapter.verifyConnection({ secret: secret ?? "", externalAccountId: connection.externalAccountId });

  const [row] = await db
    .update(integrationConnections)
    .set({
      status: result.verified ? "connected" : "verification_failed",
      externalAccountId: result.externalAccountId ?? connection.externalAccountId,
      lastVerifiedAt: new Date(),
      revision: connection.revision + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(integrationConnections.id, input.connectionId), eq(integrationConnections.organizationId, input.organizationId), eq(integrationConnections.revision, connection.revision)))
    .returning();
  if (!row) throw new StaleCommunicationUpdateError("integration connection");

  if (result.verified) {
    await recordAuditEvent(db, { eventType: "integration_connection_verified", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "integration_connection", targetId: row.id, metadata: { provider: connection.provider } });
  }
  return row as IntegrationConnection;
}

export async function disableConnection(db: Db, input: { organizationId: string; connectionId: string; expectedRevision: number; actorUserId: string }): Promise<IntegrationConnection> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageConnectionsAuthority(db, ctx, "integration_connection", input.connectionId);

  const [row] = await db
    .update(integrationConnections)
    .set({ status: "disabled", disconnectedAt: new Date(), revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(integrationConnections.id, input.connectionId), eq(integrationConnections.organizationId, input.organizationId), eq(integrationConnections.revision, input.expectedRevision)))
    .returning();
  if (!row) throw new StaleCommunicationUpdateError("integration connection");

  await recordAuditEvent(db, { eventType: "integration_connection_disabled", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "integration_connection", targetId: row.id, metadata: {} });
  return row as IntegrationConnection;
}

/** Throws if this connection cannot currently be used to send — the live re-check every outbound send path calls immediately before dispatching to a provider adapter. */
export function requireConnectionUsable(connection: IntegrationConnection): void {
  if (connection.status !== "connected") throw new ConnectionNotUsableError(connection.status);
}
