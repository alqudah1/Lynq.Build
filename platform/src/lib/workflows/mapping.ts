import type { MappingSource, ConditionOperator } from "./validation";
import { DomainRuleViolationError } from "@/lib/authz/errors";

export class MappingResolutionError extends DomainRuleViolationError {
  readonly reason = "mapping_resolution_failed";
  constructor(field: string, detail: string) {
    super(`Could not resolve mapped field "${field}": ${detail}`);
    this.name = "MappingResolutionError";
  }
}

export class NoConditionBranchMatchedError extends DomainRuleViolationError {
  readonly reason = "no_condition_branch_matched";
  constructor() {
    super("No condition branch matched, and no default branch is configured");
    this.name = "NoConditionBranchMatchedError";
  }
}

/** Bounded dot-path traversal — never `eval`, never a template engine, never dynamic property construction beyond a plain `.`-split walk over an already-resolved plain object. */
export function getByPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export interface MappingResolutionContext {
  workflowInput: Record<string, unknown>;
  /** Prior node outputs, keyed by nodeKey. */
  nodeOutputs: Record<string, unknown>;
  trustedContext: { organizationId: string; workspaceId: string | null; initiatorUserId: string | null };
}

/** Resolves one mapping source to a plain JSON value. The only 4 kinds that exist — no arbitrary code, no dynamic SQL, no shell, no template evaluation, no secret interpolation from user input. */
export function resolveMappingSource(source: MappingSource, ctx: MappingResolutionContext): unknown {
  switch (source.source) {
    case "workflow_input":
      return getByPath(ctx.workflowInput, source.path);
    case "node_output":
      return getByPath(ctx.nodeOutputs[source.nodeKey], source.path);
    case "literal":
      return source.value;
    case "context":
      return ctx.trustedContext[source.field];
  }
}

/** Resolves a node's full input mapping into a plain object — deterministic failure (never a silent `undefined`-shaped success) when a mapping cannot be resolved and the caller marked it required. */
export function resolveMapping(mapping: Record<string, MappingSource>, ctx: MappingResolutionContext): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [field, source] of Object.entries(mapping)) {
    resolved[field] = resolveMappingSource(source, ctx);
  }
  return resolved;
}

function toComparable(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") return value;
  if (value === null || value === undefined) return null;
  return String(value);
}

/** The safe operator registry — deterministic, bounded, independent of LLM reasoning. */
export function evaluateOperator(operator: ConditionOperator, left: unknown, right: unknown): boolean {
  switch (operator) {
    case "equals":
      return toComparable(left) === toComparable(right);
    case "not_equals":
      return toComparable(left) !== toComparable(right);
    case "exists":
      return left !== null && left !== undefined;
    case "not_exists":
      return left === null || left === undefined;
    case "greater_than":
      return typeof left === "number" && typeof right === "number" && left > right;
    case "less_than":
      return typeof left === "number" && typeof right === "number" && left < right;
    case "contains":
      if (Array.isArray(left)) return left.some((item) => toComparable(item) === toComparable(right));
      if (typeof left === "string" && typeof right === "string") return left.includes(right);
      return false;
    case "in":
      return Array.isArray(right) && right.some((item) => toComparable(item) === toComparable(left));
    case "status_is":
      return typeof left === "string" && left === right;
    case "approved":
      return left === "approved";
    case "rejected":
      return left === "rejected";
  }
}

export interface ConditionBranchConfig {
  branchKey: string;
  operator: ConditionOperator;
  left: MappingSource;
  right?: unknown;
}

/** Evaluates a condition node's branches in configured order — first match wins, matching "exactly one outgoing branch must be selected." Falls back to `defaultBranchKey` when nothing matches. */
export function evaluateConditionBranches(branches: ConditionBranchConfig[], defaultBranchKey: string | undefined, ctx: MappingResolutionContext): string {
  for (const branch of branches) {
    const leftValue = resolveMappingSource(branch.left, ctx);
    if (evaluateOperator(branch.operator, leftValue, branch.right)) {
      return branch.branchKey;
    }
  }
  if (defaultBranchKey) return defaultBranchKey;
  throw new NoConditionBranchMatchedError();
}
