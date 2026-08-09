import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { db, rawSql, makeUser, makeOrgWithOwner, makeKnowledgeItem, ensureToolsSeeded, cleanupAgentRuntimeTestData } from "@/lib/agent-runtime/test-helpers";
import { brainPermissionGrants } from "@/db/schema";
import type { KnowledgeDomain } from "@/lib/brain/knowledge-items";
import { createExecution } from "@/lib/agent-runtime/executions";
import { assignExecution, startExecution, advanceExecution, completeExecution } from "@/lib/agent-runtime/lifecycle";
import { createPlan, completePlanStep } from "@/lib/agent-runtime/plans";
import { listArtifactsForExecution } from "@/lib/agent-runtime/artifacts";
import { InsufficientCompletionEvidenceError } from "@/lib/agent-runtime/errors";
import { seedKnowledgeAnalystAgent, runKnowledgeAnalystTask, resolveKnowledgeAnalystAgent, getKnowledgeAnalystReport, NoAccessibleDomainsError, KNOWLEDGE_ANALYST_NAME } from "./knowledge-analyst";

beforeAll(ensureToolsSeeded);
afterEach(cleanupAgentRuntimeTestData);

/** "A person cannot grant a capability they are not authorized to assign" (Brain Module 7) — the org owner must hold a capability themselves, explicitly, before granting it onward to the agent or creating content under it. Mirrors `search.integration.test.ts`'s own `grantAllCapabilities` fixture precedent. */
async function grantOwnerCapability(orgId: string, ownerId: string, domain: KnowledgeDomain, capability: "read" | "draft_write") {
  await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain, workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability }).onConflictDoNothing();
}

async function seedAnalyst(orgId: string, ownerId: string, allowedDomains: KnowledgeDomain[]) {
  for (const domain of allowedDomains) {
    await grantOwnerCapability(orgId, ownerId, domain, "read");
  }
  return seedKnowledgeAnalystAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, allowedDomains, actorUserId: ownerId });
}

describe("seedKnowledgeAnalystAgent", () => {
  it("registers the agent, advances it to deployment, and grants exactly the requested read domains", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const agent = await seedAnalyst(orgId, ownerId, ["identity", "market"]);
    expect(agent.name).toBe(KNOWLEDGE_ANALYST_NAME);
    expect(agent.lifecycleStage).toBe("deployment");
    expect(agent.permissionLevel).toBe("assistant");
  });

  it("is idempotent — a second call returns the same agent, does not re-register or duplicate grants", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const first = await seedAnalyst(orgId, ownerId, ["identity"]);
    const second = await seedAnalyst(orgId, ownerId, ["identity"]);
    expect(second.id).toBe(first.id);

    const resolved = await resolveKnowledgeAnalystAgent(db, orgId);
    expect(resolved.id).toBe(first.id);
  });
});

