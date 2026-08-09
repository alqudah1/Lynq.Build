import "server-only";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { communicationConversations } from "@/db/schema";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveCommunicationAuthContext, requireCommunicationsViewAuthority, requireCommunicationsDraftAuthority } from "./authz";
import { StaleCommunicationUpdateError } from "./errors";
import type { CommunicationChannel, CommunicationConversationStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface CommunicationConversation {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  channel: CommunicationChannel;
  integrationConnectionId: string | null;
  contactId: string | null;
  companyId: string | null;
  leadId: string | null;
  opportunityId: string | null;
  externalThreadId: string | null;
  status: CommunicationConversationStatus;
  assignedUserId: string | null;
  lastMessageAt: Date | null;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateConversationInput {
  organizationId: string;
  workspaceId?: string | null;
  channel: CommunicationChannel;
  integrationConnectionId?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  leadId?: string | null;
  opportunityId?: string | null;
  externalThreadId?: string | null;
  assignedUserId?: string | null;
  actorUserId: string;
}

/** A conversation may exist with no resolved CRM contact — identity resolution is conservative and never auto-creates one. If an `externalThreadId` is given and a conversation already exists for it on this connection, that existing conversation is reused (idempotent) rather than creating a duplicate. */
export async function findOrCreateConversation(db: Db, input: CreateConversationInput): Promise<CommunicationConversation> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsDraftAuthority(db, ctx, "communication_conversation", "new");
  return findOrCreateConversationUnauthorized(db, input);
}

/**
 * The same idempotent find-or-create core, with no authorization check —
 * used exclusively by inbound provider-webhook ingestion (`webhooks.ts`),
 * which has no live human caller to authorize against. Webhook
 * authenticity is established independently, by signature verification at
 * the API route layer, before this is ever reached.
 */
export async function findOrCreateConversationUnauthorized(db: Db, input: Omit<CreateConversationInput, "actorUserId"> & { actorUserId?: string }): Promise<CommunicationConversation> {
  if (input.externalThreadId && input.integrationConnectionId) {
    const [existing] = await db
      .select()
      .from(communicationConversations)
      .where(
        and(
          eq(communicationConversations.organizationId, input.organizationId),
          eq(communicationConversations.integrationConnectionId, input.integrationConnectionId),
          eq(communicationConversations.externalThreadId, input.externalThreadId)
        )
      );
    if (existing) return existing as CommunicationConversation;
  }

  try {
    const [row] = await db
      .insert(communicationConversations)
      .values({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId ?? null,
        channel: input.channel,
        integrationConnectionId: input.integrationConnectionId ?? null,
        contactId: input.contactId ?? null,
        companyId: input.companyId ?? null,
        leadId: input.leadId ?? null,
        opportunityId: input.opportunityId ?? null,
        externalThreadId: input.externalThreadId ?? null,
        assignedUserId: input.assignedUserId ?? null,
      })
      .returning();

    await recordAuditEvent(db, { eventType: "communication_conversation_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "communication_conversation", targetId: row.id, metadata: { channel: input.channel, hasResolvedContact: Boolean(input.contactId) } });
    return row as CommunicationConversation;
  } catch (err) {
    if (isPostgresUniqueViolation(err) && input.externalThreadId && input.integrationConnectionId) {
      const [existing] = await db
        .select()
        .from(communicationConversations)
        .where(
          and(
            eq(communicationConversations.organizationId, input.organizationId),
            eq(communicationConversations.integrationConnectionId, input.integrationConnectionId),
            eq(communicationConversations.externalThreadId, input.externalThreadId)
          )
        );
      if (existing) return existing as CommunicationConversation;
    }
    throw err;
  }
}

export async function resolveConversationById(db: Db, organizationId: string, conversationId: string): Promise<CommunicationConversation> {
  const [row] = await db.select().from(communicationConversations).where(and(eq(communicationConversations.id, conversationId), eq(communicationConversations.organizationId, organizationId)));
  if (!row) throw new TenantResourceNotFoundError();
  return row as CommunicationConversation;
}

export async function getConversationForUser(db: Db, input: { organizationId: string; conversationId: string; actorUserId: string }): Promise<CommunicationConversation> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsViewAuthority(db, ctx, "communication_conversation", input.conversationId);
  return resolveConversationById(db, input.organizationId, input.conversationId);
}

export async function listConversationsForUser(db: Db, input: { organizationId: string; status?: CommunicationConversationStatus; actorUserId: string }): Promise<CommunicationConversation[]> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsViewAuthority(db, ctx, "communication_conversation", "list");
  const conditions = [eq(communicationConversations.organizationId, input.organizationId)];
  if (input.status) conditions.push(eq(communicationConversations.status, input.status));
  return db.select().from(communicationConversations).where(and(...conditions)).orderBy(desc(communicationConversations.lastMessageAt)) as Promise<CommunicationConversation[]>;
}

export async function updateConversationStatus(db: Db, input: { organizationId: string; conversationId: string; status: CommunicationConversationStatus; expectedRevision: number; actorUserId: string }): Promise<CommunicationConversation> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsViewAuthority(db, ctx, "communication_conversation", input.conversationId);

  const [row] = await db
    .update(communicationConversations)
    .set({ status: input.status, archivedAt: input.status === "archived" ? new Date() : null, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(communicationConversations.id, input.conversationId), eq(communicationConversations.organizationId, input.organizationId), eq(communicationConversations.revision, input.expectedRevision)))
    .returning();
  if (!row) throw new StaleCommunicationUpdateError("communication conversation");
  return row as CommunicationConversation;
}

export async function assignConversation(db: Db, input: { organizationId: string; conversationId: string; assignedUserId: string | null; expectedRevision: number; actorUserId: string }): Promise<CommunicationConversation> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsViewAuthority(db, ctx, "communication_conversation", input.conversationId);

  const [row] = await db
    .update(communicationConversations)
    .set({ assignedUserId: input.assignedUserId, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(communicationConversations.id, input.conversationId), eq(communicationConversations.organizationId, input.organizationId), eq(communicationConversations.revision, input.expectedRevision)))
    .returning();
  if (!row) throw new StaleCommunicationUpdateError("communication conversation");
  return row as CommunicationConversation;
}

/** Bumps `lastMessageAt`/revision whenever a message is attached — called internally by `messages.ts`, never directly by API/UI callers. */
export async function touchConversationLastMessageAt(db: Db, input: { organizationId: string; conversationId: string; at: Date }): Promise<void> {
  await db
    .update(communicationConversations)
    .set({ lastMessageAt: input.at, updatedAt: new Date() })
    .where(and(eq(communicationConversations.id, input.conversationId), eq(communicationConversations.organizationId, input.organizationId)));
}
