import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeProject } from "./test-helpers";
import { createTask, transitionTaskStatus } from "./tasks";
import { createMilestone } from "./milestones";
import { calculateProjectProgress, calculateMilestoneProgress } from "./progress";

afterEach(cleanupAgentRuntimeTestData);

async function completeTask(orgId: string, projectId: string, ownerId: string, title: string) {
  const task = await createTask(db, { organizationId: orgId, projectId, title, actorUserId: ownerId });
  let current = await transitionTaskStatus(db, { organizationId: orgId, taskId: task.id, toStatus: "ready", expectedRevision: task.revision, actorUserId: ownerId });
  current = await transitionTaskStatus(db, { organizationId: orgId, taskId: task.id, toStatus: "in_progress", expectedRevision: current.revision, actorUserId: ownerId });
  return transitionTaskStatus(db, { organizationId: orgId, taskId: task.id, toStatus: "completed", expectedRevision: current.revision, actorUserId: ownerId });
}

describe("calculateProjectProgress", () => {
  it("is deterministic: completed / eligible non-cancelled tasks", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    await completeTask(orgId, project.id, ownerId, "Done 1");
    await completeTask(orgId, project.id, ownerId, "Done 2");
    await createTask(db, { organizationId: orgId, projectId: project.id, title: "Not done", actorUserId: ownerId });

    const progress = await calculateProjectProgress(db, orgId, project.id);
    expect(progress.completedCount).toBe(2);
    expect(progress.eligibleCount).toBe(3);
    expect(progress.percentage).toBe(67);
  });

  it("never counts cancelled tasks as completed work, and never lets them inflate the eligible denominator", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    await completeTask(orgId, project.id, ownerId, "Done");
    const cancelled = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Cancelled", actorUserId: ownerId });
    const readyCancelled = await transitionTaskStatus(db, { organizationId: orgId, taskId: cancelled.id, toStatus: "ready", expectedRevision: cancelled.revision, actorUserId: ownerId });
    await transitionTaskStatus(db, { organizationId: orgId, taskId: cancelled.id, toStatus: "cancelled", expectedRevision: readyCancelled.revision, actorUserId: ownerId });

    const progress = await calculateProjectProgress(db, orgId, project.id);
    expect(progress.completedCount).toBe(1);
    expect(progress.eligibleCount).toBe(1);
    expect(progress.percentage).toBe(100);
  });

  it("is repeatable — calling it twice with no changes returns the identical result", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    await completeTask(orgId, project.id, ownerId, "Done");
    await createTask(db, { organizationId: orgId, projectId: project.id, title: "Pending", actorUserId: ownerId });

    const first = await calculateProjectProgress(db, orgId, project.id);
    const second = await calculateProjectProgress(db, orgId, project.id);
    expect(second).toEqual(first);
  });
});

describe("calculateMilestoneProgress", () => {
  it("counts only tasks linked to that specific milestone", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const milestone = await createMilestone(db, { organizationId: orgId, projectId: project.id, title: "Launch", actorUserId: ownerId });

    const linked = await createTask(db, { organizationId: orgId, projectId: project.id, milestoneId: milestone.id, title: "Linked", actorUserId: ownerId });
    let current = await transitionTaskStatus(db, { organizationId: orgId, taskId: linked.id, toStatus: "ready", expectedRevision: linked.revision, actorUserId: ownerId });
    current = await transitionTaskStatus(db, { organizationId: orgId, taskId: linked.id, toStatus: "in_progress", expectedRevision: current.revision, actorUserId: ownerId });
    await transitionTaskStatus(db, { organizationId: orgId, taskId: linked.id, toStatus: "completed", expectedRevision: current.revision, actorUserId: ownerId });

    await createTask(db, { organizationId: orgId, projectId: project.id, title: "Unrelated to milestone", actorUserId: ownerId });

    const progress = await calculateMilestoneProgress(db, orgId, milestone.id);
    expect(progress.completedCount).toBe(1);
    expect(progress.eligibleCount).toBe(1);
    expect(progress.percentage).toBe(100);
  });

  it("returns a null percentage for a milestone with no linked tasks", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const milestone = await createMilestone(db, { organizationId: orgId, projectId: project.id, title: "Empty", actorUserId: ownerId });

    const progress = await calculateMilestoneProgress(db, orgId, milestone.id);
    expect(progress.percentage).toBeNull();
  });
});
