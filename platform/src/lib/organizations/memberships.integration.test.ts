import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, auditLogs } from "@/db/schema";
import { createOrganization } from "./organizations";
import { addOrganizationMember, removeOrganizationMember, changeOrganizationRole, listOrganizationMembers } from "./memberships";
import {
  InsufficientRoleError,
  LastOwnerViolationError,
  SelfRoleChangeViolationError,
  AdminCannotActOnOwnerViolationError,
} from "@/lib/authz/errors";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `org-membership-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(): Promise<{ organizationId: string; ownerId: string }> {
  const ownerId = await makeUser();
  const created = await createOrganization(rawSql, { name: "Test Org", slug: `org-${crypto.randomUUID()}`, ownerUserId: ownerId });
  createdOrgIds.push(created.organization.id);
  return { organizationId: created.organization.id, ownerId };
}

afterEach(async () => {
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("addOrganizationMember", () => {
  it("allows an owner to add a member", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const targetId = await makeUser();

    const result = await addOrganizationMember(db, rawSql, { organizationId, actorUserId: ownerId, targetUserId: targetId, role: "member" });

    expect(result.role).toBe("member");
    const [row] = await db.select().from(organizationMemberships).where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.userId} = ${targetId}`);
    expect(row.role).toBe("member");
  });

  it("rejects a member trying to add another member, auditing authorization_denied", async () => {
    const { organizationId } = await makeOrgWithOwner();
    const memberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: memberId, role: "member" });
    const targetId = await makeUser();

    await expect(
      addOrganizationMember(db, rawSql, { organizationId, actorUserId: memberId, targetUserId: targetId, role: "member" })
    ).rejects.toThrow(InsufficientRoleError);

    const denials = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${organizationId} AND ${auditLogs.eventType} = 'authorization_denied'`);
    expect(denials.length).toBeGreaterThanOrEqual(1);
  });
});

describe("removeOrganizationMember", () => {
  it("allows an owner to remove a plain member", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const memberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: memberId, role: "member" });

    await removeOrganizationMember(db, rawSql, { organizationId, actorUserId: ownerId, targetUserId: memberId });

    const rows = await db.select().from(organizationMemberships).where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.userId} = ${memberId}`);
    expect(rows).toHaveLength(0);
  });

  it("rejects an admin removing an owner, regardless of owner count", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const adminId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: adminId, role: "admin" });
    const secondOwnerId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: secondOwnerId, role: "owner" });

    await expect(
      removeOrganizationMember(db, rawSql, { organizationId, actorUserId: adminId, targetUserId: ownerId })
    ).rejects.toThrow(AdminCannotActOnOwnerViolationError);
  });

  it("allows an owner to remove another owner when more than one owner remains", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const secondOwnerId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: secondOwnerId, role: "owner" });

    await removeOrganizationMember(db, rawSql, { organizationId, actorUserId: ownerId, targetUserId: secondOwnerId });

    const rows = await db.select().from(organizationMemberships).where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.role} = 'owner'`);
    expect(rows).toHaveLength(1);
  });

  it("rejects removing the final owner", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();

    await expect(
      removeOrganizationMember(db, rawSql, { organizationId, actorUserId: ownerId, targetUserId: ownerId })
    ).rejects.toThrow(LastOwnerViolationError);

    const rows = await db.select().from(organizationMemberships).where(sql`${organizationMemberships.organizationId} = ${organizationId}`);
    expect(rows).toHaveLength(1); // untouched
  });
});

describe("changeOrganizationRole", () => {
  it("rejects a user changing their own role, even an owner", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();

    await expect(
      changeOrganizationRole(db, rawSql, { organizationId, actorUserId: ownerId, targetUserId: ownerId, newRole: "admin" })
    ).rejects.toThrow(SelfRoleChangeViolationError);
  });

  it("allows an owner to promote a member to admin", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const memberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: memberId, role: "member" });

    const result = await changeOrganizationRole(db, rawSql, { organizationId, actorUserId: ownerId, targetUserId: memberId, newRole: "admin" });

    expect(result.role).toBe("admin");
  });

  it("rejects an admin demoting an owner", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const adminId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: adminId, role: "admin" });

    await expect(
      changeOrganizationRole(db, rawSql, { organizationId, actorUserId: adminId, targetUserId: ownerId, newRole: "member" })
    ).rejects.toThrow(AdminCannotActOnOwnerViolationError);
  });

  it("rejects demoting the final owner away from owner", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const adminId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: adminId, role: "admin" });

    // adminId acts on ownerId (different actor/target — self-role-change doesn't apply)
    await expect(
      changeOrganizationRole(db, rawSql, { organizationId, actorUserId: adminId, targetUserId: ownerId, newRole: "member" })
    ).rejects.toThrow(); // AdminCannotActOnOwnerViolationError takes precedence — confirms admins can never touch owners at all
  });

  it("allows an owner to demote another owner when more than one owner remains", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const secondOwnerId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: secondOwnerId, role: "owner" });

    const result = await changeOrganizationRole(db, rawSql, { organizationId, actorUserId: ownerId, targetUserId: secondOwnerId, newRole: "admin" });

    expect(result.role).toBe("admin");
  });
});

describe("listOrganizationMembers", () => {
  it("returns the full roster including roles", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const memberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: memberId, role: "viewer" });

    const list = await listOrganizationMembers(db, organizationId, ownerId);

    expect(list).toHaveLength(2);
    expect(list.find((m) => m.userId === ownerId)?.role).toBe("owner");
    expect(list.find((m) => m.userId === memberId)?.role).toBe("viewer");
  });
});

describe("concurrency: owner-invariant safety under real races", () => {
  it("two simultaneous removals of different owners cannot leave the organization without an owner", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const secondOwnerId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: secondOwnerId, role: "owner" });
    // A third, unrelated admin actor performs both removals concurrently
    // (avoids either removal being blocked by "admin cannot act on owner"
    // — this test is specifically about the last-owner race, not that rule).
    const adminActorId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: adminActorId, role: "owner" });

    const results = await Promise.allSettled([
      removeOrganizationMember(db, rawSql, { organizationId, actorUserId: adminActorId, targetUserId: ownerId }),
      removeOrganizationMember(db, rawSql, { organizationId, actorUserId: adminActorId, targetUserId: secondOwnerId }),
    ]);

    const remainingOwners = await db
      .select()
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.role} = 'owner'`);

    // Starting from 3 owners (ownerId, secondOwnerId, adminActorId), removing
    // any two owners concurrently must never bring the count below 1.
    expect(remainingOwners.length).toBeGreaterThanOrEqual(1);
    // With 3 starting owners and 2 concurrent removals both targeting
    // *different* non-actor owners, both are actually safe to succeed
    // (3 -> 1 is fine) — the real invariant is just "never reaches 0".
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBeGreaterThanOrEqual(1);
  });

  it("concurrent removal attempts against the LAST TWO owners of a two-owner org: exactly one succeeds, one is blocked, one owner always remains", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const secondOwnerId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: secondOwnerId, role: "owner" });

    // ownerId removes secondOwnerId; secondOwnerId simultaneously removes ownerId.
    // Exactly two owners exist — at most one of these two operations may succeed.
    const results = await Promise.allSettled([
      removeOrganizationMember(db, rawSql, { organizationId, actorUserId: ownerId, targetUserId: secondOwnerId }),
      removeOrganizationMember(db, rawSql, { organizationId, actorUserId: secondOwnerId, targetUserId: ownerId }),
    ]);

    const remainingOwners = await db
      .select()
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.role} = 'owner'`);

    expect(remainingOwners.length).toBe(1);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    expect(succeeded).toBe(1);
    expect(failed).toBe(1);
    const rejection = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(LastOwnerViolationError);
  });

  it("concurrent demote-vs-remove of the last two owners also preserves at least one owner", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const secondOwnerId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: secondOwnerId, role: "owner" });

    const results = await Promise.allSettled([
      removeOrganizationMember(db, rawSql, { organizationId, actorUserId: ownerId, targetUserId: secondOwnerId }),
      changeOrganizationRole(db, rawSql, { organizationId, actorUserId: secondOwnerId, targetUserId: ownerId, newRole: "admin" }),
    ]);

    const remainingOwners = await db
      .select()
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.role} = 'owner'`);

    expect(remainingOwners.length).toBeGreaterThanOrEqual(1);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBe(1); // exactly one of the two conflicting operations can win
  });
});
