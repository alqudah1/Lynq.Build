import "server-only";
import { randomUUID, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workerCredentials } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { loadEnv } from "@/lib/env";
import {
  WorkerCredentialInvalidError,
  WorkerCredentialRevokedError,
  WorkerBootstrapNotConfiguredError,
  WorkerBootstrapSecretInvalidError,
} from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const KEY_PREFIX_LENGTH = 12;

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface WorkerCredentialSummary {
  id: string;
  workerName: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
}

function toSummary(row: typeof workerCredentials.$inferSelect): WorkerCredentialSummary {
  return {
    id: row.id,
    workerName: row.workerName,
    keyPrefix: row.keyPrefix,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
    createdAt: row.createdAt,
  };
}

/**
 * Issuing a worker credential is a platform-operational (deployment/ops)
 * action, not a business-data one — there is no organization, no human
 * session, and deliberately no global administrator anywhere else in
 * this codebase to gate it with. `WORKER_BOOTSTRAP_SECRET` is the
 * smallest safe interim authority for exactly this one narrow action:
 * it can mint a new worker identity, and nothing else — it grants no
 * access to Brain, Agent Registry, or any organization's data.
 */
export async function issueWorkerCredential(
  db: Db,
  input: { workerName: string; bootstrapSecret: string }
): Promise<{ credential: WorkerCredentialSummary; plaintextSecret: string }> {
  const env = loadEnv();
  if (!env.WORKER_BOOTSTRAP_SECRET) {
    throw new WorkerBootstrapNotConfiguredError();
  }
  if (!constantTimeEquals(input.bootstrapSecret, env.WORKER_BOOTSTRAP_SECRET)) {
    throw new WorkerBootstrapSecretInvalidError();
  }

  const secret = `wrk_${randomBytes(32).toString("base64url")}`;
  const keyPrefix = secret.slice(0, KEY_PREFIX_LENGTH);
  const secretHash = hashSecret(secret);
  const id = randomUUID();
  const now = new Date();

  await db.insert(workerCredentials).values({ id, workerName: input.workerName, keyPrefix, secretHash, createdAt: now, updatedAt: now });

  await recordAuditEvent(db, {
    eventType: "worker_registered",
    targetType: "worker_credential",
    targetId: id,
    metadata: { workerName: input.workerName, keyPrefix },
  });

  return { credential: { id, workerName: input.workerName, keyPrefix, lastUsedAt: null, revokedAt: null, revokedReason: null, createdAt: now }, plaintextSecret: secret };
}

export async function revokeWorkerCredential(db: Db, input: { credentialId: string; reason: string; bootstrapSecret: string }): Promise<WorkerCredentialSummary> {
  const env = loadEnv();
  if (!env.WORKER_BOOTSTRAP_SECRET) {
    throw new WorkerBootstrapNotConfiguredError();
  }
  if (!constantTimeEquals(input.bootstrapSecret, env.WORKER_BOOTSTRAP_SECRET)) {
    throw new WorkerBootstrapSecretInvalidError();
  }

  const [updated] = await db
    .update(workerCredentials)
    .set({ revokedAt: new Date(), revokedReason: input.reason, updatedAt: new Date() })
    .where(and(eq(workerCredentials.id, input.credentialId), isNull(workerCredentials.revokedAt)))
    .returning();

  if (!updated) {
    throw new WorkerCredentialInvalidError();
  }

  await recordAuditEvent(db, {
    eventType: "worker_credential_revoked",
    targetType: "worker_credential",
    targetId: updated.id,
    metadata: { workerName: updated.workerName, keyPrefix: updated.keyPrefix, reason: input.reason },
  });

  return toSummary(updated);
}

export interface WorkerPrincipal {
  workerCredentialId: string;
  workerName: string;
}

/**
 * Verifies a presented worker secret. Revocation is immediate: the very
 * next call with a revoked credential is refused, regardless of any
 * in-flight lease it previously held — reconciliation (not this
 * function) is responsible for recognizing an abandoned lease and
 * recovering the underlying job.
 */
export async function verifyWorkerCredential(db: Db, presentedSecret: string): Promise<WorkerPrincipal> {
  const keyPrefix = presentedSecret.slice(0, KEY_PREFIX_LENGTH);
  const secretHash = hashSecret(presentedSecret);

  const [row] = await db.select().from(workerCredentials).where(and(eq(workerCredentials.keyPrefix, keyPrefix), eq(workerCredentials.secretHash, secretHash)));

  if (!row) throw new WorkerCredentialInvalidError();
  if (row.revokedAt !== null) {
    await recordAuditEvent(db, { eventType: "runtime_worker_permission_denied", targetType: "worker_credential", targetId: row.id, metadata: { detail: "credential_revoked" } });
    throw new WorkerCredentialRevokedError();
  }

  await db.update(workerCredentials).set({ lastUsedAt: new Date() }).where(eq(workerCredentials.id, row.id));

  return { workerCredentialId: row.id, workerName: row.workerName };
}

/** `Authorization: Bearer <worker credential>` — the dedicated server-to-server mechanism every internal worker route uses, never a human session or a raw agent credential. */
export async function authenticateWorkerFromHeader(db: Db, request: Request): Promise<WorkerPrincipal> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new WorkerCredentialInvalidError();
  }
  return verifyWorkerCredential(db, header.slice("Bearer ".length));
}
