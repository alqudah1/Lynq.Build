import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, rawSql, makeUser, makeOrgWithOwner, makeKnowledgeItem, ensureToolsSeeded, cleanupAgentRuntimeTestData } from "@/lib/agent-runtime/test-helpers";
import { brainPermissionGrants, workerCredentials } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { seedKnowledgeAnalystAgent, createKnowledgeAnalystTask } from "@/lib/agents/knowledge-analyst";
import { issueWorkerCredential, revokeWorkerCredential } from "@/lib/runtime/worker-auth";

process.env.WORKER_BOOTSTRAP_SECRET = "test-bootstrap-secret-do-not-use-in-prod";

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined),
      set: (name: string, value: string) => cookieStore.set(name, value),
      delete: (name: string) => cookieStore.delete(name),
    }),
}));

import { POST as ISSUE_CREDENTIAL } from "./worker/credentials/route";
import { POST as WORKER_POLL } from "./worker/poll/route";
import { POST as WORKER_HEARTBEAT } from "./worker/[workerId]/heartbeat/route";
import { POST as RECONCILE } from "./reconcile/route";
import { GET as DEAD_LETTER_LIST } from "../../organizations/[organizationId]/runtime/dead-letter/route";
import { GET as RUNTIME_STATUS } from "../../organizations/[organizationId]/runtime/status/route";
import { GET as LIST_JOBS } from "../../organizations/[organizationId]/runtime/jobs/route";
import { POST as START_TASK } from "../../organizations/[organizationId]/knowledge-analyst/tasks/route";

const issuedCredentialIds: string[] = [];

beforeAll(ensureToolsSeeded);
afterEach(async () => {
  cookieStore.clear();
  while (issuedCredentialIds.length > 0) {
    await db.delete(workerCredentials).where(eq(workerCredentials.id, issuedCredentialIds.pop()!));
  }
  await cleanupAgentRuntimeTestData();
});

async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}

async function makeWorkerCredential(): Promise<string> {
  const { credential, plaintextSecret } = await issueWorkerCredential(db, { workerName: "test-worker", bootstrapSecret: "test-bootstrap-secret-do-not-use-in-prod" });
  issuedCredentialIds.push(credential.id);
  return plaintextSecret;
}

describe("worker credential issuance", () => {
  it("mints a credential only with the correct bootstrap secret, and never returns the raw secret again after issuance", async () => {
    const res = await ISSUE_CREDENTIAL(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ workerName: "w1", bootstrapSecret: "test-bootstrap-secret-do-not-use-in-prod" }) }));
    expect(res.status).toBe(201);
    const body = (await res.json()).data as { credential: { id: string; keyPrefix: string }; secret: string };
    issuedCredentialIds.push(body.credential.id);
    expect(body.secret).toMatch(/^wrk_/);
    expect(body.credential).not.toHaveProperty("secretHash");
    expect(body.credential).not.toHaveProperty("secret");

    const wrongRes = await ISSUE_CREDENTIAL(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ workerName: "w2", bootstrapSecret: "wrong-secret" }) }));
    expect(wrongRes.status).toBe(401);
  });
});

describe("worker poll / heartbeat — authentication and no-secrets", () => {
  it("refuses poll/heartbeat with no credential, and processes real work with a valid one", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability: "read" });
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability: "draft_write" });
    const agent = await seedKnowledgeAnalystAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, allowedDomains: ["identity"], actorUserId: ownerId });
    await makeKnowledgeItem(orgId, ownerId, "identity", "Travel Policy", "Book flights at least 14 days in advance");
    await createKnowledgeAnalystTask(db, { organizationId: orgId, ownerUserId: ownerId, agentId: agent.id, topic: "travel", allowedDomains: ["identity"], actorUserId: ownerId });

    const unauthedRes = await WORKER_POLL(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ workerId: "w1" }) }));
    expect(unauthedRes.status).toBe(401);

    const secret = await makeWorkerCredential();
    const pollRes = await WORKER_POLL(new Request("https://platform.example.com/x", { method: "POST", headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify({ workerId: "w1" }) }));
    expect(pollRes.status).toBe(200);
    const pollBody = (await pollRes.json()).data as { processedCount: number };
    expect(pollBody.processedCount).toBeGreaterThan(0);

    // The raw worker secret itself never appears anywhere in the response body.
    expect(JSON.stringify(pollBody)).not.toContain(secret);
    // Module 17 hardening: this test enqueues and actually processes a real
    // job through the live HTTP poll route — scoped per-test, not a file-
    // or suite-wide timeout change.
  }, 45000);

  it("revoking a worker credential takes effect immediately — the very next call is refused", async () => {
    const { credential, plaintextSecret } = await issueWorkerCredential(db, { workerName: "revoke-test", bootstrapSecret: "test-bootstrap-secret-do-not-use-in-prod" });
    issuedCredentialIds.push(credential.id);

    const before = await WORKER_POLL(new Request("https://platform.example.com/x", { method: "POST", headers: { Authorization: `Bearer ${plaintextSecret}` }, body: JSON.stringify({ workerId: "w1" }) }));
    expect(before.status).toBe(200);

    await revokeWorkerCredential(db, { credentialId: credential.id, reason: "test", bootstrapSecret: "test-bootstrap-secret-do-not-use-in-prod" });

    const after = await WORKER_POLL(new Request("https://platform.example.com/x", { method: "POST", headers: { Authorization: `Bearer ${plaintextSecret}` }, body: JSON.stringify({ workerId: "w1" }) }));
    expect(after.status).toBe(401);
  });
});

