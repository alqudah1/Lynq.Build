import "server-only";
import { z, type ZodType } from "zod";

/**
 * Copied from platform/src/lib/http/validation.ts. Adapted: dropped
 * organizationRoleSchema/workspaceRoleSchema (no equivalent concept here);
 * kept the generic, product-agnostic pieces unchanged.
 */

export const uuidParam = z.string().uuid();

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "must be a valid email address");

/** A ZodError from here is caught by handleRouteError and returned as 400 with field detail. */
export async function parseJsonBody<T extends ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    json = undefined;
  }
  return schema.parseAsync(json);
}

export function parseUuidParam(value: string): string {
  return uuidParam.parse(value);
}
