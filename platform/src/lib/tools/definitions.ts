import "server-only";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { toolDefinitions } from "@/db/schema";
import type { BrainCapability } from "@/lib/brain/authz";
import type { AgentPermissionLevel } from "@/lib/agents/types";
import { recordAuditEvent } from "@/lib/audit";
import { ToolNotFoundError, ToolDisabledError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export type ToolCategory = "brain" | "runtime" | "artifact" | "internal_api" | "external_api" | "communication" | "data" | "file" | "administrative";
export type ToolSideEffectClass = "read_only" | "internal_write" | "external_write" | "destructive" | "financial" | "permission_changing";
export type ToolRiskLevel = "low" | "medium" | "high" | "critical";

export interface ToolDefinition {
  id: string;
  toolKey: string;
  version: number;
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: unknown;
  outputSchema: unknown;
  riskLevel: ToolRiskLevel;
  sideEffectClass: ToolSideEffectClass;
  requiredCapabilities: BrainCapability[];
  minimumPermissionLevel: AgentPermissionLevel | null;
  approvalRequired: boolean;
  timeoutSeconds: number;
  maxRetryAttempts: number;
  retryBackoffSeconds: number;
  idempotencyRequired: boolean;
  enabled: boolean;
  changeReason: string | null;
  ownerUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toToolDefinition(row: typeof toolDefinitions.$inferSelect): ToolDefinition {
  return {
    id: row.id,
    toolKey: row.toolKey,
    version: row.version,
    name: row.name,
    description: row.description,
    category: row.category,
    inputSchema: row.inputSchema,
    outputSchema: row.outputSchema,
    riskLevel: row.riskLevel,
    sideEffectClass: row.sideEffectClass,
    requiredCapabilities: (row.requiredCapabilities ?? []) as BrainCapability[],
    minimumPermissionLevel: row.minimumPermissionLevel,
    approvalRequired: row.approvalRequired,
    timeoutSeconds: row.timeoutSeconds,
    maxRetryAttempts: row.maxRetryAttempts,
    retryBackoffSeconds: row.retryBackoffSeconds,
    idempotencyRequired: row.idempotencyRequired,
    enabled: row.enabled,
    changeReason: row.changeReason,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface RegisterToolInput {
  toolKey: string;
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: unknown;
  outputSchema: unknown;
  riskLevel: ToolRiskLevel;
  sideEffectClass: ToolSideEffectClass;
  requiredCapabilities?: BrainCapability[];
  minimumPermissionLevel?: AgentPermissionLevel | null;
  approvalRequired?: boolean;
  timeoutSeconds?: number;
  maxRetryAttempts?: number;
  retryBackoffSeconds?: number;
  idempotencyRequired?: boolean;
  ownerUserId?: string | null;
}

/** §5: "an unregistered tool is not callable by any agent, ever." Always creates version 1 — a second call with the same `toolKey` is a re-version (`updateToolConfiguration`), never silently overwritten. High-risk side-effect classes are structurally forced to `approvalRequired: true` regardless of what the caller passed (matching the database's own CHECK constraint — this is a second, earlier layer of the same guarantee, not a redundant one: it produces a clear application error instead of a raw constraint-violation). */
export async function registerTool(db: Db, input: RegisterToolInput): Promise<ToolDefinition> {
  const highRisk = input.sideEffectClass === "destructive" || input.sideEffectClass === "financial" || input.sideEffectClass === "permission_changing";
  const approvalRequired = highRisk ? true : (input.approvalRequired ?? false);

  const [row] = await db
    .insert(toolDefinitions)
    .values({
      toolKey: input.toolKey,
      version: 1,
      name: input.name,
      description: input.description,
      category: input.category,
      inputSchema: input.inputSchema,
      outputSchema: input.outputSchema,
      riskLevel: input.riskLevel,
      sideEffectClass: input.sideEffectClass,
      requiredCapabilities: input.requiredCapabilities ?? [],
      minimumPermissionLevel: input.minimumPermissionLevel ?? null,
      approvalRequired,
      timeoutSeconds: input.timeoutSeconds ?? 30,
      maxRetryAttempts: input.maxRetryAttempts ?? 0,
      retryBackoffSeconds: input.retryBackoffSeconds ?? 0,
      idempotencyRequired: input.idempotencyRequired ?? true,
      ownerUserId: input.ownerUserId ?? null,
    })
    .returning();

  await recordAuditEvent(db, { eventType: "tool_registered", actorUserId: input.ownerUserId ?? null, targetType: "tool_definition", targetId: row.id, metadata: { toolKey: input.toolKey, version: 1, category: input.category, sideEffectClass: input.sideEffectClass } });

  return toToolDefinition(row);
}

/** The current (highest-version) definition for a key, or `null` if never registered. Never throws — callers decide what "not found" means. */
export async function getCurrentToolVersion(db: Db, toolKey: string): Promise<ToolDefinition | null> {
  const [row] = await db.select().from(toolDefinitions).where(eq(toolDefinitions.toolKey, toolKey)).orderBy(desc(toolDefinitions.version)).limit(1);
  return row ? toToolDefinition(row) : null;
}

export async function getToolVersion(db: Db, toolKey: string, version: number): Promise<ToolDefinition | null> {
  const [row] = await db.select().from(toolDefinitions).where(and(eq(toolDefinitions.toolKey, toolKey), eq(toolDefinitions.version, version)));
  return row ? toToolDefinition(row) : null;
}

export async function listTools(db: Db, input: { onlyEnabled?: boolean } = {}): Promise<ToolDefinition[]> {
  const allVersions = await db.select().from(toolDefinitions).orderBy(toolDefinitions.toolKey, desc(toolDefinitions.version));
  const currentByKey = new Map<string, typeof toolDefinitions.$inferSelect>();
  for (const row of allVersions) {
    if (!currentByKey.has(row.toolKey)) currentByKey.set(row.toolKey, row);
  }
  const current = [...currentByKey.values()];
  return (input.onlyEnabled ? current.filter((r) => r.enabled) : current).map(toToolDefinition);
}

export interface UpdateToolConfigurationInput {
  toolKey: string;
  changeReason: string;
  name?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  riskLevel?: ToolRiskLevel;
  sideEffectClass?: ToolSideEffectClass;
  requiredCapabilities?: BrainCapability[];
  minimumPermissionLevel?: AgentPermissionLevel | null;
  approvalRequired?: boolean;
  timeoutSeconds?: number;
  maxRetryAttempts?: number;
  retryBackoffSeconds?: number;
  idempotencyRequired?: boolean;
  ownerUserId?: string | null;
}

/** Always inserts version N+1 — never edits an already-referenced version in place. An execution that already captured `toolVersion` keeps resolving to the exact row it used, forever. */
export async function updateToolConfiguration(db: Db, input: UpdateToolConfigurationInput): Promise<ToolDefinition> {
  const current = await getCurrentToolVersion(db, input.toolKey);
  if (!current) throw new ToolNotFoundError(input.toolKey);

  const sideEffectClass = input.sideEffectClass ?? current.sideEffectClass;
  const highRisk = sideEffectClass === "destructive" || sideEffectClass === "financial" || sideEffectClass === "permission_changing";
  const approvalRequired = highRisk ? true : (input.approvalRequired ?? current.approvalRequired);

  const [row] = await db
    .insert(toolDefinitions)
    .values({
      toolKey: input.toolKey,
      version: current.version + 1,
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      category: current.category,
      inputSchema: input.inputSchema ?? current.inputSchema,
      outputSchema: input.outputSchema ?? current.outputSchema,
      riskLevel: input.riskLevel ?? current.riskLevel,
      sideEffectClass,
      requiredCapabilities: input.requiredCapabilities ?? current.requiredCapabilities,
      minimumPermissionLevel: input.minimumPermissionLevel !== undefined ? input.minimumPermissionLevel : current.minimumPermissionLevel,
      approvalRequired,
      timeoutSeconds: input.timeoutSeconds ?? current.timeoutSeconds,
      maxRetryAttempts: input.maxRetryAttempts ?? current.maxRetryAttempts,
      retryBackoffSeconds: input.retryBackoffSeconds ?? current.retryBackoffSeconds,
      idempotencyRequired: input.idempotencyRequired ?? current.idempotencyRequired,
      enabled: current.enabled,
      changeReason: input.changeReason,
      ownerUserId: input.ownerUserId ?? current.ownerUserId,
    })
    .returning();

  return toToolDefinition(row);
}

async function setEnabled(db: Db, toolKey: string, enabled: boolean, actorUserId: string | null): Promise<ToolDefinition> {
  const current = await getCurrentToolVersion(db, toolKey);
  if (!current) throw new ToolNotFoundError(toolKey);

  const [row] = await db
    .update(toolDefinitions)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(toolDefinitions.toolKey, toolKey), eq(toolDefinitions.version, current.version)))
    .returning();

  await recordAuditEvent(db, { eventType: enabled ? "tool_enabled" : "tool_disabled", actorUserId, targetType: "tool_definition", targetId: row.id, metadata: { toolKey, version: current.version } });

  return toToolDefinition(row);
}

export async function enableTool(db: Db, toolKey: string, actorUserId: string): Promise<ToolDefinition> {
  return setEnabled(db, toolKey, true, actorUserId);
}

export async function disableTool(db: Db, toolKey: string, actorUserId: string): Promise<ToolDefinition> {
  return setEnabled(db, toolKey, false, actorUserId);
}

/** The one gate every tool call passes through before anything else: does this tool exist, and is it enabled. Always resolves the CURRENT version — a specific historical version is only ever addressed by an already-existing `tool_invocations` row, never a fresh call. */
export async function resolveToolForExecution(db: Db, toolKey: string): Promise<ToolDefinition> {
  const current = await getCurrentToolVersion(db, toolKey);
  if (!current) throw new ToolNotFoundError(toolKey);
  if (!current.enabled) throw new ToolDisabledError(toolKey);
  return current;
}
