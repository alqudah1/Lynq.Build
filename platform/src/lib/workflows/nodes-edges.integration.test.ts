import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData } from "./test-helpers";
import { createWorkflowDefinition } from "./definitions";
import { createWorkflowVersion } from "./versions";
import { createWorkflowNode } from "./nodes";
import { createWorkflowEdge } from "./edges";
import { DuplicateNodeKeyError, SelfEdgeError, DuplicateEdgeError, CrossVersionEdgeError, InvalidNodeConfigurationError } from "./errors";

afterEach(cleanupAgentRuntimeTestData);

async function setup(key: string) {
  const ownerId = await makeUser();
  const orgId = await makeOrgWithOwner(ownerId);
  const definition = await createWorkflowDefinition(db, { organizationId: orgId, name: key, workflowKey: key, actorUserId: ownerId });
  const version = await createWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
  return { ownerId, orgId, definition, version };
}

describe("createWorkflowNode", () => {
  it("rejects a duplicate node key within the same version", async () => {
    const { orgId, ownerId, definition, version } = await setup("DUPNODE");
    await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    await expect(createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "end", name: "Also start key", actorUserId: ownerId })).rejects.toThrow(DuplicateNodeKeyError);
  });

  it("rejects configuration that does not match the declared node type", async () => {
    const { orgId, ownerId, definition, version } = await setup("BADCFG");
    await expect(
      createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "wait_node", nodeType: "wait", name: "Wait", configuration: { untilTimestamp: "2026-01-01T00:00:00Z", durationSeconds: 60 }, actorUserId: ownerId })
    ).rejects.toThrow(InvalidNodeConfigurationError);
  });

  it("concurrency: a simultaneous duplicate node-key race lets exactly one creation succeed", async () => {
    const { orgId, ownerId, definition, version } = await setup("RACENODE");
    const results = await Promise.allSettled([
      createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start A", actorUserId: ownerId }),
      createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start B", actorUserId: ownerId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("createWorkflowEdge", () => {
  it("rejects a self-edge", async () => {
    const { orgId, ownerId, definition, version } = await setup("SELFEDGE");
    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    await expect(createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: start.id, actorUserId: ownerId })).rejects.toThrow(SelfEdgeError);
  });

  it("rejects a duplicate edge (same source, target, and condition key)", async () => {
    const { orgId, ownerId, definition, version } = await setup("DUPEDGE");
    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const end = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: end.id, actorUserId: ownerId });
    await expect(createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: end.id, actorUserId: ownerId })).rejects.toThrow(DuplicateEdgeError);
  });

  it("rejects an edge between nodes in different versions", async () => {
    const { orgId, ownerId, definition, version: versionA } = await setup("CROSSVER");
    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: versionA.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });

    const versionB = await createWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, changeReason: "second draft", actorUserId: ownerId });
    const endInOtherVersion = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: versionB.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });

    await expect(createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: versionA.id, sourceNodeId: start.id, targetNodeId: endInOtherVersion.id, actorUserId: ownerId })).rejects.toThrow(CrossVersionEdgeError);
  });

  it("concurrency: a simultaneous duplicate-edge race lets exactly one creation succeed", async () => {
    const { orgId, ownerId, definition, version } = await setup("RACEEDGE");
    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const end = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });

    const results = await Promise.allSettled([
      createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: end.id, actorUserId: ownerId }),
      createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: end.id, actorUserId: ownerId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});