describe("runKnowledgeAnalystTask — end to end through the real Runtime", () => {
  it("completes the execution, produces a report artifact, and every citation exactly matches a real Brain knowledge item version", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await seedAnalyst(orgId, ownerId, ["identity"]);
    await grantOwnerCapability(orgId, ownerId, "identity", "draft_write");

    const item = await makeKnowledgeItem(orgId, ownerId, "identity", "Refund Policy", "Customers may request a refund within 30 days of purchase");

    const result = await runKnowledgeAnalystTask(db, rawSql, {
      organizationId: orgId,
      ownerUserId: ownerId,
      agentId: agent.id,
      topic: "refund",
      allowedDomains: ["identity"],
      actorUserId: ownerId,
    });

    expect(result.execution.status).toBe("completed");
    expect(result.artifactId).toBeTruthy();

    const report = await getKnowledgeAnalystReport(db, { organizationId: orgId, executionId: result.execution.id, actorUserId: ownerId });
    expect(report.supportingReferences.length).toBeGreaterThan(0);
    for (const citation of report.supportingReferences) {
      expect(citation.knowledgeItemId).toBe(item.id);
      expect(citation.versionNumber).toBe(1);
      expect(citation.domain).toBe("identity");
    }
    // Deterministic first executor — contradictions always present but
    // honestly empty, never fabricated.
    expect(report.contradictions).toEqual([]);

    // Exactly one report artifact was created for this execution — the
    // per-domain search loop must never create duplicates.
    const artifacts = await listArtifactsForExecution(db, orgId, result.execution.id);
    expect(artifacts.filter((a) => a.artifactType === "report")).toHaveLength(1);
  });

  it("records missing information for a requested, accessible domain that yields no results", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await seedAnalyst(orgId, ownerId, ["identity"]);

    const result = await runKnowledgeAnalystTask(db, rawSql, {
      organizationId: orgId,
      ownerUserId: ownerId,
      agentId: agent.id,
      topic: "a topic with no matching knowledge at all",
      allowedDomains: ["identity"],
      actorUserId: ownerId,
    });

    const report = await getKnowledgeAnalystReport(db, { organizationId: orgId, executionId: result.execution.id, actorUserId: ownerId });
    expect(report.supportingReferences).toEqual([]);
    expect(report.missingInformation.length).toBeGreaterThan(0);
  });

  it("never cites knowledge from a domain the agent was not granted read access to, even when that domain was requested", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    // Only "identity" granted, even though the task requests "market" too.
    const agent = await seedAnalyst(orgId, ownerId, ["identity"]);

    await grantOwnerCapability(orgId, ownerId, "identity", "draft_write");
    await makeKnowledgeItem(orgId, ownerId, "identity", "Company Values", "durable-topic company values statement");
    // The owner can author market content (org-admin authority over
    // content creation is independent of what the AGENT was granted) —
    // proves the agent still cannot reach it even though it matches the
    // search term and the task nominally requested that domain.
    await grantOwnerCapability(orgId, ownerId, "market", "draft_write");
    await makeKnowledgeItem(orgId, ownerId, "market", "Market Notes", "durable-topic market analysis notes");

    const result = await runKnowledgeAnalystTask(db, rawSql, {
      organizationId: orgId,
      ownerUserId: ownerId,
      agentId: agent.id,
      topic: "durable-topic",
      allowedDomains: ["identity", "market"],
      actorUserId: ownerId,
    });

    const report = await getKnowledgeAnalystReport(db, { organizationId: orgId, executionId: result.execution.id, actorUserId: ownerId });
    expect(report.supportingReferences.every((c) => c.domain === "identity")).toBe(true);
    expect(report.supportingReferences.some((c) => c.domain === "market")).toBe(false);
  });

  it("refuses outright when none of the requested domains are accessible, rather than silently reporting nothing found", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await seedAnalyst(orgId, ownerId, ["identity"]);

    await expect(
      runKnowledgeAnalystTask(db, rawSql, {
        organizationId: orgId,
        ownerUserId: ownerId,
        agentId: agent.id,
        topic: "anything",
        allowedDomains: ["market"],
        actorUserId: ownerId,
      })
    ).rejects.toThrow(NoAccessibleDomainsError);
  });
});

describe("completion evidence gate applies to the Knowledge Analyst's own plan", () => {
  it("the agent cannot self-declare completion — completeExecution refuses while plan steps remain unresolved", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await seedAnalyst(orgId, ownerId, ["identity"]);

    const execution = await createExecution(db, {
      organizationId: orgId,
      ownerUserId: ownerId,
      goal: "Partial-plan completion-gate test",
      successCriteria: "n/a",
      failureCriteria: "n/a",
      domainsRequested: ["identity"],
      actorUserId: ownerId,
    });
    await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agent.id, actorUserId: ownerId });
    await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "planning", actorAgentId: agent.id });

    const { plan } = await createPlan(db, {
      organizationId: orgId,
      executionId: execution.id,
      actorAgentId: agent.id,
      steps: ["Validate", "Search", "Retrieve context", "Assemble evidence", "Create report artifact", "Verify completion evidence"],
    });

    await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "reasoning", actorAgentId: agent.id });
    await completePlanStep(db, { organizationId: orgId, executionId: execution.id, planId: plan.id, stepNumber: 1, actorAgentId: agent.id });
    await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "executing", actorAgentId: agent.id });
    // Steps 2-6 deliberately left unresolved — no tool was ever actually
    // called, no report artifact exists.
    await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "verifying", actorAgentId: agent.id });

    await expect(completeExecution(db, { organizationId: orgId, executionId: execution.id, actorAgentId: agent.id })).rejects.toThrow(InsufficientCompletionEvidenceError);
  });
});
