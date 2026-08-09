import "server-only";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmNotes } from "@/db/schema";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { resolveCrmAuthContext, requireCrmManageAuthority, requireCrmViewAuthority, resolveCrmEntityWorkspaceId } from "./authz";
import { NoTargetSpecifiedError, StaleCrmUpdateError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/** Internal CRM note. Never exposed through any public/unauthenticated API — every route that returns one requires an authenticated CRM view-authority check first. Content is never copied into audit metadata (only the note's id/target are recorded). */
export interface CrmNote {
  id: string;
  organizationId: string;
  contactId: string | null;
  companyId: string | null;
  leadId: string | null;
  opportunityId: string | null;
  authorUserId: string;
  content: string;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

async function resolveWorkspaceScope(db: Db, organizationId: string, input: { contactId?: string | null; companyId?: string | null; opportunityId?: string | null }): Promise<string | null> {
  if (input.contactId) return resolveCrmEntityWorkspaceId(db, organizationId, "contact", input.contactId);
  if (input.companyId) return resolveCrmEntityWorkspaceId(db, organizationId, "company", input.companyId);
  if (input.opportunityId) return resolveCrmEntityWorkspaceId(db, organizationId, "opportunity", input.opportunityId);
  return null;
}

export interface CreateNoteInput {
  organizationId: string;
  contactId?: string | null;
  companyId?: string | null;
  leadId?: string | null;
  opportunityId?: string | null;
  content: string;
  actorUserId: string;
}

export async function createNote(db: Db, input: CreateNoteInput): Promise<CrmNote> {
  if (!input.contactId && !input.companyId && !input.leadId && !input.opportunityId) throw new NoTargetSpecifiedError("note");

  const workspaceId = await resolveWorkspaceScope(db, input.organizationId, input);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_note", "new");

  const [row] = await db
    .insert(crmNotes)
    .values({
      organizationId: input.organizationId,
      contactId: input.contactId ?? null,
      companyId: input.companyId ?? null,
      leadId: input.leadId ?? null,
      opportunityId: input.opportunityId ?? null,
      authorUserId: input.actorUserId,
      content: input.content,
    })
    .returning();

  await recordAuditEvent(db, { eventType: "crm_note_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_note", targetId: row.id });
  return row as CrmNote;
}

export async function resolveNoteById(db: Db, organizationId: string, noteId: string): Promise<CrmNote> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(crmNotes).where(and(eq(crmNotes.id, noteId), eq(crmNotes.organizationId, organizationId)));
    return row as CrmNote | undefined;
  });
}

export async function updateNote(db: Db, input: { organizationId: string; noteId: string; expectedRevision: number; content: string; actorUserId: string }): Promise<CrmNote> {
  const existing = await resolveNoteById(db, input.organizationId, input.noteId);
  const workspaceId = await resolveWorkspaceScope(db, input.organizationId, existing);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_note", existing.id);

  const [updated] = await db
    .update(crmNotes)
    .set({ content: input.content, updatedAt: new Date(), revision: input.expectedRevision + 1 })
    .where(and(eq(crmNotes.id, input.noteId), eq(crmNotes.organizationId, input.organizationId), eq(crmNotes.revision, input.expectedRevision)))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("note");
  await recordAuditEvent(db, { eventType: "crm_note_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_note", targetId: updated.id });
  return updated as CrmNote;
}

export async function archiveNote(db: Db, input: { organizationId: string; noteId: string; expectedRevision: number; actorUserId: string }): Promise<CrmNote> {
  const existing = await resolveNoteById(db, input.organizationId, input.noteId);
  const workspaceId = await resolveWorkspaceScope(db, input.organizationId, existing);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_note", existing.id);

  const [updated] = await db
    .update(crmNotes)
    .set({ archivedAt: new Date(), updatedAt: new Date(), revision: input.expectedRevision + 1 })
    .where(and(eq(crmNotes.id, input.noteId), eq(crmNotes.organizationId, input.organizationId), eq(crmNotes.revision, input.expectedRevision)))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("note");
  await recordAuditEvent(db, { eventType: "crm_note_archived", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_note", targetId: updated.id });
  return updated as CrmNote;
}

export interface ListNotesInput {
  organizationId: string;
  actorUserId: string;
  contactId?: string;
  companyId?: string;
  leadId?: string;
  opportunityId?: string;
  limit?: number;
}

export async function listNotesForUser(db: Db, input: ListNotesInput): Promise<CrmNote[]> {
  const workspaceId = await resolveWorkspaceScope(db, input.organizationId, input);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_note", "list");

  const conditions = [eq(crmNotes.organizationId, input.organizationId)];
  if (input.contactId) conditions.push(eq(crmNotes.contactId, input.contactId));
  if (input.companyId) conditions.push(eq(crmNotes.companyId, input.companyId));
  if (input.leadId) conditions.push(eq(crmNotes.leadId, input.leadId));
  if (input.opportunityId) conditions.push(eq(crmNotes.opportunityId, input.opportunityId));

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await db
    .select()
    .from(crmNotes)
    .where(and(...conditions))
    .orderBy(desc(crmNotes.createdAt))
    .limit(limit);
  return (rows as CrmNote[]).filter((n) => !n.archivedAt);
}
