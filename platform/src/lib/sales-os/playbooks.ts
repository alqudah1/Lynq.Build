import "server-only";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { salesPlaybooks, salesPlaybookVersions, salesPlaybookSteps } from "@/db/schema";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveSalesAuthContext, requireSalesManagePlaybooksAuthority, requireSalesViewAuthority } from "./authz";
import { SalesKeyAlreadyTakenError, PlaybookVersionImmutableError, PlaybookNotPublishedError, StaleSalesUpdateError } from "./errors";
import type { SalesPlaybookType, SalesPlaybookLifecycle, SalesPlaybookVersionStatus, SalesPlaybookStepType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface SalesPlaybook {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  playbookKey: string;
  playbookType: SalesPlaybookType;
  lifecycle: SalesPlaybookLifecycle;
  currentPublishedVersionId: string | null;
  ownerUserId: string | null;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesPlaybookVersion {
  id: string;
  organizationId: string;
  playbookId: string;
  versionNumber: number;
  status: SalesPlaybookVersionStatus;
  changeReason: string | null;
  createdByUserId: string | null;
  publishedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesPlaybookStep {
  id: string;
  organizationId: string;
  playbookVersionId: string;
  stepKey: string;
  stepType: SalesPlaybookStepType;
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
  playbookType: SalesPlaybookType;
  ownerUserId?: string | null;
  actorUserId: string;
}

/** Creates the playbook shell plus an initial draft version (version 1) — a playbook is never usable until that draft is populated with steps and published. */
export async function createPlaybook(db: Db, input: CreatePlaybookInput): Promise<{ playbook: SalesPlaybook; version: SalesPlaybookVersion }> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesManagePlaybooksAuthority(db, ctx, "sales_playbook", "new");

  let playbook: SalesPlaybook;
  try {
    [playbook] = await db
      .insert(salesPlaybooks)
      .values({ organizationId: input.organizationId, workspaceId: input.workspaceId ?? null, name: input.name, playbookKey: input.playbookKey, playbookType: input.playbookType, ownerUserId: input.ownerUserId ?? input.actorUserId })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new SalesKeyAlreadyTakenError("sales playbook", input.playbookKey);
    throw err;
  }

  const [version] = await db.insert(salesPlaybookVersions).values({ organizationId: input.organizationId, playbookId: playbook.id, versionNumber: 1, createdByUserId: input.actorUserId }).returning();

  await recordAuditEvent(db, { eventType: "sales_playbook_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "sales_playbook", targetId: playbook.id, metadata: { playbookType: playbook.playbookType, playbookKey: playbook.playbookKey } });
  return { playbook, version };
}

export async function resolvePlaybookById(db: Db, organizationId: string, playbookId: string): Promise<SalesPlaybook> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(salesPlaybooks).where(and(eq(salesPlaybooks.id, playbookId), eq(salesPlaybooks.organizationId, organizationId)));
    return row;
  });
}

export async function getPlaybookForUser(db: Db, input: { organizationId: string; playbookId: string; actorUserId: string }): Promise<SalesPlaybook> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, "sales_playbook", input.playbookId);
  return resolvePlaybookById(db, input.organizationId, input.playbookId);
}

export async function listPlaybooksForUser(db: Db, input: { organizationId: string; playbookType?: SalesPlaybookType; actorUserId: string }): Promise<SalesPlaybook[]> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, "sales_playbook", "list");
  const conditions = [eq(salesPlaybooks.organizationId, input.organizationId)];
  if (input.playbookType) conditions.push(eq(salesPlaybooks.playbookType, input.playbookType));
  return db.select().from(salesPlaybooks).where(and(...conditions)).orderBy(salesPlaybooks.name);
}

export async function listPlaybookVersions(db: Db, input: { organizationId: string; playbookId: string; actorUserId: string }): Promise<SalesPlaybookVersion[]> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, "sales_playbook", input.playbookId);
  return db.select().from(salesPlaybookVersions).where(and(eq(salesPlaybookVersions.organizationId, input.organizationId), eq(salesPlaybookVersions.playbookId, input.playbookId))).orderBy(desc(salesPlaybookVersions.versionNumber));
}

export async function resolvePlaybookVersionById(db: Db, organizationId: string, versionId: string): Promise<SalesPlaybookVersion> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(salesPlaybookVersions).where(and(eq(salesPlaybookVersions.id, versionId), eq(salesPlaybookVersions.organizationId, organizationId)));
    return row;
  });
}

/** The playbook's current published version — the only version qualification/opportunity execution may run against. */
export async function resolvePublishedPlaybookVersion(db: Db, organizationId: string, playbookId: string): Promise<SalesPlaybookVersion> {
  const playbook = await resolvePlaybookById(db, organizationId, playbookId);
  if (!playbook.currentPublishedVersionId) throw new PlaybookNotPublishedError();
  return resolvePlaybookVersionById(db, organizationId, playbook.currentPublishedVersionId);
}

export interface CreatePlaybookVersionInput {
  organizationId: string;
  playbookId: string;
  changeReason?: string;
  cloneFromVersionId?: string;
  actorUserId: string;
}

