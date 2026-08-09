import "server-only";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingPlaybooks, marketingPlaybookVersions, marketingPlaybookSteps } from "@/db/schema";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveMarketingAuthContext, requireMarketingManagePlaybooksAuthority, requireMarketingViewAuthority } from "./authz";
import { MarketingKeyAlreadyTakenError, PlaybookVersionImmutableError, PlaybookNotPublishedError, StaleMarketingUpdateError } from "./errors";
import type { MarketingPlaybookType, MarketingPlaybookLifecycle, MarketingPlaybookVersionStatus, MarketingPlaybookStepType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface MarketingPlaybook {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  playbookKey: string;
  playbookType: MarketingPlaybookType;
  lifecycle: MarketingPlaybookLifecycle;
  currentPublishedVersionId: string | null;
  ownerUserId: string | null;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketingPlaybookVersion {
  id: string;
  organizationId: string;
  playbookId: string;
  versionNumber: number;
  status: MarketingPlaybookVersionStatus;
  changeReason: string | null;
  createdByUserId: string | null;
  publishedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketingPlaybookStep {
  id: string;
  organizationId: string;
  playbookVersionId: string;
  stepKey: string;
  stepType: MarketingPlaybookStepType;
  name: string;
  description: string | null;
  sequence: number;
  configuration: Record<string, unknown>;
  required: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePlaybookInput {
  organizationId: string;
  workspaceId?: string | null;
  name: string;
  playbookKey: string;
  playbookType: MarketingPlaybookType;
  ownerUserId?: string | null;
  actorUserId: string;
}

/** Creates the playbook shell plus an initial draft version (version 1) — a playbook is never usable until that draft is populated with steps and published. */
export async function createPlaybook(db: Db, input: CreatePlaybookInput): Promise<{ playbook: MarketingPlaybook; version: MarketingPlaybookVersion }> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManagePlaybooksAuthority(db, ctx, "marketing_playbook", "new");

  let playbook: MarketingPlaybook;
  try {
    [playbook] = await db
      .insert(marketingPlaybooks)
      .values({ organizationId: input.organizationId, workspaceId: input.workspaceId ?? null, name: input.name, playbookKey: input.playbookKey, playbookType: input.playbookType, ownerUserId: input.ownerUserId ?? input.actorUserId })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new MarketingKeyAlreadyTakenError("marketing playbook", input.playbookKey);
    throw err;
  }

  const [version] = await db.insert(marketingPlaybookVersions).values({ organizationId: input.organizationId, playbookId: playbook.id, versionNumber: 1, createdByUserId: input.actorUserId }).returning();

  await recordAuditEvent(db, { eventType: "marketing_playbook_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_playbook", targetId: playbook.id, metadata: { playbookType: playbook.playbookType, playbookKey: playbook.playbookKey } });
  return { playbook, version };
}

export async function resolvePlaybookById(db: Db, organizationId: string, playbookId: string): Promise<MarketingPlaybook> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(marketingPlaybooks).where(and(eq(marketingPlaybooks.id, playbookId), eq(marketingPlaybooks.organizationId, organizationId)));
    return row;
  });
}

export async function getPlaybookForUser(db: Db, input: { organizationId: string; playbookId: string; actorUserId: string }): Promise<MarketingPlaybook> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_playbook", input.playbookId);
  return resolvePlaybookById(db, input.organizationId, input.playbookId);
}

export async function listPlaybooksForUser(db: Db, input: { organizationId: string; playbookType?: MarketingPlaybookType; actorUserId: string }): Promise<MarketingPlaybook[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_playbook", "list");
  const conditions = [eq(marketingPlaybooks.organizationId, input.organizationId)];
  if (input.playbookType) conditions.push(eq(marketingPlaybooks.playbookType, input.playbookType));
  return db.select().from(marketingPlaybooks).where(and(...conditions)).orderBy(marketingPlaybooks.name);
}

export async function listPlaybookVersions(db: Db, input: { organizationId: string; playbookId: string; actorUserId: string }): Promise<MarketingPlaybookVersion[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_playbook", input.playbookId);
  return db.select().from(marketingPlaybookVersions).where(and(eq(marketingPlaybookVersions.organizationId, input.organizationId), eq(marketingPlaybookVersions.playbookId, input.playbookId))).orderBy(desc(marketingPlaybookVersions.versionNumber));
}

