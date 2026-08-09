import { describe, it, expect } from "vitest";
import { classifyExecutionError } from "./worker";
import { NoAccessibleDomainsError } from "@/lib/agents/knowledge-analyst";
import { LivePermissionRevalidationFailedError, NotAssignedAgentError, InvalidExecutionTransitionError } from "@/lib/agent-runtime/errors";
import { ToolPermissionDeniedError, ToolDisabledError, ToolApprovalRequiredError } from "@/lib/tools/errors";

/**
 * Pure-function unit coverage for the worker's error-classification
 * policy — no DB, no shared global state, so no risk of racing any
 * other test file (unlike exercising this through a real disabled
 * `brain.search` tool, which would flip a row every other integration
 * test file also depends on staying enabled).
 */
describe("classifyExecutionError", () => {
  it("a retired/ineligible agent is classified permission_revoked, never retried", () => {
    expect(classifyExecutionError(new LivePermissionRevalidationFailedError("retired"))).toMatchObject({ failureClass: "permission_revoked", requiresHumanReview: false });
  });

  it("no accessible Brain domains is classified permission_revoked, never retried", () => {
    expect(classifyExecutionError(new NoAccessibleDomainsError())).toMatchObject({ failureClass: "permission_revoked", requiresHumanReview: false });
  });

  it("a live Brain permission denial mid-execution is classified permission_revoked, never retried", () => {
    expect(classifyExecutionError(new ToolPermissionDeniedError("grant revoked"))).toMatchObject({ failureClass: "permission_revoked", requiresHumanReview: false });
  });

  it("a disabled tool is classified permanent — stops the execution, never silently retried into the same disabled tool", () => {
    expect(classifyExecutionError(new ToolDisabledError("brain.search"))).toMatchObject({ failureClass: "permanent", requiresHumanReview: false });
  });

  it("an approval-required pause is classified unsafe_uncertain, never auto-retried around the gate", () => {
    expect(classifyExecutionError(new ToolApprovalRequiredError())).toMatchObject({ failureClass: "unsafe_uncertain" });
  });

  it("an unassigned-agent or invalid-transition inconsistency requires human review", () => {
    expect(classifyExecutionError(new NotAssignedAgentError())).toMatchObject({ requiresHumanReview: true });
    expect(classifyExecutionError(new InvalidExecutionTransitionError("executing", "planning"))).toMatchObject({ requiresHumanReview: true });
  });

  it("an unrecognized error defaults to transient — safe to retry a bounded number of times", () => {
    expect(classifyExecutionError(new Error("some transient network blip"))).toMatchObject({ failureClass: "transient", requiresHumanReview: false });
  });
});
