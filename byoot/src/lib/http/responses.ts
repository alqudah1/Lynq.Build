import "server-only";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { AuthzError } from "@/lib/authz/errors";

/**
 * Copied from platform/src/lib/http/responses.ts. Adapted: platform/'s
 * version also maps DomainRuleViolationError and InvitationError — neither
 * exists in this scaffold (no org/workspace rules, no invitations), so
 * those branches are omitted rather than left dangling on imports that
 * don't resolve. Add them back if/when those concepts are ever built here.
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
 * Translates a thrown error into the standard envelope: never a stack
 * trace, never a raw SQL/driver message. Anything unclassified is logged
 * server-side only and returned as a generic 500.
 */
export function handleRouteError(err: unknown): Response {
  if (err instanceof ZodError) {
    const fieldErrors = err.flatten().fieldErrors;
    return errorResponse(400, "invalid_request", `Request validation failed: ${JSON.stringify(fieldErrors)}`);
  }

  if (err instanceof AuthzError) {
    return errorResponse(err.httpStatus, err.code, err.message);
  }

  console.error("[http] unexpected error handling request:", err);
  return errorResponse(500, "internal_error", "An unexpected error occurred.");
}
