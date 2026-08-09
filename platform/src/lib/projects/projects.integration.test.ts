import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { auditLogs, workspaces, workspaceMemberships } from "@/db/schema";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, addOrgMember, makeProject } from "./test-helpers";
import { createProject, getProjectForUser, updateProject, transitionProjectStatus, listProjectsForUser } from "./projects";
import { calculateProjectProgress } from "./progress";
import { listProjectEvents } from "./events";
import { ProjectKeyAlreadyTakenError, InvalidProjectTransitionError, StaleUpdateError } from "./errors";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";

afterEach(cleanupAgentRuntimeTestData);

async function makeWorkspace(organizationId: string, actorUserId: string) {
  const [row] = await db.insert(workspaces).values({ organizationId, name: "Test Workspace", slug: `ws-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: workspaces.id });
  await db.insert(workspaceMemberships).values({ workspaceId: row.id, userId: actorUserId, role: "manager" });
  return row.id;
}

describe("createProject", () => {
  it("rejects a duplicate project key within the same organization", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await makeProject(orgId, ownerId, { projectKey: "KIDS" });

    await expect(makeProject(orgId, ownerId, { projectKey: "KIDS", name: "Second" })).rejects.toThrow(ProjectKeyAlreadyTakenError);
  });

  it("allows the same project key in two different organizations", async () => {
    const ownerId = await makeUser();
    const orgA = await makeOrgWithOwner(ownerId);
    const orgB = await makeOrgWithOwner(ownerId);

    const a = await makeProject(orgA, ownerId, { projectKey: "REBATE" });
    const b = await makeProject(orgB, ownerId, { projectKey: "REBATE" });
    expect(a.projectKey).toBe("REBATE");
    expect(b.projectKey).toBe("REBATE");
  });

  it("creates the project and its first project_owner membership in one call, and records both an audit event and a project event", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const project = await makeProject(orgId, ownerId);

    const events = await listProjectEvents(db, project.id, 10);
    expect(events.some((e) => e.eventType === "project_created")).toBe(true);

    const audits = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} AND ${auditLogs.eventType} = 'project_created'`);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    // Audit metadata is bounded — never the full project description/objective, only small identifying fields.
    expect(JSON.stringify(audits[0].metadata)).not.toContain("description");
  });

  it("a workspace manager may create a workspace-scoped project without being an organization owner/admin", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const managerId = await makeUser();
    await addOrgMember(orgId, managerId, "member");
    const workspaceId = await makeWorkspace(orgId, managerId);

    const project = await createProject(db, { organizationId: orgId, workspaceId, name: "WS Project", projectKey: "WSP", actorUserId: managerId });
    expect(project.workspaceId).toBe(workspaceId);
  });

  it("rejects a plain organization member (no workspace role) from creating a project", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const memberId = await makeUser();
    await addOrgMember(orgId, memberId, "member");

    await expect(createProject(db, { organizationId: orgId, name: "Nope", projectKey: "NOPE", actorUserId: memberId })).rejects.toThrow();
  });
});

describe("getProjectForUser — cross-tenant and workspace visibility", () => {
  it("returns 404 (TenantResourceNotFoundError) for a project belonging to a different organization", async () => {
    const ownerA = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const project = await makeProject(orgA, ownerA);

    const ownerB = await makeUser();
    const orgB = await makeOrgWithOwner(ownerB);

    await expect(getProjectForUser(db, { organizationId: orgB, projectId: project.id, actorUserId: ownerB })).rejects.toThrow(TenantResourceNotFoundError);
  });

  it("a workspace member may view a workspace-scoped project without an explicit project_members row", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceId = await makeWorkspace(orgId, ownerId);
    const project = await createProject(db, { organizationId: orgId, workspaceId, name: "WS Project", projectKey: "WSV", actorUserId: ownerId });

    const wsMemberId = await makeUser();
    await addOrgMember(orgId, wsMemberId, "member");
    await db.insert(workspaceMemberships).values({ workspaceId, userId: wsMemberId, role: "member" });

    const seen = await getProjectForUser(db, { organizationId: orgId, projectId: project.id, actorUserId: wsMemberId });
    expect(seen.id).toBe(project.id);
  });

  it("a plain organization member with no project or workspace role cannot view the project", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const outsiderId = await makeUser();
    await addOrgMember(orgId, outsiderId, "member");

    await expect(getProjectForUser(db, { organizationId: orgId, projectId: project.id, actorUserId: outsiderId })).rejects.toThrow(InsufficientRoleError);
  });

  it("listProjectsForUser: org admin sees every project; a plain member sees only projects they belong to", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await makeProject(orgId, ownerId, { projectKey: "ONE" });
    await makeProject(orgId, ownerId, { projectKey: "TWO" });

    const adminList = await listProjectsForUser(db, { organizationId: orgId, actorUserId: ownerId });
    expect(adminList.length).toBeGreaterThanOrEqual(2);

    const memberId = await makeUser();
    await addOrgMember(orgId, memberId, "member");
    const memberList = await listProjectsForUser(db, { organizationId: orgId, actorUserId: memberId });
    expect(memberList).toHaveLength(0);
  });
});

