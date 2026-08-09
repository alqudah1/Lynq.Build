import { describe, it, expect, afterEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { projectMembers, workspaces, workspaceMemberships } from "@/db/schema";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, addOrgMember, makeProject } from "./test-helpers";
import { createProject } from "./projects";
import { addProjectMember, changeProjectMemberRole, removeProjectMember, listProjectMembers } from "./members";
import { DuplicateProjectMemberError, LastProjectOwnerViolationError } from "./errors";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";

afterEach(cleanupAgentRuntimeTestData);

describe("addProjectMember", () => {
  it("adds an existing organization member to the project", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const targetId = await makeUser();
    await addOrgMember(orgId, targetId, "member");

    const member = await addProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: targetId, role: "contributor", actorUserId: ownerId });
    expect(member.role).toBe("contributor");
  });

  it("rejects adding a user who is not an organization member (no new identities created)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const strangerId = await makeUser();

    await expect(addProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: strangerId, role: "contributor", actorUserId: ownerId })).rejects.toThrow();
  });

  it("rejects a duplicate member addition", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const targetId = await makeUser();
    await addOrgMember(orgId, targetId, "member");
    await addProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: targetId, role: "contributor", actorUserId: ownerId });

    await expect(addProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: targetId, role: "viewer", actorUserId: ownerId })).rejects.toThrow(DuplicateProjectMemberError);
  });

  it("requires workspace membership too when the project is workspace-scoped", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const [ws] = await db.insert(workspaces).values({ organizationId: orgId, name: "WS", slug: `ws-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: workspaces.id });
    await db.insert(workspaceMemberships).values({ workspaceId: ws.id, userId: ownerId, role: "manager" });
    const project = await createProject(db, { organizationId: orgId, workspaceId: ws.id, name: "WS Project", projectKey: "WSM", actorUserId: ownerId });

    const targetId = await makeUser();
    await addOrgMember(orgId, targetId, "member");
    // Org member but NOT a workspace member — must be rejected.
    await expect(addProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: targetId, role: "contributor", actorUserId: ownerId })).rejects.toThrow(TenantResourceNotFoundError);

    await db.insert(workspaceMemberships).values({ workspaceId: ws.id, userId: targetId, role: "member" });
    const member = await addProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: targetId, role: "contributor", actorUserId: ownerId });
    expect(member.userId).toBe(targetId);
  });

  it("concurrency: a simultaneous duplicate-add race lets exactly one succeed", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const targetId = await makeUser();
    await addOrgMember(orgId, targetId, "member");

    const results = await Promise.allSettled([
      addProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: targetId, role: "contributor", actorUserId: ownerId }),
      addProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: targetId, role: "contributor", actorUserId: ownerId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});

describe("last project owner protection", () => {
  it("rejects demoting the sole project_owner", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    await expect(changeProjectMemberRole(db, { organizationId: orgId, projectId: project.id, targetUserId: ownerId, newRole: "contributor", actorUserId: ownerId })).rejects.toThrow(LastProjectOwnerViolationError);
  });

  it("rejects removing the sole project_owner", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    await expect(removeProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: ownerId, actorUserId: ownerId })).rejects.toThrow(LastProjectOwnerViolationError);
  });

  it("allows demoting an owner once a second owner exists", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const secondOwnerId = await makeUser();
    await addOrgMember(orgId, secondOwnerId, "member");
    await addProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: secondOwnerId, role: "project_owner", actorUserId: ownerId });

    await changeProjectMemberRole(db, { organizationId: orgId, projectId: project.id, targetUserId: ownerId, newRole: "contributor", actorUserId: secondOwnerId });

    const members = await listProjectMembers(db, { organizationId: orgId, projectId: project.id, actorUserId: secondOwnerId });
    const original = members.find((m) => m.userId === ownerId);
    expect(original?.role).toBe("contributor");
  });

  it("concurrency: two simultaneous removals of the two remaining owners leave exactly one owner standing, never zero", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const secondOwnerId = await makeUser();
    await addOrgMember(orgId, secondOwnerId, "member");
    await addProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: secondOwnerId, role: "project_owner", actorUserId: ownerId });

    const results = await Promise.allSettled([
      removeProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: ownerId, actorUserId: ownerId }),
      removeProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: secondOwnerId, actorUserId: secondOwnerId }),
    ]);

    const remainingOwners = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.role, "project_owner")));
    expect(remainingOwners.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.status === "rejected")).toBe(true);
  });
});
