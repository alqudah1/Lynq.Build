import { eq } from "drizzle-orm";
import { organizationMemberships } from "@/db/schema";
import type { OrganizationRole } from "@/lib/authz/helpers";
import { createProject } from "./projects";
import type { ProjectPriority } from "./validation";

export { db, rawSql, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, ensureToolsSeeded, makeKnowledgeItem } from "@/lib/agent-runtime/test-helpers";

import { db } from "@/lib/agent-runtime/test-helpers";

/** Every project test needs organization members beyond the owner (contributors, viewers, a second admin) — this sets an existing user's org role directly, mirroring `memberships.integration.test.ts`'s own fixture style. */
export async function addOrgMember(organizationId: string, userId: string, role: OrganizationRole): Promise<void> {
  await db.insert(organizationMemberships).values({ organizationId, userId, role }).onConflictDoUpdate({ target: [organizationMemberships.organizationId, organizationMemberships.userId], set: { role } });
}

export async function removeOrgRole(organizationId: string, userId: string): Promise<void> {
  await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, userId));
}

export async function makeProject(organizationId: string, actorUserId: string, overrides: { workspaceId?: string | null; projectKey?: string; name?: string; priority?: ProjectPriority } = {}) {
  return createProject(db, {
    organizationId,
    workspaceId: overrides.workspaceId ?? null,
    name: overrides.name ?? "Test Project",
    projectKey: overrides.projectKey ?? `TP${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    priority: overrides.priority,
    actorUserId,
  });
}
