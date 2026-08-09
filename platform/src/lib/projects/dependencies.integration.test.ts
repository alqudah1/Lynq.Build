import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeProject } from "./test-helpers";
import { createTask } from "./tasks";
import { addDependency, removeDependency, listDependenciesForTask } from "./dependencies";
import { SelfDependencyError, DuplicateDependencyError, DependencyCycleError, CrossProjectDependencyError } from "./errors";

afterEach(cleanupAgentRuntimeTestData);

describe("addDependency", () => {
  it("rejects a task depending on itself", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const task = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Task", actorUserId: ownerId });

    await expect(addDependency(db, { organizationId: orgId, blockedTaskId: task.id, blockingTaskId: task.id, actorUserId: ownerId })).rejects.toThrow(SelfDependencyError);
  });

  it("rejects a duplicate active dependency between the same two tasks", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const a = await createTask(db, { organizationId: orgId, projectId: project.id, title: "A", actorUserId: ownerId });
    const b = await createTask(db, { organizationId: orgId, projectId: project.id, title: "B", actorUserId: ownerId });

    await addDependency(db, { organizationId: orgId, blockedTaskId: a.id, blockingTaskId: b.id, actorUserId: ownerId });
    await expect(addDependency(db, { organizationId: orgId, blockedTaskId: a.id, blockingTaskId: b.id, actorUserId: ownerId })).rejects.toThrow(DuplicateDependencyError);
  });

  it("rejects a dependency between tasks in different projects", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const projectA = await makeProject(orgId, ownerId, { projectKey: "PA" });
    const projectB = await makeProject(orgId, ownerId, { projectKey: "PB" });
    const a = await createTask(db, { organizationId: orgId, projectId: projectA.id, title: "A", actorUserId: ownerId });
    const b = await createTask(db, { organizationId: orgId, projectId: projectB.id, title: "B", actorUserId: ownerId });

    await expect(addDependency(db, { organizationId: orgId, blockedTaskId: a.id, blockingTaskId: b.id, actorUserId: ownerId })).rejects.toThrow(CrossProjectDependencyError);
  });

  it("rejects a direct cycle (A blocks B, then B blocks A)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const a = await createTask(db, { organizationId: orgId, projectId: project.id, title: "A", actorUserId: ownerId });
    const b = await createTask(db, { organizationId: orgId, projectId: project.id, title: "B", actorUserId: ownerId });

    await addDependency(db, { organizationId: orgId, blockedTaskId: a.id, blockingTaskId: b.id, actorUserId: ownerId });
    await expect(addDependency(db, { organizationId: orgId, blockedTaskId: b.id, blockingTaskId: a.id, actorUserId: ownerId })).rejects.toThrow(DependencyCycleError);
  });

  it("rejects an indirect cycle (A blocks B, B blocks C, then C blocks A)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const a = await createTask(db, { organizationId: orgId, projectId: project.id, title: "A", actorUserId: ownerId });
    const b = await createTask(db, { organizationId: orgId, projectId: project.id, title: "B", actorUserId: ownerId });
    const c = await createTask(db, { organizationId: orgId, projectId: project.id, title: "C", actorUserId: ownerId });

    // A blocks B: blockingTaskId=A, blockedTaskId=B
    await addDependency(db, { organizationId: orgId, blockedTaskId: b.id, blockingTaskId: a.id, actorUserId: ownerId });
    // B blocks C
    await addDependency(db, { organizationId: orgId, blockedTaskId: c.id, blockingTaskId: b.id, actorUserId: ownerId });
    // C blocks A would close the cycle A -> B -> C -> A
    await expect(addDependency(db, { organizationId: orgId, blockedTaskId: a.id, blockingTaskId: c.id, actorUserId: ownerId })).rejects.toThrow(DependencyCycleError);
  });

  it("concurrency: a simultaneous duplicate-dependency race lets exactly one succeed", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const a = await createTask(db, { organizationId: orgId, projectId: project.id, title: "A", actorUserId: ownerId });
    const b = await createTask(db, { organizationId: orgId, projectId: project.id, title: "B", actorUserId: ownerId });

    const results = await Promise.allSettled([
      addDependency(db, { organizationId: orgId, blockedTaskId: a.id, blockingTaskId: b.id, actorUserId: ownerId }),
      addDependency(db, { organizationId: orgId, blockedTaskId: a.id, blockingTaskId: b.id, actorUserId: ownerId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("removeDependency", () => {
  it("removes the edge and records an audit event", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const a = await createTask(db, { organizationId: orgId, projectId: project.id, title: "A", actorUserId: ownerId });
    const b = await createTask(db, { organizationId: orgId, projectId: project.id, title: "B", actorUserId: ownerId });

    const dep = await addDependency(db, { organizationId: orgId, blockedTaskId: a.id, blockingTaskId: b.id, actorUserId: ownerId });
    await removeDependency(db, { organizationId: orgId, dependencyId: dep.id, actorUserId: ownerId });

    const remaining = await listDependenciesForTask(db, orgId, a.id);
    expect(remaining.blockedBy).toHaveLength(0);

    const audits = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} AND ${auditLogs.eventType} = 'project_task_dependency_removed'`);
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});
