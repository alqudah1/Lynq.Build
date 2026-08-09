import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmSources } from "@/db/schema";
import { resolveCrmAuthContext, requireCrmAdminAuthority, requireCrmViewAuthority } from "./authz";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { DomainRuleViolationError } from "@/lib/authz/errors";
import type { CrmSourceType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export class SourceKeyAlreadyTakenError extends DomainRuleViolationError {
  readonly reason = "source_key_taken";
  constructor(sourceKey: string) {
    super(`A source with key "${sourceKey}" already exists in this organization`);
    this.name = "SourceKeyAlreadyTakenError";
  }
}

export interface CrmSource {
  id: string;
  organizationId: string;
  sourceKey: string;
  name: string;
  sourceType: CrmSourceType;
  description: string | null;
  isActive: boolean;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const BUILT_IN_SOURCES: Array<{ sourceKey: string; name: string; sourceType: CrmSourceType }> = [
  { sourceKey: "MANUAL", name: "Manual entry", sourceType: "manual" },
  { sourceKey: "WEBSITE", name: "Website", sourceType: "website" },
  { sourceKey: "REFERRAL", name: "Referral", sourceType: "referral" },
  { sourceKey: "EVENT", name: "Event", sourceType: "event" },
  { sourceKey: "PAID_SEARCH", name: "Paid search", sourceType: "paid_search" },
  { sourceKey: "ORGANIC_SEARCH", name: "Organic search", sourceType: "organic_search" },
  { sourceKey: "SOCIAL", name: "Social", sourceType: "social" },
  { sourceKey: "PARTNER", name: "Partner", sourceType: "partner" },
  { sourceKey: "IMPORT", name: "Import", sourceType: "import" },
  { sourceKey: "API", name: "API", sourceType: "api" },
];

/** Seeds the fixed built-in source list for an organization — idempotent by `sourceKey`, safe to call repeatedly (e.g. on org creation). */
export async function seedBuiltInSources(db: Db, input: { organizationId: string }): Promise<void> {
  for (const source of BUILT_IN_SOURCES) {
    await db.insert(crmSources).values({ organizationId: input.organizationId, sourceKey: source.sourceKey, name: source.name, sourceType: source.sourceType }).onConflictDoNothing();
  }
}

export interface CreateSourceInput {
  organizationId: string;
  sourceKey: string;
  name: string;
  sourceType: CrmSourceType;
  description?: string;
  actorUserId: string;
}

export async function createSource(db: Db, input: CreateSourceInput): Promise<CrmSource> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmAdminAuthority(db, ctx, "crm_source", "new");

  try {
    const [row] = await db
      .insert(crmSources)
      .values({ organizationId: input.organizationId, sourceKey: input.sourceKey, name: input.name, sourceType: input.sourceType, description: input.description ?? null })
      .returning();
    return row as CrmSource;
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new SourceKeyAlreadyTakenError(input.sourceKey);
    throw err;
  }
}

export async function listSourcesForUser(db: Db, input: { organizationId: string; actorUserId: string; activeOnly?: boolean }): Promise<CrmSource[]> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_source", "list");

  const conditions = [eq(crmSources.organizationId, input.organizationId)];
  if (input.activeOnly) conditions.push(eq(crmSources.isActive, true));
  const rows = await db.select().from(crmSources).where(and(...conditions));
  return rows as CrmSource[];
}
