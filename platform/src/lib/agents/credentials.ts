import "server-only";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentCredentials } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireAgentRegistryManagementAuthority } from "./authz";
import { getAgent } from "./agents";
import { AgentCredentialAlreadyRevokedError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const KEY_PREFIX_LENGTH = 12;

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export interface AgentCredentialSummary {
  id: string;
  agentId: string;
  keyPrefix: string;
  issuedByUserId: string | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  createdAt: Date;
}

function toSummary(row: typeof agentCredentials.$inferSelect): AgentCredentialSummary {
  return {
    id: row.id,
    agentId: row.agentId,
    keyPrefix: row.keyPrefix,
    issuedByUserId: row.issuedByUserId,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    revokedByUserId: row.revokedByUserId,
    createdAt: row.createdAt,
  };
}

/**
 * Only a SHA-256 hash is ever persisted — the plaintext secret is
 * returned exactly once, at issuance, and never stored or retrievable
 * again (the identical discipline `auth/`'s session tokens already
 * follow). Multiple simultaneously-active credentials per agent are
 * allowed by design (rotation-friendly, standard API-key practice) —
 * there is no "at most one active" constraint to work around.
 */
export async function issueAgentCredential(
  db: Db,
  input: { organizationId: string; agentId: string; actorUserId: string }
): Promise<{ credential: AgentCredentialSummary; plaintextSecret: string }> {
  await requireAgentRegistryManagementAuthority(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, targetId: input.agentId });
  await getAgent(db, { organizationId: input.organizationId, agentId: input.agentId, actorUserId: input.actorUserId });

  const secret = `agt_${randomBytes(32).toString("base64url")}`;
  const keyPrefix = secret.slice(0, KEY_PREFIX_LENGTH);
  const secretHash = hashSecret(secret);
  const id = randomUUID();
  const now = new Date();

  await db.insert(agentCredentials).values({
    id,
    agentId: input.agentId,
    keyPrefix,
    secretHash,
    issuedByUserId: input.actorUserId,
    createdAt: now,
  });

  await recordAuditEvent(db, {
    eventType: "agent_credential_issued",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "agent",
    targetId: input.agentId,
    metadata: { credentialId: id, keyPrefix },
  });

  return {
    credential: { id, agentId: input.agentId, keyPrefix, issuedByUserId: input.actorUserId, lastUsedAt: null, revokedAt: null, revokedByUserId: null, createdAt: now },
    plaintextSecret: secret,
  };
}

export async function listAgentCredentials(
  db: Db,
  input: { organizationId: string; agentId: string; actorUserId: string }
): Promise<AgentCredentialSummary[]> {
  await requireAgentRegistryManagementAuthority(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, targetId: input.agentId });
  await getAgent(db, { organizationId: input.organizationId, agentId: input.agentId, actorUserId: input.actorUserId });

  const rows = await db.select().from(agentCredentials).where(eq(agentCredentials.agentId, input.agentId));
  return rows.map(toSummary);
}

export async function revokeAgentCredential(
  db: Db,
  input: { organizationId: string; agentId: string; credentialId: string; actorUserId: string }
): Promise<AgentCredentialSummary> {
  await requireAgentRegistryManagementAuthority(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, targetId: input.agentId });
  await getAgent(db, { organizationId: input.organizationId, agentId: input.agentId, actorUserId: input.actorUserId });

  const now = new Date();
  const [updated] = await db
    .update(agentCredentials)
    .set({ revokedAt: now, revokedByUserId: input.actorUserId })
    .where(and(eq(agentCredentials.id, input.credentialId), eq(agentCredentials.agentId, input.agentId), isNull(agentCredentials.revokedAt)))
    .returning();

  if (!updated) {
    throw new AgentCredentialAlreadyRevokedError();
  }

  await recordAuditEvent(db, {
    eventType: "agent_credential_revoked",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "agent",
    targetId: input.agentId,
    metadata: { credentialId: input.credentialId, keyPrefix: updated.keyPrefix },
  });

  return toSummary(updated);
}

/**
 * Verifies a presented secret against its stored hash and, if valid and
 * not revoked, stamps `lastUsedAt`. The one function Brain Module 16
 * (Agent Read API) needs to authenticate an agent's own request — kept
 * here, not duplicated there, since credential storage is this module's
 * responsibility.
 */
export async function verifyAgentCredential(db: Db, presentedSecret: string): Promise<AgentCredentialSummary | null> {
  const keyPrefix = presentedSecret.slice(0, KEY_PREFIX_LENGTH);
  const secretHash = hashSecret(presentedSecret);

  const [row] = await db
    .select()
    .from(agentCredentials)
    .where(and(eq(agentCredentials.keyPrefix, keyPrefix), eq(agentCredentials.secretHash, secretHash), isNull(agentCredentials.revokedAt)));

  if (!row) return null;

  const lastUsedAt = new Date();
  await db.update(agentCredentials).set({ lastUsedAt }).where(eq(agentCredentials.id, row.id));

  return toSummary({ ...row, lastUsedAt });
}

export type VerifyAgentCredentialDetailedResult =
  | { status: "valid"; credential: AgentCredentialSummary; agentId: string }
  | { status: "revoked"; agentId: string; credentialId: string }
  | { status: "invalid" };

/**
 * Brain Module 16's actual authentication entry point — a richer sibling
 * of `verifyAgentCredential` that distinguishes "no credential matches
 * this secret at all" from "a credential matches, but it's revoked."
 * `verifyAgentCredential` deliberately collapses both to `null`, which is
 * correct for its own callers; this module's HTTP-facing authentication
 * layer needs the distinction to write the correct audit event
 * (`agent_brain_credential_invalid` vs `agent_brain_credential_revoked`)
 * — the HTTP response itself must still never leak which case occurred
 * (both are the identical generic 401), only the audit trail may.
 */
export async function verifyAgentCredentialDetailed(db: Db, presentedSecret: string): Promise<VerifyAgentCredentialDetailedResult> {
  const keyPrefix = presentedSecret.slice(0, KEY_PREFIX_LENGTH);
  const secretHash = hashSecret(presentedSecret);

  const [row] = await db
    .select()
    .from(agentCredentials)
    .where(and(eq(agentCredentials.keyPrefix, keyPrefix), eq(agentCredentials.secretHash, secretHash)));

  if (!row) return { status: "invalid" };
  if (row.revokedAt !== null) return { status: "revoked", agentId: row.agentId, credentialId: row.id };

  const lastUsedAt = new Date();
  await db.update(agentCredentials).set({ lastUsedAt }).where(eq(agentCredentials.id, row.id));

  return { status: "valid", credential: toSummary({ ...row, lastUsedAt }), agentId: row.agentId };
}
