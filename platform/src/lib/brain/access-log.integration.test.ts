import { describe, it, expect, afterEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, accessLogEntries } from "@/db/schema";
import { recordAccessLogEntry, shouldLogAccess } from "./access-log";

const env = loadEnv();
const db = createDbClient(env);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-access-log-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Access Log Test Org", slug: `brain-access-log-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

afterEach(async () => {
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(accessLogEntries).where(sql`${accessLogEntries.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("shouldLogAccess", () => {
  it("is true for agent reads and false for human reads (§15.6's interim policy)", () => {
    expect(shouldLogAccess("agent")).toBe(true);
    expect(shouldLogAccess("human")).toBe(false);
  });
});

describe("recordAccessLogEntry", () => {
  it("writes a row for an agent read and returns true", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const wrote = await recordAccessLogEntry(db, { organizationId: orgId, actorUserId: ownerId, actorType: "agent", targetType: "knowledge_item", targetId: ownerId, domain: "identity" });
    expect(wrote).toBe(true);

    const rows = await db.select().from(accessLogEntries).where(eq(accessLogEntries.organizationId, orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0].actorType).toBe("agent");
  });

  it("does not write a row for a human read, and returns false", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const wrote = await recordAccessLogEntry(db, { organizationId: orgId, actorUserId: ownerId, actorType: "human", targetType: "knowledge_item", targetId: ownerId });
    expect(wrote).toBe(false);

    const rows = await db.select().from(accessLogEntries).where(eq(accessLogEntries.organizationId, orgId));
    expect(rows).toHaveLength(0);
  });
});

describe("structural checks", () => {
  it("there is no update or delete path for access log entries anywhere in this module", async () => {
    const accessLogModule = await import("./access-log");
    expect((accessLogModule as Record<string, unknown>).updateAccessLogEntry).toBeUndefined();
    expect((accessLogModule as Record<string, unknown>).deleteAccessLogEntry).toBeUndefined();
  });
});
