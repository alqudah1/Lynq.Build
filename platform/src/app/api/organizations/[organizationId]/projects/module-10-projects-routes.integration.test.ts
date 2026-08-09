import { describe, it, expect, afterEach, vi } from "vitest";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData } from "@/lib/agent-runtime/test-helpers";
import { createSession } from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined),
      set: (name: string, value: string) => cookieStore.set(name, value),
      delete: (name: string) => cookieStore.delete(name),
    }),
}));

import { GET as LIST_PROJECTS, POST as CREATE_PROJECT } from "./route";
import { GET as GET_PROJECT } from "./[projectId]/route";
import { POST as TRANSITION_PROJECT } from "./[projectId]/transition/route";
import { GET as LIST_PHASES, POST as CREATE_PHASE } from "./[projectId]/phases/route";
import { GET as LIST_TASKS, POST as CREATE_TASK } from "./[projectId]/tasks/route";
import { GET as GET_TASK } from "./[projectId]/tasks/[taskId]/route";
import { POST as TRANSITION_TASK } from "./[projectId]/tasks/[taskId]/transition/route";
import { POST as ADD_DEPENDENCY } from "./[projectId]/tasks/[taskId]/dependencies/route";
import { GET as LIST_ACTIVITY } from "./[projectId]/activity/route";

afterEach(async () => {
  cookieStore.clear();
  await cleanupAgentRuntimeTestData();
});

async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
}

describe("Module 10 projects API — end-to-end wiring", () => {
  it("walks project creation through phase/task creation, dependency, transition, and activity — real HTTP-shaped requests through the real route handlers", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const createRes = await CREATE_PROJECT(jsonRequest("https://platform.example.com/x", "POST", { name: "Kids Coding Ops", projectKey: "KIDS" }), { params: Promise.resolve({ organizationId: orgId }) });
    expect(createRes.status).toBe(201);
    const project = (await createRes.json()).data as { id: string; revision: number; status: string };
    expect(project.status).toBe("proposed");

    const listRes = await LIST_PROJECTS(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId }) });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()).data as { projects: Array<{ id: string; progress: { percentage: number | null } }> };
    expect(list.projects.some((p) => p.id === project.id)).toBe(true);
    expect(list.projects.find((p) => p.id === project.id)?.progress.percentage).toBeNull();

    const getRes = await GET_PROJECT(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, projectId: project.id }) });
    expect(getRes.status).toBe(200);

    const phaseRes = await CREATE_PHASE(jsonRequest("https://platform.example.com/x", "POST", { name: "Discovery" }), { params: Promise.resolve({ organizationId: orgId, projectId: project.id }) });
    expect(phaseRes.status).toBe(201);
    const phase = (await phaseRes.json()).data as { id: string };

    const phasesRes = await LIST_PHASES(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, projectId: project.id }) });
    expect(((await phasesRes.json()).data as { phases: unknown[] }).phases).toHaveLength(1);

    const taskARes = await CREATE_TASK(jsonRequest("https://platform.example.com/x", "POST", { title: "Set up repo", phaseId: phase.id }), { params: Promise.resolve({ organizationId: orgId, projectId: project.id }) });
    expect(taskARes.status).toBe(201);
    const taskA = (await taskARes.json()).data as { id: string; revision: number };

    const taskBRes = await CREATE_TASK(jsonRequest("https://platform.example.com/x", "POST", { title: "Write curriculum" }), { params: Promise.resolve({ organizationId: orgId, projectId: project.id }) });
    const taskB = (await taskBRes.json()).data as { id: string; revision: number };

    const tasksRes = await LIST_TASKS(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, projectId: project.id }) });
    expect(((await tasksRes.json()).data as { tasks: unknown[] }).tasks).toHaveLength(2);

    // taskB is blocked by taskA.
    const depRes = await ADD_DEPENDENCY(jsonRequest("https://platform.example.com/x", "POST", { blockingTaskId: taskA.id }), { params: Promise.resolve({ organizationId: orgId, projectId: project.id, taskId: taskB.id }) });
    expect(depRes.status).toBe(201);

    const readyA = await TRANSITION_TASK(jsonRequest("https://platform.example.com/x", "POST", { toStatus: "ready", expectedRevision: taskA.revision }), { params: Promise.resolve({ organizationId: orgId, projectId: project.id, taskId: taskA.id }) });
    expect(readyA.status).toBe(200);

    const getTaskRes = await GET_TASK(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, projectId: project.id, taskId: taskB.id }) });
    const taskBView = (await getTaskRes.json()).data as { dependencies: { blockedBy: unknown[] } };
    expect(taskBView.dependencies.blockedBy).toHaveLength(1);

    const transitionRes = await TRANSITION_PROJECT(jsonRequest("https://platform.example.com/x", "POST", { toStatus: "planning", expectedRevision: project.revision }), { params: Promise.resolve({ organizationId: orgId, projectId: project.id }) });
    expect(transitionRes.status).toBe(200);

    const activityRes = await LIST_ACTIVITY(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, projectId: project.id }) });
    const activity = (await activityRes.json()).data as { events: Array<{ eventType: string }> };
    expect(activity.events.some((e) => e.eventType === "project_created")).toBe(true);
    expect(activity.events.some((e) => e.eventType === "project_status_changed")).toBe(true);
  });

  it("returns 404 for a project belonging to a different organization (cross-tenant isolation through the route layer)", async () => {
    const ownerA = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const createRes = await (async () => {
      await authenticateAs(ownerA);
      return CREATE_PROJECT(jsonRequest("https://platform.example.com/x", "POST", { name: "Org A Project", projectKey: "ORGA" }), { params: Promise.resolve({ organizationId: orgA }) });
    })();
    const project = (await createRes.json()).data as { id: string };

    const ownerB = await makeUser();
    const orgB = await makeOrgWithOwner(ownerB);
    await authenticateAs(ownerB);

    const res = await GET_PROJECT(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgB, projectId: project.id }) });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid project key with a 400, never reaching the database", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const res = await CREATE_PROJECT(jsonRequest("https://platform.example.com/x", "POST", { name: "Bad Key", projectKey: "lowercase" }), { params: Promise.resolve({ organizationId: orgId }) });
    expect(res.status).toBe(400);
  });

  it("rejects an unauthenticated request", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const res = await LIST_PROJECTS(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId }) });
    expect(res.status).toBe(401);
  });
});
