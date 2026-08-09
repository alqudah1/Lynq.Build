import "server-only";
import { asc, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { knowledgeDomainMetadata } from "@/db/schema";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import type { KnowledgeDomain } from "./knowledge-items";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface DomainDefinition {
  domain: KnowledgeDomain;
  description: string;
  sortOrder: number;
  ownerDepartment: string | null;
  isRetired: boolean;
  retiredAt: Date | null;
}

/**
 * Lists all eight fixed Brain domains' management metadata, in display
 * order. Global, read-only reference data — not organization-scoped (see
 * `knowledgeDomainMetadata`'s own schema comment for why), so this reuses
 * no tenant-scoping helper at all; any authenticated user may call it.
 */
export async function listDomains(db: Db): Promise<DomainDefinition[]> {
  const rows = await db.select().from(knowledgeDomainMetadata).orderBy(asc(knowledgeDomainMetadata.sortOrder));
  return rows;
}

/**
 * Retrieves one domain's management metadata. `TenantResourceNotFoundError`
 * (404) here does not mean "cross-tenant" (this data has no tenant
 * dimension) — it is reused purely because `domain` is already validated
 * against the fixed `KnowledgeDomain` union before this function is ever
 * called (the route layer's Zod schema rejects anything else with 400), so
 * a missing row here can only mean the one-time seed migration was never
 * run, an operational/deployment concern, not a request-shape one — the
 * existing "resource not found" error is the correct, already-established
 * shape for that, rather than inventing a new one for a case this codebase
 * treats identically everywhere else.
 */
export async function getDomain(db: Db, domain: KnowledgeDomain): Promise<DomainDefinition> {
  const [row] = await db.select().from(knowledgeDomainMetadata).where(eq(knowledgeDomainMetadata.domain, domain));
  if (!row) {
    throw new TenantResourceNotFoundError();
  }
  return row;
}
