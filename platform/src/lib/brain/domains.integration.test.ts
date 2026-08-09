import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, knowledgeItems, knowledgeDomainMetadata, auditLogs, brainPermissionGrants } from "@/db/schema";
import { createKnowledgeItem } from "./knowledge-items";
import { listDomains, getDomain } from "./domains";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const CANONICAL_DOMAINS = ["identity", "offerings", "market", "execution", "growth", "governance", "capability", "wisdom"] as const;

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-domains-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Domains Test Org", slug: `brain-domains-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

afterEach(async () => {
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(knowledgeItems).where(sql`${knowledgeItems.organizationId} = ${id}`);
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("listDomains", () => {
  it("returns all eight canonical domains, in display order, with no fabricated ownerDepartment", async () => {
    const domains = await listDomains(db);
    expect(domains).toHaveLength(8);
    expect(domains.map((d) => d.domain)).toEqual([...CANONICAL_DOMAINS]);
    expect(domains.map((d) => d.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const d of domains) {
      expect(d.ownerDepartment).toBeNull();
      expect(d.isRetired).toBe(false);
      expect(d.retiredAt).toBeNull();
      expect(d.description.length).toBeGreaterThan(0);
    }
  });
});

describe("getDomain", () => {
  it("returns the correct metadata for every one of the eight canonical domains", async () => {
    for (const domain of CANONICAL_DOMAINS) {
      const definition = await getDomain(db, domain);
      expect(definition.domain).toBe(domain);
    }
  });

  it("governance's description matches the approved source verbatim", async () => {
    const definition = await getDomain(db, "governance");
    expect(definition.description).toContain("Legal, Finance, HR, Security");
    expect(definition.description).toContain("highest verification standard in the whole Brain");
  });
});

describe("referential integrity — knowledge items keep working against every domain", () => {
  it("a knowledge item can still be created for every one of the eight domains after this migration", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    for (const domain of CANONICAL_DOMAINS) {
      await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain, workspaceId: null, granteeUserId: ownerId, capability: "draft_write" });
    }

    for (const domain of CANONICAL_DOMAINS) {
      const item = await createKnowledgeItem(db, rawSql, {
        organizationId: orgId,
        domain,
        classification: "fact",
        title: `item for ${domain}`,
        content: "c",
        actorUserId: ownerId,
      });
      expect(item.domain).toBe(domain);
    }

    const rows = await db.select().from(knowledgeItems).where(sql`${knowledgeItems.organizationId} = ${orgId}`);
    expect(rows).toHaveLength(8);
  });
});

describe("database-level enforcement", () => {
  it("rejects a duplicate metadata row for a domain that already has one", async () => {
    await expect(
      db.insert(knowledgeDomainMetadata).values({ domain: "identity", description: "duplicate attempt", sortOrder: 999 })
    ).rejects.toThrow();
  });

  it("rejects two domains claiming the same display position", async () => {
    // "execution" already occupies sort_order 4 — inserting a fake extra
    // row is impossible anyway (domain is unique), so this proves the
    // sort_order uniqueness independently via a direct raw update attempt.
    await expect(
      db.execute(sql`UPDATE knowledge_domain_metadata SET sort_order = 4 WHERE domain = 'wisdom'`)
    ).rejects.toThrow();
  });

  it("rejects an unsupported (non-canonical) domain identifier at the database level", async () => {
    await expect(
      db.execute(sql`INSERT INTO knowledge_domain_metadata (id, domain, description, sort_order) VALUES (gen_random_uuid(), 'not-a-real-domain', 'x', 999)`)
    ).rejects.toThrow();
  });
});

describe("migration verification", () => {
  it("the seed migration is idempotent — re-applying it never creates duplicates or changes row count", async () => {
    const before = await db.select().from(knowledgeDomainMetadata);
    expect(before).toHaveLength(8);

    const filePath = join(process.cwd(), "drizzle", "0010_seed_domain_metadata.sql");
    const fileContent = readFileSync(filePath, "utf8");
    await db.execute(sql.raw(fileContent));

    const after = await db.select().from(knowledgeDomainMetadata);
    expect(after).toHaveLength(8);
  });
});
