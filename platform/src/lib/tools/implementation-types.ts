import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { ZodType } from "zod";
import type { KnowledgeDomain } from "@/lib/brain/knowledge-items";
import type { AgentPrincipal } from "@/lib/agents/authentication";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

/**
 * What a tool implementation's `execute` function is given — deliberately
 * closed: no raw credentials, no session data, nothing beyond what a tool
 * genuinely needs to do its bounded job. `principal` carries the agent's
 * live-resolved identity (id, org, CURRENT permission level, department) —
 * never a cached/stale copy.
 */
export interface ToolExecutionContext {
  db: Db;
  rawSql: RawSql;
  organizationId: string;
  workspaceId: string | null;
  executionId: string;
  planStepId: string | null;
  principal: AgentPrincipal;
  idempotencyKey: string;
}

/**
 * A registered, typed, permission-aware operation (never an arbitrary
 * prompt) — the CODE half of the Tool Model. `tool_definitions` (the
 * database half) is the authority on POLICY (risk, approval, permission
 * floor, enabled state); this is the authority on BEHAVIOR. Both are
 * always addressed together by `(toolKey, version)`.
 */
export interface ToolImplementation<TInput = unknown, TOutput = unknown> {
  toolKey: string;
  version: number;
  inputSchema: ZodType<TInput>;
  /** Which Brain domains this specific call touches, if any — `invokeTool`'s generic engine checks the tool definition's own `requiredCapabilities` against every domain this returns, before `execute` ever runs. Omit for tools with no Brain interaction at all (`requiredCapabilities: []`). */
  resolveRequiredDomains?: (input: TInput) => KnowledgeDomain[];
  execute: (ctx: ToolExecutionContext, input: TInput) => Promise<TOutput>;
}