export async function resolvePlaybookVersionById(db: Db, organizationId: string, versionId: string): Promise<MarketingPlaybookVersion> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(marketingPlaybookVersions).where(and(eq(marketingPlaybookVersions.id, versionId), eq(marketingPlaybookVersions.organizationId, organizationId)));
    return row;
  });
}

/** The playbook's current published version — the only version a campaign run may execute against. */
export async function resolvePublishedPlaybookVersion(db: Db, organizationId: string, playbookId: string): Promise<MarketingPlaybookVersion> {
  const playbook = await resolvePlaybookById(db, organizationId, playbookId);
  if (!playbook.currentPublishedVersionId) throw new PlaybookNotPublishedError();
  return resolvePlaybookVersionById(db, organizationId, playbook.currentPublishedVersionId);
}

export interface AddPlaybookStepInput {
  organizationId: string;
  playbookVersionId: string;
  stepKey: string;
  stepType: MarketingPlaybookStepType;
  name: string;
  description?: string;
  sequence: number;
  configuration?: Record<string, unknown>;
  required?: boolean;
  actorUserId: string;
}

export async function addPlaybookStep(db: Db, input: AddPlaybookStepInput): Promise<MarketingPlaybookStep> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManagePlaybooksAuthority(db, ctx, "marketing_playbook_version", input.playbookVersionId);

  const version = await resolvePlaybookVersionById(db, input.organizationId, input.playbookVersionId);
  if (version.status !== "draft") throw new PlaybookVersionImmutableError();

  let step: typeof marketingPlaybookSteps.$inferSelect;
  try {
    [step] = await db
      .insert(marketingPlaybookSteps)
      .values({
        organizationId: input.organizationId,
        playbookVersionId: version.id,
        stepKey: input.stepKey,
        stepType: input.stepType,
        name: input.name,
        description: input.description ?? null,
        sequence: input.sequence,
        configuration: input.configuration ?? {},
        required: input.required ?? true,
      })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new MarketingKeyAlreadyTakenError("playbook step", input.stepKey);
    throw err;
  }
  return step as MarketingPlaybookStep;
}

export async function listPlaybookSteps(db: Db, input: { organizationId: string; playbookVersionId: string; actorUserId: string }): Promise<MarketingPlaybookStep[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_playbook_version", input.playbookVersionId);
  const rows = await db.select().from(marketingPlaybookSteps).where(and(eq(marketingPlaybookSteps.organizationId, input.organizationId), eq(marketingPlaybookSteps.playbookVersionId, input.playbookVersionId))).orderBy(marketingPlaybookSteps.sequence);
  return rows as MarketingPlaybookStep[];
}

/** Publishing is a one-way door: at least one step is required, the previous published version (if any) becomes `superseded`, and this version becomes immutable. */
export async function publishPlaybookVersion(db: Db, input: { organizationId: string; playbookId: string; versionId: string; expectedRevision: number; actorUserId: string }): Promise<MarketingPlaybookVersion> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManagePlaybooksAuthority(db, ctx, "marketing_playbook", input.playbookId);

  const steps = await db.select({ id: marketingPlaybookSteps.id }).from(marketingPlaybookSteps).where(and(eq(marketingPlaybookSteps.organizationId, input.organizationId), eq(marketingPlaybookSteps.playbookVersionId, input.versionId)));
  if (steps.length === 0) throw new PlaybookVersionImmutableError();

  const playbook = await resolvePlaybookById(db, input.organizationId, input.playbookId);
  if (playbook.currentPublishedVersionId) {
    await db.update(marketingPlaybookVersions).set({ status: "superseded", updatedAt: new Date() }).where(and(eq(marketingPlaybookVersions.id, playbook.currentPublishedVersionId), eq(marketingPlaybookVersions.status, "published")));
  }

  const [version] = await db
    .update(marketingPlaybookVersions)
    .set({ status: "published", publishedAt: new Date(), revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(marketingPlaybookVersions.id, input.versionId), eq(marketingPlaybookVersions.organizationId, input.organizationId), eq(marketingPlaybookVersions.revision, input.expectedRevision)))
    .returning();
  if (!version) throw new StaleMarketingUpdateError("playbook version");

  await db.update(marketingPlaybooks).set({ currentPublishedVersionId: version.id, lifecycle: "published", revision: playbook.revision + 1, updatedAt: new Date() }).where(eq(marketingPlaybooks.id, playbook.id));

  await recordAuditEvent(db, { eventType: "marketing_playbook_version_published", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_playbook_version", targetId: version.id, metadata: { playbookId: playbook.id, versionNumber: version.versionNumber } });
  return version;
}
