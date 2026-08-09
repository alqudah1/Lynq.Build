import "server-only";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { AuthzError } from "@/lib/authz/errors";
import { DomainRuleViolationError } from "@/lib/authz/errors";
import { InvitationError } from "@/lib/invitations/errors";

/**
 * The consistent JSON response envelope for every Step 4B route (Module 2
 * §14's already-approved API Contract Principles, now actually
 * implemented): `{ data: ... }` on success, `{ error: { code, message,
 * requestId } }` on failure — with no exceptions, so a client never has to
 * guess the shape of an error body.
 */
export function jsonSuccess<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status });
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

function errorResponse(status: number, code: string, message: string): Response {
  const requestId = randomUUID();
  const body: ErrorEnvelope = { error: { code, message, requestId } };
  return Response.json(body, { status, headers: { "X-Request-Id": requestId } });
}

/**
 * Translates a thrown error into the standard envelope, per Step 4B's
 * explicit requirements: never a stack trace, never a raw SQL/driver
 * message, never an internal identifier beyond what the resource's own API
 * shape already exposes. Domain/authz errors (Step 4A) map to their own
 * declared `httpStatus`; a Zod validation failure maps to 400 with
 * field-level detail; anything else is logged server-side only and
 * returned as a single, generic 500 — the same discipline Module 1's
 * health check already established for this codebase.
 */
export function handleRouteError(err: unknown): Response {
  if (err instanceof ZodError) {
    const fieldErrors = err.flatten().fieldErrors;
    return errorResponse(400, "invalid_request", `Request validation failed: ${JSON.stringify(fieldErrors)}`);
  }

  if (err instanceof AuthzError) {
    return errorResponse(err.httpStatus, err.code, err.message);
  }

  if (err instanceof DomainRuleViolationError) {
    return errorResponse(err.httpStatus, err.reason, err.message);
  }

  if (err instanceof InvitationError) {
    return errorResponse(err.httpStatus, err.code, err.message);
  }

  console.error("[http] unexpected error handling request:", err);
  return errorResponse(500, "internal_error", "An unexpected error occurred.");
}