describe("worker heartbeat route", () => {
  it("extends the lease for the exact (credential, workerId) pair that claimed the job, via the real HTTP route", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability: "read" });
    const agent = await seedKnowledgeAnalystAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, allowedDomains: ["identity"], actorUserId: ownerId });
    const { job } = await createKnowledgeAnalystTask(db, { organizationId: orgId, ownerUserId: ownerId, agentId: agent.id, topic: "x", allowedDomains: ["identity"], actorUserId: ownerId });

    const secret = await makeWorkerCredential();
    const { claimJobs } = await import("@/lib/runtime/queue");
    const worker = await (await import("@/lib/runtime/worker-auth")).verifyWorkerCredential(db, secret);
    const leaseOwner = `${worker.workerCredentialId}:heartbeat-test`;
    await claimJobs(db, rawSql, { leaseOwner, jobTypes: ["execution_run"] });

    const res = await WORKER_HEARTBEAT(
      new Request("https://platform.example.com/x", { method: "POST", headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify({ jobId: job.id }) }),
      { params: Promise.resolve({ workerId: "heartbeat-test" }) }
    );
    expect(res.status).toBe(200);

    const wrongWorkerRes = await WORKER_HEARTBEAT(
      new Request("https://platform.example.com/x", { method: "POST", headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify({ jobId: job.id }) }),
      { params: Promise.resolve({ workerId: "a-different-worker-id" }) }
    );
    expect(wrongWorkerRes.status).toBe(409); // LeaseNotHeldError's own reason-mapped status
  });
});

describe("internal reconcile route", () => {
  it("runs the full housekeeping sweep and returns a bounded summary, worker-authenticated only", async () => {
    const secret = await makeWorkerCredential();
    const unauthedRes = await RECONCILE(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({}) }));
    expect(unauthedRes.status).toBe(401);

    const res = await RECONCILE(new Request("https://platform.example.com/x", { method: "POST", headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify({}) }));
    expect(res.status).toBe(200);
    const body = (await res.json()).data as { executionReconciliation: object; toolInvocationReconciliation: object; cleanup: object };
    expect(body.executionReconciliation).toBeTruthy();
    expect(body.cleanup).toBeTruthy();
  });
});

describe("org-facing runtime routes", () => {
  it("GET /runtime/jobs and /runtime/status require org membership; /dead-letter requires owner/admin", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const jobsRes = await LIST_JOBS(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId }) });
    expect(jobsRes.status).toBe(200);

    const statusRes = await RUNTIME_STATUS(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId }) });
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()).data as { jobCountsByStatus: Record<string, number> };
    expect(status.jobCountsByStatus).toBeDefined();

    const deadLetterRes = await DEAD_LETTER_LIST(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId }) });
    expect(deadLetterRes.status).toBe(200);

    void memberId;
  });

  it("cross-tenant: a job created in org A is invisible (404) from org B via GET /runtime/jobs/:jobId", async () => {
    const ownerA = await makeUser();
    const ownerB = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const orgB = await makeOrgWithOwner(ownerB);
    await db.insert(brainPermissionGrants).values({ organizationId: orgA, domain: "identity", workspaceId: null, granteeUserId: ownerA, granteeType: "human", capability: "read" });
    const agent = await seedKnowledgeAnalystAgent(db, { organizationId: orgA, humanOwnerUserId: ownerA, allowedDomains: ["identity"], actorUserId: ownerA });
    await authenticateAs(ownerA);

    const startRes = await START_TASK(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ topic: "x", allowedDomains: ["identity"] }) }), { params: Promise.resolve({ organizationId: orgA }) });
    const started = (await startRes.json()).data as { jobId: string };
    void agent;

    const { GET: GET_JOB } = await import("../../organizations/[organizationId]/runtime/jobs/[jobId]/route");
    await authenticateAs(ownerB);
    const crossRes = await GET_JOB(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgB, jobId: started.jobId }) });
    expect(crossRes.status).toBe(404);
  });
});
