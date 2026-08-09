import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, addOrgMember, makeProject } from "./test-helpers";
import { addProjectMember } from "./members";
import { createTask, updateTask, transitionTaskStatus, assignTask, unassignTask, listTasks } from "./tasks";
import { addDependency } from "./dependencies";
import { StaleUpdateError, InvalidTaskTransitionError, DuplicateTaskAssignmentError, UnresolvedDependenciesError } from "./errors";
import { InsufficientRoleError } from "@/lib/authz/errors";

afterEach(cleanupAgentRuntimeTestData);

describe("createTask", () => {
  it("creates a top-level task and a subtask under it", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const parent = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Parent task", actorUserId: ownerId });
    const child = await createTask(db, { organizationId: orgId, projectId: project.id, parentTaskId: parent.id, title: "Subtask", actorUserId: ownerId });
    expect(child.parentTaskId).toBe(parent.id);

    const topLevel = await listTasks(db, { organizationId: orgId, projectId: project.id, actorUserId: ownerId, topLevelOnly: true });
    expect(topLevel.map((t) => t.id)).toEqual([parent.id]);
  });

  it("a contributor may create tasks; a viewer may not", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const contributorId = await makeUser();
    await addOrgMember(orgId, contributorId, "member");
    await addProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: contributorId, role: "contributor", actorUserId: ownerId });
    const task = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Contributor task", actorUserId: contributorId });
    expect(task.createdByUserId).toBe(contributorId);

    const viewerId = await makeUser();
    await addOrgMember(orgId, viewerId, "member");
    await addProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: viewerId, role: "viewer", actorUserId: ownerId });
    await expect(createTask(db, { organizationId: orgId, projectId: project.id, title: "Viewer task", actorUserId: viewerId })).rejects.toThrow(InsufficientRoleError);
  });
});

describe("updateTask — stale revision and assignee authority", () => {
  it("rejects a stale-revision update", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const task = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Task", actorUserId: ownerId });

    await updateTask(db, { organizationId: orgId, taskId: task.id, expectedRevision: task.revision, actorUserId: ownerId, updates: { title: "Renamed" } });
    await expect(updateTask(db, { organizationId: orgId, taskId: task.id, expectedRevision: task.revision, actorUserId: ownerId, updates: { title: "Stale" } })).rejects.toThrow(StaleUpdateError);
  });

  it("a contributor who is the assignee may update the task; a non-assigned contributor may not", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const task = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Task", actorUserId: ownerId });

    const assigneeId = await makeUser();
    await addOrgMember(orgId, assigneeId, "member");
    await addProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: assigneeId, role: "contributor", actorUserId: ownerId });
    await assignTask(db, { organizationId: orgId, taskId: task.id, targetUserId: assigneeId, actorUserId: ownerId });

    const updated = await updateTask(db, { organizationId: orgId, taskId: task.id, expectedRevision: task.revision, actorUserId: assigneeId, updates: { description: "Assignee update" } });
    expect(updated.description).toBe("Assignee update");

    const otherContributorId = await makeUser();
    await addOrgMember(orgId, otherContributorId, "member");
    await addProjectMember(db, { organizationId: orgId, projectId: project.id, targetUserId: otherContributorId, role: "contributor", actorUserId: ownerId });
    await expect(updateTask(db, { organizationId: orgId, taskId: task.id, expectedRevision: updated.revision, actorUserId: otherContributorId, updates: { description: "Should fail" } })).rejects.toThrow(InsufficientRoleError);
  });
});

