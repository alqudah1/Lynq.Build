import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaces, auditLogs } from "@/db/schema";
import {
  createOrganization,
  getOrganizationForUser,
  getOrganizationBySlugForUser,
  updateOrganization,
  softDeleteOrganization,
  listOrganizationsForUser,
} from "./organizations";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: `org-svc-test-${crypto.randomUUID()}@example.com` })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
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

describe("createOrganization against a real database", () => {
  it("atomically creates the organization and its owner membership, with an audit event", async () => {
    const ownerId = await makeUser();

    const result = await createOrganization(rawSql, {
      name: "Acme Co",
      slug: `acme-${crypto.randomUUID()}`,
      ownerUserId: ownerId,
    });
    createdOrgIds.push(result.organization.id);

    expect(result.ownerMembership.role).toBe("owner");

    const [membershipRow] = await db
      .select()
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${result.organization.id}`);
    expect(membershipRow.role).toBe("owner");
    expect(membershipRow.userId).toBe(ownerId);

    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(sql`${auditLogs.organizationId} = ${result.organization.id} AND ${auditLogs.eventType} = 'organization_created'`);
    expect(auditRows).toHaveLength(1);
  });
});

describe("getOrganizationForUser against a real database", () => {
  it("resolves for a real member", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);

    const result = await getOrganizationForUser(db, created.organization.id, ownerId);
    expect(result.organization.id).toBe(created.organization.id);
    expect(result.membership.role).toBe("owner");
  });

  it("throws TenantResourceNotFoundError for a user with no membership — never reveals the org exists", async () => {
    const ownerId = await makeUser();
    const outsiderId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);

    await expect(getOrganizationForUser(db, created.organization.id, outsiderId)).rejects.toThrow(
      TenantResourceNotFoundError
    );
  });

  it("throws TenantResourceNotFoundError for a nonexistent organization ID — identical error to the no-membership case", async () => {
    const ownerId = await makeUser();
    await expect(getOrganizationForUser(db, crypto.randomUUID(), ownerId)).rejects.toThrow(TenantResourceNotFoundError);
  });
});

describe("updateOrganization against a real database", () => {
  it("allows an owner to update the name, atomically with an audit event", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);

    const updated = await updateOrganization(db, rawSql, {
      organizationId: created.organization.id,
      actorUserId: ownerId,
      updates: { name: "Acme Corp" },
    });

    expect(updated.name).toBe("Acme Corp");
    expect(updated.slug).toBe(created.organization.slug); // untouched field preserved

    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(sql`${auditLogs.organizationId} = ${created.organization.id} AND ${auditLogs.eventType} = 'organization_updated'`);
    expect(auditRows).toHaveLength(1);
  });

  it("rejects a member (not owner/admin) with InsufficientRoleError", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await db.insert(organizationMemberships).values({ organizationId: created.organization.id, userId: memberId, role: "member" });

    await expect(
      updateOrganization(db, rawSql, { organizationId: created.organization.id, actorUserId: memberId, updates: { name: "x" } })
    ).rejects.toThrow(InsufficientRoleError);
  });
});

describe("softDeleteOrganization against a real database", () => {
  it("allows only an owner to soft-delete, cascading to its workspaces", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await db.insert(workspaces).values({ organizationId: created.organization.id, name: "Marketing", slug: "marketing" });

    await softDeleteOrganization(db, rawSql, { organizationId: created.organization.id, actorUserId: ownerId });

    const [orgRow] = await db.select().from(organizations).where(sql`${organizations.id} = ${created.organization.id}`);
    expect(orgRow.deletedAt).not.toBeNull();
    const workspaceRows = await db.select().from(workspaces).where(sql`${workspaces.organizationId} = ${created.organization.id}`);
    expect(workspaceRows.every((w) => w.deletedAt !== null)).toBe(true);

    // Once deleted, it's no longer reachable via the tenant-scoped read.
    await expect(getOrganizationForUser(db, created.organization.id, ownerId)).rejects.toThrow(TenantResourceNotFoundError);
  });

  it("rejects an admin (not owner) with InsufficientRoleError — only owners may delete", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await db.insert(organizationMemberships).values({ organizationId: created.organization.id, userId: adminId, role: "admin" });

    await expect(
      softDeleteOrganization(db, rawSql, { organizationId: created.organization.id, actorUserId: adminId })
    ).rejects.toThrow(InsufficientRoleError);
  });
});

describe("listOrganizationsForUser against a real database", () => {
  it("lists every non-deleted organization the user belongs to, with their role", async () => {
    const ownerId = await makeUser();
    const orgA = await createOrganization(rawSql, { name: "Org A", slug: `org-a-${crypto.randomUUID()}`, ownerUserId: ownerId });
    const orgB = await createOrganization(rawSql, { name: "Org B", slug: `org-b-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(orgA.organization.id, orgB.organization.id);

    const list = await listOrganizationsForUser(db, ownerId);

    const ids = list.map((o) => o.id).sort();
    expect(ids).toEqual([orgA.organization.id, orgB.organization.id].sort());
    expect(list.every((o) => o.role === "owner")).toBe(true);
  });

  it("excludes a soft-deleted organization from the list", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await softDeleteOrganization(db, rawSql, { organizationId: created.organization.id, actorUserId: ownerId });

    const list = await listOrganizationsForUser(db, ownerId);
    expect(list.find((o) => o.id === created.organization.id)).toBeUndefined();
  });
});

describe("getOrganizationBySlugForUser (Step 5A dashboard route resolution)", () => {
  it("resolves the organization for a member using its slug", async () => {
    const ownerId = await makeUser();
    const slug = `acme-slug-${crypto.randomUUID()}`;
    const created = await createOrganization(rawSql, { name: "Acme", slug, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);

    const result = await getOrganizationBySlugForUser(db, slug, ownerId);
    expect(result.organization.id).toBe(created.organization.id);
    expect(result.membership.role).toBe("owner");
  });

  it("returns the identical not-found error for a nonexistent slug", async () => {
    await expect(getOrganizationBySlugForUser(db, `nonexistent-${crypto.randomUUID()}`, crypto.randomUUID())).rejects.toBeInstanceOf(
      TenantResourceNotFoundError
    );
  });

  it("a user cannot access another user's organization by slug (identical not-found, not forbidden)", async () => {
    const ownerId = await makeUser();
    const slug = `private-org-${crypto.randomUUID()}`;
    const created = await createOrganization(rawSql, { name: "Private Co", slug, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);

    const outsiderId = await makeUser();
    await expect(getOrganizationBySlugForUser(db, slug, outsiderId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("a soft-deleted organization's slug resolves to not-found even for its former owner", async () => {
    const ownerId = await makeUser();
    const slug = `deleted-org-${crypto.randomUUID()}`;
    const created = await createOrganization(rawSql, { name: "Gone Co", slug, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await softDeleteOrganization(db, rawSql, { organizationId: created.organization.id, actorUserId: ownerId });

    await expect(getOrganizationBySlugForUser(db, slug, ownerId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});
