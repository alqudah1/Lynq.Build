import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { and, eq, desc, ne } from "drizzle-orm";
import { founderDecisions, projects, crmOpportunities, marketingCampaigns, workflowDefinitions } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveFounderAuthContext, requireFounderViewAuthority, requireFounderManageDecisionsAuthority } from "./authz";
import { StaleFounderUpdateError, DecisionAlreadySupersededError, InvalidRelatedRecordError } from "./errors";
import { titleSchema, decisionTextSchema, type FounderDecisionStatus } from "./validation";
import { createKnowledgeItem, type KnowledgeDomain } from "@/lib/brain/knowledge-items";
import type { NeonQueryFunction } from "@neondatabase/serverless";

type RawSql = NeonQueryFunction<false, false>;

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface FounderDecision {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  title: string;
  decision: string;
  contextSummary: string | null;
  decisionOwnerUserId: string;
  decisionDate: Date;
  relatedProjectId: string | null;
  relatedOpportunityId: string | null;
  relatedCampaignId: string | null;
  relatedWorkflowDefinitionId: string | null;
  relatedArtifactId: string | null;
  status: FounderDecisionStatus;
  reviewDate: Date | null;
  promotedToBrainAt: Date | null;
  supersededByDecisionId: string | null;
  revision: number;
}

async function assertRelatedRecordsBelongToOrg(db: Db, organizationId: string, input: { relatedProjectId?: string | null; relatedOpportunityId?: string | null; relatedCampaignId?: string | null; relatedWorkflowDefinitionId?: string | null }): Promise<void> {
  if (input.relatedProjectId) {
    const [row] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.relatedProjectId), eq(projects.organizationId, organizationId)));
    if (!row) throw new InvalidRelatedRecordError("project");
  }
  if (input.relatedOpportunityId) {
    const [row] = await db.select({ id: crmOpportunities.id }).from(crmOpportunities).where(and(eq(crmOpportunities.id, input.relatedOpportunityId), eq(crmOpportunities.organizationId, organizationId)));
    if (!row) throw new InvalidRelatedRecordError("opportunity");
  }
  if (input.relatedCampaignId) {
    const [row] = await db.select({ id: marketingCampaigns.id }).from(marketingCampaigns).where(and(eq(marketingCampaigns.id, input.relatedCampaignId), eq(marketingCampaigns.organizationId, organizationId)));
    if (!row) throw new InvalidRelatedRecordError("campaign");
  }
  if (input.relatedWorkflowDefinitionId) {
    const [row] = await db.select({ id: workflowDefinitions.id }).from(workflowDefinitions).where(and(eq(workflowDefinitions.id, input.relatedWorkflowDefinitionId), eq(workflowDefinitions.organizationId, organizationId)));
    if (!row) throw new InvalidRelatedRecordError("workflow definition");
  }
}

export async function createFounderDecision(
  db: Db,
  input: {
    organizationId: string;
    workspaceId?: string | null;
    title: string;
    decision: string;
    contextSummary?: string | null;
    decisionOwnerUserId: string;
    decisionDate?: Date;
    relatedProjectId?: string | null;
    relatedOpportunityId?: string | null;
    relatedCampaignId?: string | null;
    relatedWorkflowDefinitionId?: string | null;
    relatedArtifactId?: string | null;
    status?: FounderDecisionStatus;
    reviewDate?: Date | null;
    actorUserId: string;
  }
): Promise<FounderDecision> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderManageDecisionsAuthority(db, ctx, "founder_decision", "new");

  const title = titleSchema.parse(input.title);
  const decisionText = decisionTextSchema.parse(input.decision);
  await assertRelatedRecordsBelongToOrg(db, input.organizationId, input);

  const [row] = await db
    .insert(founderDecisions)
    .values({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId ?? null,
      title,
      decision: decisionText,
      contextSummary: input.contextSummary ?? null,
      decisionOwnerUserId: input.decisionOwnerUserId,
      decisionDate: input.decisionDate ?? new Date(),
      relatedProjectId: input.relatedProjectId ?? null,
      relatedOpportunityId: input.relatedOpportunityId ?? null,
      relatedCampaignId: input.relatedCampaignId ?? null,
      relatedWorkflowDefinitionId: input.relatedWorkflowDefinitionId ?? null,
      relatedArtifactId: input.relatedArtifactId ?? null,
      status: input.status ?? "proposed",
      reviewDate: input.reviewDate ?? null,
      createdByUserId: input.actorUserId,
    })
    .returning();

  await recordAuditEvent(db, { eventType: "founder_decision_created", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "founder_decision", targetId: row.id, metadata: { status: row.status } });
  return row as FounderDecision;
}

