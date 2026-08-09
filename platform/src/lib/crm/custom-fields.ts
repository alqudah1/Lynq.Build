import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmCustomFieldDefinitions, crmCustomFieldValues } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveCrmAuthContext, requireCrmAdminAuthority, requireCrmManageAuthority, requireCrmViewAuthority, resolveCrmEntityWorkspaceId } from "./authz";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { DomainRuleViolationError } from "@/lib/authz/errors";
import { CustomFieldValidationError } from "./errors";
import type { CrmCustomFieldEntityType, CrmCustomFieldType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export class CustomFieldKeyAlreadyTakenError extends DomainRuleViolationError {
  readonly reason = "custom_field_key_taken";
  constructor(fieldKey: string) {
    super(`A custom field with key "${fieldKey}" already exists for this entity type`);
    this.name = "CustomFieldKeyAlreadyTakenError";
  }
}

export interface CrmCustomFieldValidationRules {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
}

export interface CrmCustomFieldDefinition {
  id: string;
  organizationId: string;
  entityType: CrmCustomFieldEntityType;
  fieldKey: string;
  label: string;
  fieldType: CrmCustomFieldType;
  isRequired: boolean;
  options: string[] | null;
  validationRules: CrmCustomFieldValidationRules | null;
  sequence: number;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCustomFieldDefinitionInput {
  organizationId: string;
  entityType: CrmCustomFieldEntityType;
  fieldKey: string;
  label: string;
  fieldType: CrmCustomFieldType;
  isRequired?: boolean;
  options?: string[];
  validationRules?: CrmCustomFieldValidationRules;
  actorUserId: string;
}

/**
 * A safe custom-field foundation — deliberately NOT a dynamic schema
 * engine. `fieldType` is a fixed, closed list; `validationRules` is
 * bounded metadata only (min/max/pattern/length), never code, SQL, or a
 * formula — enforced by `crmCustomFieldValidationRulesSchema`'s
 * `.strict()` zod shape at the route boundary before this function is
 * ever called.
 */
export async function createCustomFieldDefinition(db: Db, input: CreateCustomFieldDefinitionInput): Promise<CrmCustomFieldDefinition> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmAdminAuthority(db, ctx, "crm_custom_field_definition", "new");

  try {
    const [row] = await db
      .insert(crmCustomFieldDefinitions)
      .values({
        organizationId: input.organizationId,
        entityType: input.entityType,
        fieldKey: input.fieldKey,
        label: input.label,
        fieldType: input.fieldType,
        isRequired: input.isRequired ?? false,
        options: input.options ?? null,
        validationRules: input.validationRules ?? null,
      })
      .returning();

    await recordAuditEvent(db, { eventType: "crm_custom_field_defined", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_custom_field_definition", targetId: row.id, metadata: { entityType: input.entityType, fieldKey: input.fieldKey, fieldType: input.fieldType } });
    return row as CrmCustomFieldDefinition;
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new CustomFieldKeyAlreadyTakenError(input.fieldKey);
    throw err;
  }
}

export async function listCustomFieldDefinitions(db: Db, input: { organizationId: string; entityType: CrmCustomFieldEntityType; actorUserId: string }): Promise<CrmCustomFieldDefinition[]> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_custom_field_definition", "list");

  const rows = await db
    .select()
    .from(crmCustomFieldDefinitions)
    .where(and(eq(crmCustomFieldDefinitions.organizationId, input.organizationId), eq(crmCustomFieldDefinitions.entityType, input.entityType)));
  return (rows as CrmCustomFieldDefinition[]).filter((d) => !d.archivedAt);
}

/** Validates a raw value against its field definition's type + bounded rules — never against arbitrary code. Throws `CustomFieldValidationError` on any failure. */
export function validateCustomFieldValue(definition: CrmCustomFieldDefinition, value: unknown): void {
  if (value === null || value === undefined) {
    if (definition.isRequired) throw new CustomFieldValidationError(definition.fieldKey, "this field is required");
    return;
  }

  const rules = definition.validationRules;
  switch (definition.fieldType) {
    case "short_text":
    case "long_text": {
      if (typeof value !== "string") throw new CustomFieldValidationError(definition.fieldKey, "expected a string");
      if (rules?.minLength !== undefined && value.length < rules.minLength) throw new CustomFieldValidationError(definition.fieldKey, `must be at least ${rules.minLength} characters`);
      if (rules?.maxLength !== undefined && value.length > rules.maxLength) throw new CustomFieldValidationError(definition.fieldKey, `must be at most ${rules.maxLength} characters`);
      if (rules?.pattern && !new RegExp(rules.pattern).test(value)) throw new CustomFieldValidationError(definition.fieldKey, "does not match the required pattern");
      break;
    }
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) throw new CustomFieldValidationError(definition.fieldKey, "expected a number");
      if (rules?.min !== undefined && value < rules.min) throw new CustomFieldValidationError(definition.fieldKey, `must be at least ${rules.min}`);
      if (rules?.max !== undefined && value > rules.max) throw new CustomFieldValidationError(definition.fieldKey, `must be at most ${rules.max}`);
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") throw new CustomFieldValidationError(definition.fieldKey, "expected a boolean");
      break;
    }
    case "date":
    case "datetime": {
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new CustomFieldValidationError(definition.fieldKey, "expected a valid ISO date string");
      break;
    }
    case "single_select": {
      if (typeof value !== "string" || !(definition.options ?? []).includes(value)) throw new CustomFieldValidationError(definition.fieldKey, "not one of the allowed options");
      break;
    }
    case "multi_select": {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && (definition.options ?? []).includes(v))) throw new CustomFieldValidationError(definition.fieldKey, "not a subset of the allowed options");
      break;
    }
  }
}

