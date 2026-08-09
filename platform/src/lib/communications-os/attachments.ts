import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { communicationAttachments } from "@/db/schema";
import { DomainRuleViolationError } from "@/lib/authz/errors";
import { resolveCommunicationAuthContext, requireCommunicationsDraftAuthority } from "./authz";
import { resolveMessageById } from "./messages";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB — a conservative bound matching common ESP attachment ceilings, not a proven figure.
const ALLOWED_MEDIA_TYPE_PREFIXES = ["image/", "application/pdf", "text/plain", "text/csv"];

class InvalidAttachmentError extends DomainRuleViolationError {
  readonly reason = "invalid_attachment";
  constructor(message: string) {
    super(message);
    this.name = "InvalidAttachmentError";
  }
}

export interface CommunicationAttachment {
  id: string;
  organizationId: string;
  messageId: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  artifactId: string | null;
  externalRef: string | null;
  providerAttachmentId: string | null;
  createdAt: Date;
}

/** Metadata/reference only — never a raw binary in Postgres. Requires exactly one real content pointer (`artifactId` for internally/agent-produced files, `externalRef` for inbound/provider-hosted content). */
export async function createAttachment(
  db: Db,
  input: { organizationId: string; messageId: string; filename: string; mediaType: string; sizeBytes: number; artifactId?: string | null; externalRef?: string | null; providerAttachmentId?: string | null; actorUserId: string }
): Promise<CommunicationAttachment> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsDraftAuthority(db, ctx, "communication_attachment", "new");
  await resolveMessageById(db, input.organizationId, input.messageId);

  if (!input.artifactId && !input.externalRef) throw new InvalidAttachmentError("An attachment requires either an artifactId or an externalRef.");
  if (input.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) throw new InvalidAttachmentError(`Attachment exceeds the maximum size of ${MAX_ATTACHMENT_SIZE_BYTES} bytes.`);
  if (!ALLOWED_MEDIA_TYPE_PREFIXES.some((prefix) => input.mediaType.startsWith(prefix))) throw new InvalidAttachmentError(`Media type "${input.mediaType}" is not permitted.`);

  const [row] = await db
    .insert(communicationAttachments)
    .values({
      organizationId: input.organizationId,
      messageId: input.messageId,
      filename: input.filename,
      mediaType: input.mediaType,
      sizeBytes: input.sizeBytes,
      artifactId: input.artifactId ?? null,
      externalRef: input.externalRef ?? null,
      providerAttachmentId: input.providerAttachmentId ?? null,
    })
    .returning();
  return row as CommunicationAttachment;
}

export async function listAttachmentsForMessage(db: Db, input: { organizationId: string; messageId: string; actorUserId: string }): Promise<CommunicationAttachment[]> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsDraftAuthority(db, ctx, "communication_attachment", input.messageId);
  return db.select().from(communicationAttachments).where(and(eq(communicationAttachments.organizationId, input.organizationId), eq(communicationAttachments.messageId, input.messageId))) as Promise<CommunicationAttachment[]>;
}