export async function listFounderDecisions(db: Db, input: { organizationId: string; actorUserId: string }): Promise<FounderDecision[]> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, ctx, "founder_decision", input.organizationId);
  const rows = await db.select().from(founderDecisions).where(eq(founderDecisions.organizationId, input.organizationId)).orderBy(desc(founderDecisions.decisionDate));
  return rows as FounderDecision[];
}

async function loadDecisionRow(db: Db, organizationId: string, decisionId: string): Promise<FounderDecision> {
  const [row] = await db.select().from(founderDecisions).where(and(eq(founderDecisions.id, decisionId), eq(founderDecisions.organizationId, organizationId)));
  if (!row) throw new InvalidRelatedRecordError("decision");
  return row as FounderDecision;
}

export async function updateFounderDecision(
  db: Db,
  input: {
    organizationId: string;
    decisionId: string;
    expectedRevision: number;
    title?: string;
    decision?: string;
    contextSummary?: string | null;
    status?: FounderDecisionStatus;
    reviewDate?: Date | null;
    actorUserId: string;
  }
): Promise<FounderDecision> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderManageDecisionsAuthority(db, ctx, "founder_decision", input.decisionId);

  const values: Record<string, unknown> = { revision: input.expectedRevision + 1, updatedAt: new Date() };
  if (input.title !== undefined) values.title = titleSchema.parse(input.title);
  if (input.decision !== undefined) values.decision = decisionTextSchema.parse(input.decision);
  if (input.contextSummary !== undefined) values.contextSummary = input.contextSummary;
  if (input.status !== undefined) values.status = input.status;
  if (input.reviewDate !== undefined) values.reviewDate = input.reviewDate;

  const [row] = await db
    .update(founderDecisions)
    .set(values)
    .where(and(eq(founderDecisions.id, input.decisionId), eq(founderDecisions.organizationId, input.organizationId), eq(founderDecisions.revision, input.expectedRevision)))
    .returning();
  if (!row) throw new StaleFounderUpdateError("decision");

  await recordAuditEvent(db, { eventType: "founder_decision_updated", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "founder_decision", targetId: row.id, metadata: {} });
  return row as FounderDecision;
}

/** Single-use: marks THIS decision superseded, pointing at the real decision that replaces it — the revision guard AND the `ne(status, 'superseded')` condition together make a double-supersede impossible even under a race. */
export async function supersedeFounderDecision(db: Db, input: { organizationId: string; decisionId: string; expectedRevision: number; supersededByDecisionId: string; actorUserId: string }): Promise<FounderDecision> {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderManageDecisionsAuthority(db, ctx, "founder_decision", input.decisionId);

  const replacement = await loadDecisionRow(db, input.organizationId, input.supersededByDecisionId);
  void replacement; // existence + tenant check only

  const [row] = await db
    .update(founderDecisions)
    .set({ status: "superseded", supersededByDecisionId: input.supersededByDecisionId, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(founderDecisions.id, input.decisionId), eq(founderDecisions.organizationId, input.organizationId), eq(founderDecisions.revision, input.expectedRevision), ne(founderDecisions.status, "superseded")))
    .returning();
  if (!row) {
    const existing = await loadDecisionRow(db, input.organizationId, input.decisionId);
    if (existing.status === "superseded") throw new DecisionAlreadySupersededError();
    throw new StaleFounderUpdateError("decision");
  }

  await recordAuditEvent(db, { eventType: "founder_decision_superseded", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "founder_decision", targetId: row.id, metadata: { supersededByDecisionId: input.supersededByDecisionId } });
  return row as FounderDecision;
}

/**
 * Promotes a decision into the Company Brain — EXPLICIT, never automatic,
 * and only ever through Brain's own real, unmodified `createKnowledgeItem`
 * (Module 5/16), which creates a Draft-status item requiring Brain's own
 * separate approval/publish workflow before it becomes active knowledge —
 * this function never bypasses that. Sets `promotedToBrainAt` only after
 * the knowledge item is actually created.
 */
export async function promoteFounderDecisionToBrain(db: Db, rawSql: RawSql, input: { organizationId: string; decisionId: string; domain: KnowledgeDomain; classification: string; actorUserId: string }) {
  const ctx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderManageDecisionsAuthority(db, ctx, "founder_decision", input.decisionId);

  const decision = await loadDecisionRow(db, input.organizationId, input.decisionId);
  const content = decision.contextSummary ? `${decision.decision}\n\nContext: ${decision.contextSummary}` : decision.decision;
  const knowledgeItem = await createKnowledgeItem(db, rawSql, { organizationId: input.organizationId, workspaceId: decision.workspaceId, domain: input.domain, classification: input.classification, title: decision.title, content, actorUserId: input.actorUserId });

  await db.update(founderDecisions).set({ promotedToBrainAt: new Date(), updatedAt: new Date() }).where(eq(founderDecisions.id, input.decisionId));
  return knowledgeItem;
}
