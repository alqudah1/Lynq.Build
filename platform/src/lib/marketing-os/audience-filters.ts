import "server-only";
import { and, eq, ne, inArray, isNull, isNotNull, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { crmContacts, crmCompanies, crmLeads, crmOpportunities } from "@/db/schema";
import { InvalidAudienceFilterError } from "./errors";
import type { MarketingAudienceEntityType, MarketingAudienceFilterCondition } from "./validation";

/**
 * ============================================================================
 * Safe audience filter registry — Module 15
 * ============================================================================
 * The ONE place a CRM column may ever be referenced by an audience filter.
 * `compileAudienceFilter` only ever builds `and(eq(...), ne(...),
 * inArray(...), isNull(...), isNotNull(...))` against a column pulled from
 * this fixed map — never a raw SQL string, never a dynamically-constructed
 * column reference, never a client-supplied table/column name. A field not
 * in this registry is rejected with `InvalidAudienceFilterError` before any
 * query runs. Extending the registry is a reviewed code change, not a data
 * change — exactly the same discipline Module 14's agent task registry
 * uses for task types.
 */
type FieldValueType = "string" | "boolean";

interface FieldDescriptor {
  column: PgColumn;
  valueType: FieldValueType;
}

const CONTACT_FIELDS: Record<string, FieldDescriptor> = {
  lifecycleStage: { column: crmContacts.lifecycleStage, valueType: "string" },
  status: { column: crmContacts.status, valueType: "string" },
  sourceId: { column: crmContacts.sourceId, valueType: "string" },
  ownerUserId: { column: crmContacts.ownerUserId, valueType: "string" },
};

const COMPANY_FIELDS: Record<string, FieldDescriptor> = {
  lifecycleStage: { column: crmCompanies.lifecycleStage, valueType: "string" },
  status: { column: crmCompanies.status, valueType: "string" },
  sourceId: { column: crmCompanies.sourceId, valueType: "string" },
  ownerUserId: { column: crmCompanies.ownerUserId, valueType: "string" },
  industry: { column: crmCompanies.industry, valueType: "string" },
};

const LEAD_FIELDS: Record<string, FieldDescriptor> = {
  status: { column: crmLeads.status, valueType: "string" },
  sourceId: { column: crmLeads.sourceId, valueType: "string" },
  ownerUserId: { column: crmLeads.ownerUserId, valueType: "string" },
  companyId: { column: crmLeads.companyId, valueType: "string" },
  contactId: { column: crmLeads.contactId, valueType: "string" },
};

const OPPORTUNITY_FIELDS: Record<string, FieldDescriptor> = {
  status: { column: crmOpportunities.status, valueType: "string" },
  sourceId: { column: crmOpportunities.sourceId, valueType: "string" },
  ownerUserId: { column: crmOpportunities.ownerUserId, valueType: "string" },
  stageId: { column: crmOpportunities.stageId, valueType: "string" },
  pipelineId: { column: crmOpportunities.pipelineId, valueType: "string" },
};

const REGISTRY: Record<MarketingAudienceEntityType, Record<string, FieldDescriptor>> = {
  contact: CONTACT_FIELDS,
  company: COMPANY_FIELDS,
  lead: LEAD_FIELDS,
  opportunity: OPPORTUNITY_FIELDS,
};

export function listAudienceFields(entityType: MarketingAudienceEntityType): string[] {
  return Object.keys(REGISTRY[entityType]);
}

/** Compiles a bounded filter definition into a real drizzle `SQL` condition — `null` for an empty filter (no additional condition beyond tenant scope). Throws `InvalidAudienceFilterError` for any field/operator/value combination outside the registry. */
export function compileAudienceFilter(entityType: MarketingAudienceEntityType, conditions: MarketingAudienceFilterCondition[]): SQL | null {
  const fields = REGISTRY[entityType];
  const compiled: SQL[] = [];

  for (const condition of conditions) {
    const descriptor = fields[condition.field];
    if (!descriptor) throw new InvalidAudienceFilterError(`field "${condition.field}" is not a permitted filter field for entity type "${entityType}"`);

    switch (condition.operator) {
      case "equals":
        if (typeof condition.value !== "string" && typeof condition.value !== "boolean") throw new InvalidAudienceFilterError(`operator "equals" requires a string or boolean value for field "${condition.field}"`);
        compiled.push(eq(descriptor.column, condition.value));
        break;
      case "not_equals":
        if (typeof condition.value !== "string" && typeof condition.value !== "boolean") throw new InvalidAudienceFilterError(`operator "not_equals" requires a string or boolean value for field "${condition.field}"`);
        compiled.push(ne(descriptor.column, condition.value));
        break;
      case "in":
        if (!Array.isArray(condition.value) || condition.value.length === 0) throw new InvalidAudienceFilterError(`operator "in" requires a non-empty array value for field "${condition.field}"`);
        compiled.push(inArray(descriptor.column, condition.value));
        break;
      case "exists":
        compiled.push(isNotNull(descriptor.column));
        break;
      case "not_exists":
        compiled.push(isNull(descriptor.column));
        break;
      default: {
        const exhaustive: never = condition.operator;
        throw new InvalidAudienceFilterError(`unsupported operator "${exhaustive as string}"`);
      }
    }
  }

  if (compiled.length === 0) return null;
  return and(...compiled) ?? null;
}