describe("task assignment", () => {
  it("rejects a duplicate assignment of the same user to the same task", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const task = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Task", actorUserId: ownerId });

    const targetId = await makeUser();
    await addOrgMember(orgId, targetId, "member");
    await assignTask(db, { organizationId: orgId, taskId: task.id, targetUserId: targetId, actorUserId: ownerId });
    await expect(assignTask(db, { organizationId: orgId, taskId: task.id, targetUserId: targetId, actorUserId: ownerId })).rejects.toThrow(DuplicateTaskAssignmentError);
  });

  it("concurrency: a simultaneous duplicate-assignment race lets exactly one succeed", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const task = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Task", actorUserId: ownerId });
    const targetId = await makeUser();
    await addOrgMember(orgId, targetId, "member");

    const results = await Promise.allSettled([
      assignTask(db, { organizationId: orgId, taskId: task.id, targetUserId: targetId, actorUserId: ownerId }),
      assignTask(db, { organizationId: orgId, taskId: task.id, targetUserId: targetId, actorUserId: ownerId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("unassign removes the assignment cleanly", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const task = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Task", actorUserId: ownerId });
    const targetId = await makeUser();
    await addOrgMember(orgId, targetId, "member");

    await assignTask(db, { organizationId: orgId, taskId: task.id, targetUserId: targetId, actorUserId: ownerId });
    await unassignTask(db, { organizationId: orgId, taskId: task.id, targetUserId: targetId, actorUserId: ownerId });
    await expect(assignTask(db, { organizationId: orgId, taskId: task.id, targetUserId: targetId, actorUserId: ownerId })).resolves.toBeTruthy();
  });
});

describe("task status transitions", () => {
  it("enforces the exact legal transition map", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const task = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Task", actorUserId: ownerId });
    expect(task.status).toBe("backlog");

    await expect(transitionTaskStatus(db, { organizationId: orgId, taskId: task.id, toStatus: "completed", expectedRevision: task.revision, actorUserId: ownerId })).rejects.toThrow(InvalidTaskTransitionError);

    const ready = await transitionTaskStatus(db, { organizationId: orgId, taskId: task.id, toStatus: "ready", expectedRevision: task.revision, actorUserId: ownerId });
    expect(ready.status).toBe("ready");
  });

  it("a task with an unresolved (incomplete) blocking dependency cannot be completed", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const blocked = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Blocked", actorUserId: ownerId });
    const blocking = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Blocking", actorUserId: ownerId });
    await addDependency(db, { organizationId: orgId, blockedTaskId: blocked.id, blockingTaskId: blocking.id, actorUserId: ownerId });

    let current = await transitionTaskStatus(db, { organizationId: orgId, taskId: blocked.id, toStatus: "ready", expectedRevision: blocked.revision, actorUserId: ownerId });
    current = await transitionTaskStatus(db, { organizationId: orgId, taskId: blocked.id, toStatus: "in_progress", expectedRevision: current.revision, actorUserId: ownerId });

    await expect(transitionTaskStatus(db, { organizationId: orgId, taskId: blocked.id, toStatus: "completed", expectedRevision: current.revision, actorUserId: ownerId })).rejects.toThrow(UnresolvedDependenciesError);

    // Resolving the blocker (completing it) clears eligibility.
    let blockingCurrent = await transitionTaskStatus(db, { organizationId: orgId, taskId: blocking.id, toStatus: "ready", expectedRevision: blocking.revision, actorUserId: ownerId });
    blockingCurrent = await transitionTaskStatus(db, { organizationId: orgId, taskId: blocking.id, toStatus: "in_progress", expectedRevision: blockingCurrent.revision, actorUserId: ownerId });
    await transitionTaskStatus(db, { organizationId: orgId, taskId: blocking.id, toStatus: "completed", expectedRevision: blockingCurrent.revision, actorUserId: ownerId });

    const completed = await transitionTaskStatus(db, { organizationId: orgId, taskId: blocked.id, toStatus: "completed", expectedRevision: current.revision, actorUserId: ownerId });
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).not.toBeNull();
  });

  it("concurrency: simultaneous complete and cancel on the same revision — exactly one wins, the other fails as a stale/invalid transition", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const task = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Task", actorUserId: ownerId });
    const ready = await transitionTaskStatus(db, { organizationId: orgId, taskId: task.id, toStatus: "ready", expectedRevision: task.revision, actorUserId: ownerId });
    const inProgress = await transitionTaskStatus(db, { organizationId: orgId, taskId: task.id, toStatus: "in_progress", expectedRevision: ready.revision, actorUserId: ownerId });

    const results = await Promise.allSettled([
      transitionTaskStatus(db, { organizationId: orgId, taskId: task.id, toStatus: "completed", expectedRevision: inProgress.revision, actorUserId: ownerId }),
      transitionTaskStatus(db, { organizationId: orgId, taskId: task.id, toStatus: "cancelled", expectedRevision: inProgress.revision, actorUserId: ownerId }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});
