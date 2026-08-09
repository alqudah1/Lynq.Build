import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaces, workspaceMemberships } from "@/db/schema";
import { createSession, revokeSession } from "@/lib/auth/session";
import {
  requireAuthenticatedUser,
  requireOrganizationMembership,
  requireWorkspaceMembership,
  requireOrganizationAdminOverride,
} from "./helpers";
import { UnauthenticatedError, TenantResourceNotFoundError, InsufficientRoleError } from "./errors";

const env = loadEnv();
const db = createDbClient(env);

let userId: string;
let outsiderId: string;
let organizationId: string;
let workspaceId: string;

beforeEach(async () => {
  const [user] = await db
    .insert(users)
    .values({ email: `authz-test-${crypto.randomUUID()}@example.com` })
    .returning({ id: users.id });
  userId = user.id;

  const [outsider] = await db
    .insert(users)
    .values({ email: `authz-outsider-${crypto.randomUUID()}@example.com` })
    .returning({ id: users.id });
  outsiderId = outsider.id;

  const [org] = await db
    .insert(organizations)
    .values({ name: "Test Org", slug: `test-org-${crypto.randomUUID()}` })
    .returning({ id: organizations.id });
  organizationId = org.id;

  await db.insert(organizationMemberships).values({ organizationId, userId, role: "member" });

  const [ws] = await db
    .insert(workspaces)
    .values({ organizationId, name: "Test Workspace", slug: `test-ws-${crypto.randomUUID()}` })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;

  await db.insert(workspaceMemberships).values({ workspaceId, userId, role: "member" });
});

afterEach(async () => {
  // organizations/workspaces are independent rows, not owned by a user via
  // cascade — deleting the org (which cascades to its workspaces via their
  // own organization_id FK) is required in addition to deleting the users.
  await db.delete(organizations).where(sql`${organizations.id} = ${organizationId}`);
  await db.delete(users).where(sql`${users.id} IN (${userId}, ${outsiderId})`);
});

describe("requireAuthenticatedUser against a real database", () => {
  it("resolves the authenticated user's identity from a real, valid session token", async () => {
    const { rawToken, session } = await createSession(db, { userId });

    const result = await requireAuthenticatedUser(db, rawToken);

    expect(result.userId).toBe(userId);
    expect(result.sessionId).toBe(session.id);
  });

  it("rejects a null/missing token", async () => {
    await expect(requireAuthenticatedUser(db, null)).rejects.toThrow(UnauthenticatedError);
  });

  it("rejects a token that doesn't match any session", async () => {
    await expect(requireAuthenticatedUser(db, "not-a-real-token")).rejects.toThrow(UnauthenticatedError);
  });

  it("rejects a revoked session's token on its very next use", async () => {
    const { rawToken, session } = await createSession(db, { userId });
    await revokeSession(db, session.id);

    await expect(requireAuthenticatedUser(db, rawToken)).rejects.toThrow(UnauthenticatedError);
  });
});

describe("requireOrganizationMembership against a real database", () => {
  it("resolves the membership for an actual member", async () => {
    const result = await requireOrganizationMembership(db, organizationId, userId);
    expect(result).toEqual({ organizationId, userId, role: "member" });
  });

  it("throws TenantResourceNotFoundError for a user with no membership", async () => {
    await expect(requireOrganizationMembership(db, organizationId, outsiderId)).rejects.toThrow(
      TenantResourceNotFoundError
    );
  });

  it("throws TenantResourceNotFoundError for a nonexistent organization — identical to the no-membership case", async () => {
    await expect(requireOrganizationMembership(db, crypto.randomUUID(), userId)).rejects.toThrow(
      TenantResourceNotFoundError
    );
  });

  it("throws TenantResourceNotFoundError once the organization is soft-deleted, even for a real former member", async () => {
    await db.update(organizations).set({ deletedAt: new Date() }).where(sql`${organizations.id} = ${organizationId}`);

    await expect(requireOrganizationMembership(db, organizationId, userId)).rejects.toThrow(
      TenantResourceNotFoundError
    );
  });
});

describe("requireWorkspaceMembership against a real database", () => {
  it("resolves the membership for an actual member, including the parent organizationId", async () => {
    const result = await requireWorkspaceMembership(db, workspaceId, userId);
    expect(result).toEqual({ workspaceId, organizationId, userId, role: "member" });
  });

  it("throws TenantResourceNotFoundError for an organization member with no explicit workspace membership", async () => {
    // Organization membership must never imply workspace access.
    await db.insert(organizationMemberships).values({ organizationId, userId: outsiderId, role: "member" });

    await expect(requireWorkspaceMembership(db, workspaceId, outsiderId)).rejects.toThrow(TenantResourceNotFoundError);
  });

  it("throws TenantResourceNotFoundError once the workspace is soft-deleted", async () => {
    await db.update(workspaces).set({ deletedAt: new Date() }).where(sql`${workspaces.id} = ${workspaceId}`);

    await expect(requireWorkspaceMembership(db, workspaceId, userId)).rejects.toThrow(TenantResourceNotFoundError);
  });
});

describe("requireOrganizationAdminOverride against a real database", () => {
  it("succeeds for an organization owner", async () => {
    await db
      .update(organizationMemberships)
      .set({ role: "owner" })
      .where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.userId} = ${userId}`);

    const result = await requireOrganizationAdminOverride(db, organizationId, userId);
    expect(result.role).toBe("owner");
  });

  it("succeeds for an organization admin", async () => {
    await db
      .update(organizationMemberships)
      .set({ role: "admin" })
      .where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.userId} = ${userId}`);

    const result = await requireOrganizationAdminOverride(db, organizationId, userId);
    expect(result.role).toBe("admin");
  });

  it("rejects a plain member with InsufficientRoleError", async () => {
    await expect(requireOrganizationAdminOverride(db, organizationId, userId)).rejects.toThrow(InsufficientRoleError);
  });

  it("rejects a non-member with TenantResourceNotFoundError, not InsufficientRoleError", async () => {
    await expect(requireOrganizationAdminOverride(db, organizationId, outsiderId)).rejects.toThrow(
      TenantResourceNotFoundError
    );
  });
});
