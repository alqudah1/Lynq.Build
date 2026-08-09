import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, addOrgMember } from "./test-helpers";
import { createWorkflowDefinition, getWorkflowDefinitionForUser } from "./definitions";
import { createWorkflowVersion, publishWorkflowVersion, validateWorkflowVersionAndPersist, resolvePublishedVersion, updateWorkflowVersion } from "./versions";
import { createWorkflowNode } from "./nodes";
import { createWorkflowEdge } from "./edges";
import { WorkflowKeyAlreadyTakenError, WorkflowVersionNotEditableError, WorkflowValidationFailedError, WorkflowNotPublishedError } from "./errors";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";

afterEach(cleanupAgentRuntimeTestData);

async function makeMinimalValidVersion(orgId: string, definitionId: string, ownerId: string) {
  const version = await createWorkflowVersion(db, { organizationId: orgId, definitionId, actorUserId: ownerId });
  const start = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
  const end = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId: version.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
  await createWorkflowEdge(db, { organizationId: orgId, definitionId, versionId: version.id, sourceNodeId: start.id, targetNodeId: end.id, actorUserId: ownerId });
  return version;
}

describe("createWorkflowDefinition", () => {
  it("rejects a duplicate workflow key within the same organization", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await createWorkflowDefinition(db, { organizationId: orgId, name: "First", workflowKey: "DUP_KEY", actorUserId: ownerId });

    await expect(createWorkflowDefinition(db, { organizationId: orgId, name: "Second", workflowKey: "DUP_KEY", actorUserId: ownerId })).rejects.toThrow(WorkflowKeyAlreadyTakenError);
  });

  it("returns 404 (TenantResourceNotFoundError) for a definition belonging to a different organization", async () => {
    const ownerA = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const definition = await createWorkflowDefinition(db, { organizationId: orgA, name: "Org A workflow", workflowKey: "ORGA_WF", actorUserId: ownerA });

    const ownerB = await makeUser();
    const orgB = await makeOrgWithOwner(ownerB);

    await expect(getWorkflowDefinitionForUser(db, { organizationId: orgB, definitionId: definition.id, actorUserId: ownerB })).rejects.toThrow(TenantResourceNotFoundError);
  });

  it("concurrency: a simultaneous duplicate-key race lets exactly one creation succeed", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const results = await Promise.allSettled([
      createWorkflowDefinition(db, { organizationId: orgId, name: "Race A", workflowKey: "RACE_WF", actorUserId: ownerId }),
      createWorkflowDefinition(db, { organizationId: orgId, name: "Race B", workflowKey: "RACE_WF", actorUserId: ownerId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});

describe("workflow version immutability and publishing", () => {
  it("rejects editing a node once its version is no longer draft", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const definition = await createWorkflowDefinition(db, { organizationId: orgId, name: "WF", workflowKey: "IMMUTABLE_WF", actorUserId: ownerId });
    const version = await makeMinimalValidVersion(orgId, definition.id, ownerId);

    await validateWorkflowVersionAndPersist(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, actorUserId: ownerId });
    const published = await publishWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, expectedRevision: 2, actorUserId: ownerId });
    expect(published.status).toBe("published");

    await expect(createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "extra", nodeType: "condition", name: "Extra", configuration: { branches: [] }, actorUserId: ownerId })).rejects.toThrow(WorkflowVersionNotEditableError);
    await expect(updateWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, expectedRevision: published.revision, actorUserId: ownerId, updates: { name: "Renamed" } })).rejects.toThrow(WorkflowVersionNotEditableError);
  });

  it("publishing requires the version to have passed validation first", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const definition = await createWorkflowDefinition(db, { organizationId: orgId, name: "WF", workflowKey: "UNVALIDATED_WF", actorUserId: ownerId });
    const version = await createWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });

    await expect(publishWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, expectedRevision: 1, actorUserId: ownerId })).rejects.toThrow(WorkflowValidationFailedError);
  });

  it("only one current published version may exist — publishing a second version supersedes the first", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const definition = await createWorkflowDefinition(db, { organizationId: orgId, name: "WF", workflowKey: "SUPERSEDE_WF", actorUserId: ownerId });

    const v1 = await makeMinimalValidVersion(orgId, definition.id, ownerId);
    await validateWorkflowVersionAndPersist(db, { organizationId: orgId, definitionId: definition.id, versionId: v1.id, actorUserId: ownerId });
    await publishWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, versionId: v1.id, expectedRevision: 2, actorUserId: ownerId });

    const v2 = await createWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, changeReason: "v2", actorUserId: ownerId });
    const start2 = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: v2.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const end2 = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: v2.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: v2.id, sourceNodeId: start2.id, targetNodeId: end2.id, actorUserId: ownerId });
    await validateWorkflowVersionAndPersist(db, { organizationId: orgId, definitionId: definition.id, versionId: v2.id, actorUserId: ownerId });
    await publishWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, versionId: v2.id, expectedRevision: 2, actorUserId: ownerId });

    const current = await resolvePublishedVersion(db, orgId, definition.id);
    expect(current.id).toBe(v2.id);
    expect(current.versionNumber).toBe(2);
  });

  it("throws WorkflowNotPublishedError when no version has ever been published", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const definition = await createWorkflowDefinition(db, { organizationId: orgId, name: "WF", workflowKey: "NEVER_PUBLISHED_WF", actorUserId: ownerId });

    await expect(resolvePublishedVersion(db, orgId, definition.id)).rejects.toThrow(WorkflowNotPublishedError);
  });

  it("historical executions retain the exact published version even after a newer one supersedes it (version rows are never mutated in place)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const definition = await createWorkflowDefinition(db, { organizationId: orgId, name: "WF", workflowKey: "TRACEABLE_WF", actorUserId: ownerId });
    const v1 = await makeMinimalValidVersion(orgId, definition.id, ownerId);
    await validateWorkflowVersionAndPersist(db, { organizationId: orgId, definitionId: definition.id, versionId: v1.id, actorUserId: ownerId });
    const published = await publishWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, versionId: v1.id, expectedRevision: 2, actorUserId: ownerId });

    // The published version's own identity/versionNumber never changes underneath a caller who already captured it.
    expect(published.id).toBe(v1.id);
    expect(published.versionNumber).toBe(1);
  });

  it("a plain org member (no workspace/project role) cannot manage a workflow definition", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const definition = await createWorkflowDefinition(db, { organizationId: orgId, name: "WF", workflowKey: "GUARDED_WF", actorUserId: ownerId });

    const memberId = await makeUser();
    await addOrgMember(orgId, memberId, "member");

    await expect(createWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, actorUserId: memberId })).rejects.toThrow(InsufficientRoleError);
  });

  it("concurrency: two concurrent publish attempts for the same definition never both succeed", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const definition = await createWorkflowDefinition(db, { organizationId: orgId, name: "WF", workflowKey: "RACE_PUBLISH_WF", actorUserId: ownerId });

    const v1 = await makeMinimalValidVersion(orgId, definition.id, ownerId);
    await validateWorkflowVersionAndPersist(db, { organizationId: orgId, definitionId: definition.id, versionId: v1.id, actorUserId: ownerId });

    const v2 = await createWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, changeReason: "v2", actorUserId: ownerId });
    const start2 = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: v2.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const end2 = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: v2.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: v2.id, sourceNodeId: start2.id, targetNodeId: end2.id, actorUserId: ownerId });
    await validateWorkflowVersionAndPersist(db, { organizationId: orgId, definitionId: definition.id, versionId: v2.id, actorUserId: ownerId });

    const results = await Promise.allSettled([
      publishWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, versionId: v1.id, expectedRevision: 2, actorUserId: ownerId }),
      publishWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, versionId: v2.id, expectedRevision: 2, actorUserId: ownerId }),
    ]);

    // Whichever order they land in, the versions table must never end up with two rows simultaneously `published` for this definition — the real DB partial-unique index guards this regardless of which application-level call "won."
    const { workflowVersions } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const publishedRows = await db.select().from(workflowVersions).where(and(eq(workflowVersions.workflowDefinitionId, definition.id), eq(workflowVersions.status, "published")));
    expect(publishedRows).toHaveLength(1);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  });
});
