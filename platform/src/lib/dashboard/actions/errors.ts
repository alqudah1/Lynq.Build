import "server-only";
import { ZodError } from "zod";
import { AuthzError, DomainRuleViolationError } from "@/lib/authz/errors";
import { InvitationError } from "@/lib/invitations/errors";
import type { ActionResult } from "./types";

/**
 * Translates a thrown error into the same `{code, message}` shape the HTTP
 * layer's `handleRouteError` already produces (Step 4B) — a server action
 * can't return an HTTP `Response`, so this is the equivalent transport-
 * layer boundary for the dashboard's own mutations. Never a stack trace,
 * never a raw SQL/driver message: anything not already a known domain/
 * validation error is logged server-side only and returned as a single
 * generic message, exactly matching the HTTP route convention.
 */
export function toActionResult(err: unknown): ActionResult {
  if (err instanceof ZodError) {
    return {
      ok: false,
      code: "invalid_request",
      message: "Please fix the errors below.",
      fieldErrors: err.flatten().fieldErrors,
    };
  }

  if (err instanceof AuthzError) {
    return { ok: false, code: err.code, message: err.message };
  }

  if (err instanceof DomainRuleViolationError) {
    return { ok: false, code: err.reason, message: err.message };
  }

  if (err instanceof InvitationError) {
    return { ok: false, code: err.code, message: err.message };
  }

  console.error("[dashboard-action] unexpected error:", err);
  return { ok: false, code: "internal_error", message: "Something went wrong. Please try again." };
}
