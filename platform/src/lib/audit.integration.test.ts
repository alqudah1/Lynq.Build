import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, auditLogs } from "@/db/schema";
import { recordAuditEvent } from "./audit";

const env = loadEnv();
const db = createDbClient(env);

let testUserId: string;

beforeEach(async () => {
  const [user] = await db
    .insert(users)
    .values({ email: `audit-test-${crypto.randomUUID()}@example.com` })
    .returning({ id: users.id });
  testUserId = user.id;
});

afterEach(async () => {
  await db.delete(auditLogs).where(sql`${auditLogs.actorUserId} = ${testUserId}`);
  await db.delete(users).where(sql`${users.id} = ${testUserId}`);
});

describe("recordAuditEvent against a real database", () => {
  it("persists a real row with the exact fields provided", async () => {
    await recordAuditEvent(db, {
      eventType: "oauth_login_success",
      actorUserId: testUserId,
      metadata: { provider: "google" },
      ipAddress: "203.0.113.5",
      userAgent: "integration-test-agent",
    });

    const [row] = await db.select().from(auditLogs).where(sql`${auditLogs.actorUserId} = ${testUserId}`);

    expect(row.eventType).toBe("oauth_login_success");
    expect(row.metadata).toEqual({ provider: "google" });
    expect(row.ipAddress).toBe("203.0.113.5");
    expect(row.organizationId).toBeNull();
  });

  it("persists an event with no actor (e.g. a failed callback before any identity is known)", async () => {
    await recordAuditEvent(db, {
      eventType: "oauth_login_failure",
      metadata: { provider: "google", reason: "state_mismatch" },
    });

    const [row] = await db
      .select()
      .from(auditLogs)
      .where(sql`${auditLogs.eventType} = 'oauth_login_failure' AND ${auditLogs.actorUserId} IS NULL`);

    expect(row).toBeDefined();
    expect(row.metadata).toEqual({ provider: "google", reason: "state_mismatch" });

    await db.delete(auditLogs).where(sql`${auditLogs.id} = ${row.id}`);
  });
});