/** A new draft version — never edits a published version in place. */
export async function createPlaybookVersion(db: Db, input: CreatePlaybookVersionInput): Promise<SalesPlaybookVersion> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesManagePlaybooksAuthority(db, ctx, "sales_playbook", input.playbookId);

  const playbook = await resolvePlaybookById(db, input.organizationId, input.playbookId);
  const existingVersions = await db.select({ versionNumber: salesPlaybookVersions.versionNumber }).from(salesPlaybookVersions).where(eq(salesPlaybookVersions.playbookId, playbook.id));
  const nextVersionNumber = Math.max(0, ...existingVersions.map((v) => v.versionNumber)) + 1;

  const [version] = await db.insert(salesPlaybookVersions).values({ organizationId: input.organizationId, playbookId: playbook.id, versionNumber: nextVersionNumber, changeReason: input.changeReason, createdByUserId: input.actorUserId }).returning();

  if (input.cloneFromVersionId) {
    const sourceSteps = await db.select().from(salesPlaybookSteps).where(and(eq(salesPlaybookSteps.organizationId, input.organizationId), eq(salesPlaybookSteps.playbookVersionId, input.cloneFromVersionId)));
    for (const step of sourceSteps) {
      await db.insert(salesPlaybookSteps).values({
        organizationId: input.organizationId,
        playbookVersionId: version.id,
        stepKey: step.stepKey,
        stepType: step.stepType,
        name: step.name,
        description: step.description,
        sequence: step.sequence,
        configuration: step.configuration,
        required: step.required,
      });
    }
  }

  return version;
}

export interface AddPlaybookStepInput {
  organizationId: string;
  playbookVersionId: string;
  stepKey: string;
  stepType: SalesPlaybookStepType;
  name: string;
  description?: string;
  sequence: number;
  configuration?: Record<string, unknown>;
  required?: boolean;
  actorUserId: string;
}

export async function addPlaybookStep(db: Db, input: AddPlaybookStepInput): Promise<SalesPlaybookStep> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesManagePlaybooksAuthority(db, ctx, "sales_playbook_version", input.playbookVersionId);

  const version = await resolvePlaybookVersionById(db, input.organizationId, input.playbookVersionId);
  if (version.status !== "draft") throw new PlaybookVersionImmutableError();

  let step: typeof salesPlaybookSteps.$inferSelect;
  try {
    [step] = await db
      .insert(salesPlaybookSteps)
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
    if (isPostgresUniqueViolation(err)) throw new SalesKeyAlreadyTakenError("playbook step", input.stepKey);
    throw err;
  }
  return step as SalesPlaybookStep;
}

export async function listPlaybookSteps(db: Db, input: { organizationId: string; playbookVersionId: string; actorUserId: string }): Promise<SalesPlaybookStep[]> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, "sales_playbook_version", input.playbookVersionId);
  const rows = await db.select().from(salesPlaybookSteps).where(and(eq(salesPlaybookSteps.organizationId, input.organizationId), eq(salesPlaybookSteps.playbookVersionId, input.playbookVersionId))).orderBy(salesPlaybookSteps.sequence);
  return rows as SalesPlaybookStep[];
}

/** Publishing is a one-way door: at least one step is required, the previous published version (if any) becomes `superseded`, and this version becomes immutable. */
export async function publishPlaybookVersion(db: Db, input: { organizationId: string; playbookId: string; versionId: string; expectedRevision: number; actorUserId: string }): Promise<SalesPlaybookVersion> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesManagePlaybooksAuthority(db, ctx, "sales_playbook", input.playbookId);

  const steps = await db.select({ id: salesPlaybookSteps.id }).from(salesPlaybookSteps).where(and(eq(salesPlaybookSteps.organizationId, input.organizationId), eq(salesPlaybookSteps.playbookVersionId, input.versionId)));
  if (steps.length === 0) throw new PlaybookVersionImmutableError();

  const playbook = await resolvePlaybookById(db, input.organizationId, input.playbookId);
  if (playbook.currentPublishedVersionId) {
    await db.update(salesPlaybookVersions).set({ status: "superseded", updatedAt: new Date() }).where(and(eq(salesPlaybookVersions.id, playbook.currentPublishedVersionId), eq(salesPlaybookVersions.status, "published")));
  }

  const [version] = await db
    .update(salesPlaybookVersions)
    .set({ status: "published", publishedAt: new Date(), revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(salesPlaybookVersions.id, input.versionId), eq(salesPlaybookVersions.organizationId, input.organizationId), eq(salesPlaybookVersions.revision, input.expectedRevision)))
    .returning();
  if (!version) throw new StaleSalesUpdateError("playbook version");

  await db.update(salesPlaybooks).set({ currentPublishedVersionId: version.id, lifecycle: "published", revision: playbook.revision + 1, updatedAt: new Date() }).where(eq(salesPlaybooks.id, playbook.id));

  await recordAuditEvent(db, { eventType: "sales_playbook_version_published", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "sales_playbook_version", targetId: version.id, metadata: { playbookId: playbook.id, versionNumber: version.versionNumber } });
  return version;
}