export async function setCustomFieldValue(db: Db, input: { organizationId: string; fieldDefinitionId: string; entityType: CrmCustomFieldEntityType; entityId: string; value: unknown; actorUserId: string }): Promise<void> {
  const [definition] = await db
    .select()
    .from(crmCustomFieldDefinitions)
    .where(and(eq(crmCustomFieldDefinitions.id, input.fieldDefinitionId), eq(crmCustomFieldDefinitions.organizationId, input.organizationId)));
  if (!definition) throw new CustomFieldValidationError("unknown", "no such custom field definition in this organization");

  validateCustomFieldValue(definition as CrmCustomFieldDefinition, input.value);

  const workspaceId = input.entityType === "lead" ? null : await resolveCrmEntityWorkspaceId(db, input.organizationId, input.entityType, input.entityId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_custom_field_value", input.entityId);

  await db
    .insert(crmCustomFieldValues)
    .values({ organizationId: input.organizationId, fieldDefinitionId: input.fieldDefinitionId, entityType: input.entityType, entityId: input.entityId, value: input.value })
    .onConflictDoUpdate({
      target: [crmCustomFieldValues.fieldDefinitionId, crmCustomFieldValues.entityId],
      set: { value: input.value, updatedAt: new Date() },
    });

  await recordAuditEvent(db, { eventType: "crm_custom_field_value_set", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_custom_field_value", targetId: input.entityId, metadata: { fieldDefinitionId: input.fieldDefinitionId } });
}

export async function listCustomFieldValuesForEntity(db: Db, input: { organizationId: string; entityType: CrmCustomFieldEntityType; entityId: string; actorUserId: string }): Promise<Array<{ fieldDefinitionId: string; value: unknown }>> {
  const workspaceId = input.entityType === "lead" ? null : await resolveCrmEntityWorkspaceId(db, input.organizationId, input.entityType, input.entityId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_custom_field_value", input.entityId);

  const rows = await db
    .select({ fieldDefinitionId: crmCustomFieldValues.fieldDefinitionId, value: crmCustomFieldValues.value })
    .from(crmCustomFieldValues)
    .where(and(eq(crmCustomFieldValues.organizationId, input.organizationId), eq(crmCustomFieldValues.entityType, input.entityType), eq(crmCustomFieldValues.entityId, input.entityId)));
  return rows;
}
