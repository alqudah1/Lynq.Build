import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { projectPhases } from "@/db/schema";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeProject } from "./test-helpers";
import { createPhase, listPhases, updatePhase, reorderPhase } from "./phases";
import { createMilestone, updateMilestone } from "./milestones";
import { StaleUpdateError } from "./errors";

afterEach(cleanupAgentRuntimeTestData);

describe("createPhase", () => {
  it("assigns increasing gap-based sequence numbers", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const a = await createPhase(db, { organizationId: orgId, projectId: project.id, name: "Discovery", actorUserId: ownerId });
    const b = await createPhase(db, { organizationId: orgId, projectId: project.id, name: "Build", actorUserId: ownerId });
    expect(b.sequence).toBeGreaterThan(a.sequence);

    const list = await listPhases(db, { organizationId: orgId, projectId: project.id, actorUserId: ownerId });
    expect(list.map((p) => p.id)).toEqual([a.id, b.id]);
  });

  it("concurrency: two simultaneous phase creations never persist a duplicate sequence value", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const results = await Promise.allSettled([
      createPhase(db, { organizationId: orgId, projectId: project.id, name: "Race A", actorUserId: ownerId }),
      createPhase(db, { organizationId: orgId, projectId: project.id, name: "Race B", actorUserId: ownerId }),
    ]);

    const rows = await db.select().from(projectPhases).where(eq(projectPhases.projectId, project.id));
    const sequences = rows.map((r) => r.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
    // Under a true race for the same computed sequence, at least one side must have failed on the unique constraint.
    if (rows.length < 2) {
      expect(results.some((r) => r.status === "rejected")).toBe(true);
    }
  });
});

describe("updatePhase", () => {
  it("rejects a stale-revision update", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const phase = await createPhase(db, { organizationId: orgId, projectId: project.id, name: "Discovery", actorUserId: ownerId });

    await updatePhase(db, { organizationId: orgId, projectId: project.id, phaseId: phase.id, expectedRevision: phase.revision, actorUserId: ownerId, updates: { status: "active" } });
    await expect(updatePhase(db, { organizationId: orgId, projectId: project.id, phaseId: phase.id, expectedRevision: phase.revision, actorUserId: ownerId, updates: { status: "completed" } })).rejects.toThrow(StaleUpdateError);
  });

  it("sets completedAt when transitioned to completed", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const phase = await createPhase(db, { organizationId: orgId, projectId: project.id, name: "Discovery", actorUserId: ownerId });

    const updated = await updatePhase(db, { organizationId: orgId, projectId: project.id, phaseId: phase.id, expectedRevision: phase.revision, actorUserId: ownerId, updates: { status: "completed" } });
    expect(updated.completedAt).not.toBeNull();
  });
});

describe("reorderPhase", () => {
  it("moves a phase's own sequence to a midpoint of its new neighbors without touching other rows' ids", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const a = await createPhase(db, { organizationId: orgId, projectId: project.id, name: "A", actorUserId: ownerId });
    const b = await createPhase(db, { organizationId: orgId, projectId: project.id, name: "B", actorUserId: ownerId });
    const c = await createPhase(db, { organizationId: orgId, projectId: project.id, name: "C", actorUserId: ownerId });

    // Move C (currently last) to the front.
    const reordered = await reorderPhase(db, { organizationId: orgId, projectId: project.id, phaseId: c.id, targetIndex: 0, actorUserId: ownerId });
    expect(reordered.map((p) => p.id)).toEqual([c.id, a.id, b.id]);
  });

  it("falls back to a full renumber when the gap between neighbors is exhausted", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const a = await createPhase(db, { organizationId: orgId, projectId: project.id, name: "A", actorUserId: ownerId });
    const b = await createPhase(db, { organizationId: orgId, projectId: project.id, name: "B", actorUserId: ownerId });
    const c = await createPhase(db, { organizationId: orgId, projectId: project.id, name: "C", actorUserId: ownerId });

    // Force adjacent sequences (1, 2) so the next midpoint computation has no room left.
    await db.update(projectPhases).set({ sequence: 1 }).where(eq(projectPhases.id, a.id));
    await db.update(projectPhases).set({ sequence: 2 }).where(eq(projectPhases.id, b.id));

    const reordered = await reorderPhase(db, { organizationId: orgId, projectId: project.id, phaseId: c.id, targetIndex: 1, actorUserId: ownerId });
    expect(reordered.map((p) => p.id)).toEqual([a.id, c.id, b.id]);
    const sequences = reordered.map((p) => p.sequence);
    expect(new Set(sequences).size).toBe(3);
  });
});

describe("milestone completion", () => {
  it("is an explicit status transition, never derived from linked-task percentages", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const milestone = await createMilestone(db, { organizationId: orgId, projectId: project.id, title: "Launch", actorUserId: ownerId });
    expect(milestone.status).toBe("planned");
    expect(milestone.completedAt).toBeNull();

    const completed = await updateMilestone(db, { organizationId: orgId, projectId: project.id, milestoneId: milestone.id, expectedRevision: milestone.revision, actorUserId: ownerId, updates: { status: "completed" } });
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).not.toBeNull();
  });

  it("rejects a stale-revision milestone update", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const milestone = await createMilestone(db, { organizationId: orgId, projectId: project.id, title: "Launch", actorUserId: ownerId });

    await updateMilestone(db, { organizationId: orgId, projectId: project.id, milestoneId: milestone.id, expectedRevision: milestone.revision, actorUserId: ownerId, updates: { status: "active" } });
    await expect(updateMilestone(db, { organizationId: orgId, projectId: project.id, milestoneId: milestone.id, expectedRevision: milestone.revision, actorUserId: ownerId, updates: { status: "completed" } })).rejects.toThrow(StaleUpdateError);
  });
});
