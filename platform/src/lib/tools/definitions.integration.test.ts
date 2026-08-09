import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, makeUser, cleanupAgentRuntimeTestData } from "@/lib/agent-runtime/test-helpers";
import { toolDefinitions } from "@/db/schema";
import { registerTool, getCurrentToolVersion, getToolVersion, listTools, updateToolConfiguration, enableTool, disableTool, resolveToolForExecution } from "./definitions";
import { ToolNotFoundError, ToolDisabledError } from "./errors";

const testedKeys: string[] = [];

function uniqueKey(): string {
  const key = `test.definitions.${randomUUID()}`;
  testedKeys.push(key);
  return key;
}

afterEach(async () => {
  while (testedKeys.length > 0) {
    const key = testedKeys.pop()!;
    await db.delete(toolDefinitions).where(eq(toolDefinitions.toolKey, key));
  }
  await cleanupAgentRuntimeTestData();
});

const baseInput = {
  name: "Test Tool",
  description: "A tool registered only for this test file.",
  category: "internal_api" as const,
  inputSchema: { foo: "string" },
  outputSchema: { bar: "string" },
  riskLevel: "low" as const,
};

describe("registerTool", () => {
  it("creates version 1, resolvable by getCurrentToolVersion and getToolVersion", async () => {
    const toolKey = uniqueKey();
    const created = await registerTool(db, { ...baseInput, toolKey, sideEffectClass: "read_only" });
    expect(created.version).toBe(1);
    expect(created.enabled).toBe(true);

    const current = await getCurrentToolVersion(db, toolKey);
    expect(current?.id).toBe(created.id);

    const exact = await getToolVersion(db, toolKey, 1);
    expect(exact?.id).toBe(created.id);

    const missing = await getToolVersion(db, toolKey, 2);
    expect(missing).toBeNull();
  });

  it("forces approvalRequired=true for destructive/financial/permission_changing regardless of caller input", async () => {
    for (const sideEffectClass of ["destructive", "financial", "permission_changing"] as const) {
      const toolKey = uniqueKey();
      const created = await registerTool(db, { ...baseInput, toolKey, sideEffectClass, approvalRequired: false });
      expect(created.approvalRequired).toBe(true);
    }
  });

  it("leaves approvalRequired as requested for read_only/internal_write/external_write", async () => {
    const toolKey = uniqueKey();
    const created = await registerTool(db, { ...baseInput, toolKey, sideEffectClass: "internal_write", approvalRequired: false });
    expect(created.approvalRequired).toBe(false);
  });

  it("the database CHECK constraint itself refuses a high-risk row with approvalRequired=false, bypassing the application layer", async () => {
    const toolKey = uniqueKey();
    await expect(
      db.insert(toolDefinitions).values({
        toolKey,
        version: 1,
        name: "Raw insert",
        description: "Bypasses registerTool's own forcing logic",
        category: "internal_api",
        inputSchema: {},
        outputSchema: {},
        riskLevel: "critical",
        sideEffectClass: "destructive",
        approvalRequired: false,
      })
    ).rejects.toThrow();
  });
});

describe("updateToolConfiguration", () => {
  it("always inserts version N+1 and never edits the prior version in place — old executions keep resolving the exact version they used", async () => {
    const toolKey = uniqueKey();
    await registerTool(db, { ...baseInput, toolKey, sideEffectClass: "read_only" });

    const v2 = await updateToolConfiguration(db, { toolKey, changeReason: "Widened description", description: "Updated description" });
    expect(v2.version).toBe(2);
    expect(v2.description).toBe("Updated description");

    const v1 = await getToolVersion(db, toolKey, 1);
    expect(v1?.description).toBe(baseInput.description);

    const current = await getCurrentToolVersion(db, toolKey);
    expect(current?.version).toBe(2);
  });

  it("re-applies the high-risk-forces-approval rule on every new version", async () => {
    const toolKey = uniqueKey();
    await registerTool(db, { ...baseInput, toolKey, sideEffectClass: "read_only" });
    const v2 = await updateToolConfiguration(db, { toolKey, changeReason: "Escalate risk", sideEffectClass: "destructive", approvalRequired: false });
    expect(v2.approvalRequired).toBe(true);
  });

  it("throws ToolNotFoundError for an unregistered key", async () => {
    await expect(updateToolConfiguration(db, { toolKey: "test.definitions.never-registered", changeReason: "n/a" })).rejects.toThrow(ToolNotFoundError);
  });
});

describe("enableTool / disableTool", () => {
  it("toggles enabled on the current version only", async () => {
    const toolKey = uniqueKey();
    await registerTool(db, { ...baseInput, toolKey, sideEffectClass: "read_only" });
    const ownerId = await makeUser();

    const disabled = await disableTool(db, toolKey, ownerId);
    expect(disabled.enabled).toBe(false);

    const enabled = await enableTool(db, toolKey, ownerId);
    expect(enabled.enabled).toBe(true);
  });
});

describe("resolveToolForExecution", () => {
  it("throws ToolNotFoundError for an unregistered key", async () => {
    await expect(resolveToolForExecution(db, "test.definitions.never-registered")).rejects.toThrow(ToolNotFoundError);
  });

  it("throws ToolDisabledError for a disabled tool", async () => {
    const toolKey = uniqueKey();
    await registerTool(db, { ...baseInput, toolKey, sideEffectClass: "read_only" });
    await disableTool(db, toolKey, await makeUser());
    await expect(resolveToolForExecution(db, toolKey)).rejects.toThrow(ToolDisabledError);
  });

  it("resolves the current version of an enabled tool", async () => {
    const toolKey = uniqueKey();
    const created = await registerTool(db, { ...baseInput, toolKey, sideEffectClass: "read_only" });
    const resolved = await resolveToolForExecution(db, toolKey);
    expect(resolved.id).toBe(created.id);
  });
});

describe("listTools", () => {
  it("dedupes to exactly the current version per key, and onlyEnabled filters out disabled tools", async () => {
    const toolKeyA = uniqueKey();
    const toolKeyB = uniqueKey();
    await registerTool(db, { ...baseInput, toolKey: toolKeyA, sideEffectClass: "read_only" });
    await updateToolConfiguration(db, { toolKey: toolKeyA, changeReason: "v2" });
    await registerTool(db, { ...baseInput, toolKey: toolKeyB, sideEffectClass: "read_only" });
    await disableTool(db, toolKeyB, await makeUser());

    const all = await listTools(db);
    const rowA = all.find((t) => t.toolKey === toolKeyA);
    const rowB = all.find((t) => t.toolKey === toolKeyB);
    expect(rowA?.version).toBe(2);
    expect(rowB?.version).toBe(1);

    const onlyEnabled = await listTools(db, { onlyEnabled: true });
    expect(onlyEnabled.some((t) => t.toolKey === toolKeyB)).toBe(false);
    expect(onlyEnabled.some((t) => t.toolKey === toolKeyA)).toBe(true);
  });
});