describe("project status transitions", () => {
  it("enforces the exact legal transition map, rejecting an illegal jump", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    expect(project.status).toBe("proposed");

    await expect(transitionProjectStatus(db, { organizationId: orgId, projectId: project.id, toStatus: "completed", actorUserId: ownerId, expectedRevision: project.revision })).rejects.toThrow(InvalidProjectTransitionError);

    const planning = await transitionProjectStatus(db, { organizationId: orgId, projectId: project.id, toStatus: "planning", actorUserId: ownerId, expectedRevision: project.revision });
    expect(planning.status).toBe("planning");
  });

  it("completed and archived projects reject any further transition except the one explicit allowed edge", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    let project = await makeProject(orgId, ownerId);

    project = await transitionProjectStatus(db, { organizationId: orgId, projectId: project.id, toStatus: "planning", actorUserId: ownerId, expectedRevision: project.revision });
    project = await transitionProjectStatus(db, { organizationId: orgId, projectId: project.id, toStatus: "active", actorUserId: ownerId, expectedRevision: project.revision });
    project = await transitionProjectStatus(db, { organizationId: orgId, projectId: project.id, toStatus: "completed", actorUserId: ownerId, expectedRevision: project.revision });

    await expect(transitionProjectStatus(db, { organizationId: orgId, projectId: project.id, toStatus: "active", actorUserId: ownerId, expectedRevision: project.revision })).rejects.toThrow(InvalidProjectTransitionError);

    project = await transitionProjectStatus(db, { organizationId: orgId, projectId: project.id, toStatus: "archived", actorUserId: ownerId, expectedRevision: project.revision });
    expect(project.archivedAt).not.toBeNull();

    await expect(transitionProjectStatus(db, { organizationId: orgId, projectId: project.id, toStatus: "active", actorUserId: ownerId, expectedRevision: project.revision })).rejects.toThrow(InvalidProjectTransitionError);
  });

  it("a project viewer cannot transition or update the project", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const { addProjectMember } = await import("./members");
    const viewerId = await makeUser();
    await addOrgMember(orgId, viewerId, "member");
    await addProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: viewerId, role: "viewer", actorUserId: ownerId });

    await expect(transitionProjectStatus(db, { organizationId: orgId, projectId: project.id, toStatus: "planning", actorUserId: viewerId, expectedRevision: project.revision })).rejects.toThrow(InsufficientRoleError);
    await expect(updateProject(db, { organizationId: orgId, projectId: project.id, actorUserId: viewerId, expectedRevision: project.revision, updates: { name: "Hacked" } })).rejects.toThrow(InsufficientRoleError);
  });
});

describe("updateProject — stale revision", () => {
  it("rejects an update against a stale (already-superseded) revision", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    await updateProject(db, { organizationId: orgId, projectId: project.id, actorUserId: ownerId, expectedRevision: project.revision, updates: { name: "First edit" } });

    await expect(updateProject(db, { organizationId: orgId, projectId: project.id, actorUserId: ownerId, expectedRevision: project.revision, updates: { name: "Stale edit" } })).rejects.toThrow(StaleUpdateError);
  });

  it("never accepts a change to projectKey or status through the general update path", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const updated = await updateProject(db, { organizationId: orgId, projectId: project.id, actorUserId: ownerId, expectedRevision: project.revision, updates: { name: "Renamed" } });
    expect(updated.projectKey).toBe(project.projectKey);
    expect(updated.status).toBe(project.status);
  });
});

describe("calculateProjectProgress", () => {
  it("returns a null percentage (not 0) for a zero-task project", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const progress = await calculateProjectProgress(db, orgId, project.id);
    expect(progress.eligibleCount).toBe(0);
    expect(progress.completedCount).toBe(0);
    expect(progress.percentage).toBeNull();
  });
});

describe("concurrency: duplicate project key creation", () => {
  it("under a simultaneous race for the same key, exactly one creation succeeds", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const results = await Promise.allSettled([
      makeProject(orgId, ownerId, { projectKey: "RACE" }),
      makeProject(orgId, ownerId, { projectKey: "RACE" }),
      makeProject(orgId, ownerId, { projectKey: "RACE" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ProjectKeyAlreadyTakenError);
    }
  });
});
