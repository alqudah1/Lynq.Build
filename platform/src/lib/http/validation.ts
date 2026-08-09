import "server-only";
import { z, type ZodType } from "zod";

/** Every path parameter that names a resource is a UUID — validated before it ever reaches a domain service or query. */
export const uuidParam = z.string().uuid();

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const nameSchema = z.string().trim().min(1).max(200);
export const slugSchema = z.string().trim().min(1).max(100).regex(slugPattern, "must be lowercase alphanumeric with single hyphens");
export const emailSchema = z.string().trim().min(3).max(320).regex(emailPattern, "must be a valid email address");

export const organizationRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);
export const workspaceRoleSchema = z.enum(["manager", "member", "viewer"]);

/** Parses and validates a request's JSON body against `schema` — a ZodError from here is caught by `handleRouteError` and returned as 400 with field detail. Malformed (non-JSON) bodies are also normalized into a ZodError-shaped 400, never a raw parse-error message. */
export async function parseJsonBody<T extends ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    json = undefined;
  }
  return schema.parseAsync(json);
}

/** Validates a single path parameter (already a string, from Next.js's dynamic route params) as a UUID. */
export function parseUuidParam(value: string): string {
  return uuidParam.parse(value);
}
