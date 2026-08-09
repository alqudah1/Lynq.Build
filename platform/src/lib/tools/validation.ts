import { z } from "zod";

export const TOOL_CATEGORIES = ["brain", "runtime", "artifact", "internal_api", "external_api", "communication", "data", "file", "administrative"] as const;
export const toolCategorySchema = z.enum(TOOL_CATEGORIES);

export const TOOL_SIDE_EFFECT_CLASSES = ["read_only", "internal_write", "external_write", "destructive", "financial", "permission_changing"] as const;
export const toolSideEffectClassSchema = z.enum(TOOL_SIDE_EFFECT_CLASSES);

export const TOOL_INVOCATION_STATUSES = ["requested", "validating", "waiting_for_approval", "ready", "running", "succeeded", "failed", "cancelled", "timed_out"] as const;
export const toolInvocationStatusSchema = z.enum(TOOL_INVOCATION_STATUSES);

export const toolKeySchema = z.string().trim().min(1).max(100);
export const idempotencyKeySchema = z.string().trim().min(1).max(200);
