import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentArtifacts } from "@/db/schema";
import { DomainRuleViolationError } from "@/lib/authz/errors";
import { getContentItemForUser } from "@/lib/marketing-os/content";
import { resolveCampaignById } from "@/lib/marketing-os/campaigns";
import { createTemplate, publishTemplateVersion } from "./templates";
import { createBulkBatch } from "./bulk";
import type { CommunicationChannel } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

class ContentNotEligibleForCommunicationError extends DomainRuleViolationError {
  readonly reason = "content_not_eligible_for_communication";
  constructor(message: string) {
    super(message);
    this.name = "ContentNotEligibleForCommunicationError";
  }
}

const ELIGIBLE_CONTENT_TYPES = new Set(["email_draft", "announcement"]);
const CONTENT_TYPE_TO_CHANNEL: Record<string, CommunicationChannel> = { email_draft: "email", announcement: "email" };

/**
 * ============================================================================
 * Marketing OS integration — Module 16
 * ============================================================================
 * "Approved email_draft content → outbound email draft; approved
 * announcement → communication draft where channel compatible." Requires
 * the content item to already be `approved` (Marketing OS's own approval
 * gate — never bypassed or duplicated here) and wraps its real artifact
 * body as a one-off, immediately-published Communications OS template (no
 * declared variables — this is fixed, already-approved copy, not a
 * reusable template with placeholders). Creates a bulk batch in `draft`
 * status only — recipient snapshotting, approval, and starting the batch
 * remain separate, explicit steps; nothing here auto-sends, and this is
 * NOT full bulk campaign blast orchestration — just the bounded bridge
 * from an approved piece of content to Communications OS's own
 * bounded-batch foundation.
 */
export async function createBulkBatchFromApprovedContent(
  db: Db,
  input: { organizationId: string; contentItemId: string; maxRecipients?: number; actorUserId: string }
): Promise<{ batchId: string }> {
  const contentItem = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: input.contentItemId, actorUserId: input.actorUserId });

  if (contentItem.status !== "approved") throw new ContentNotEligibleForCommunicationError("Content must be approved before it can become a communication.");
  if (!ELIGIBLE_CONTENT_TYPES.has(contentItem.contentType)) throw new ContentNotEligibleForCommunicationError(`Content type "${contentItem.contentType}" is not eligible for a communication draft.`);
  if (!contentItem.currentArtifactId) throw new ContentNotEligibleForCommunicationError("Content has no current artifact to draw a body from.");

  const [artifact] = await db.select({ content: agentArtifacts.content, title: agentArtifacts.title }).from(agentArtifacts).where(and(eq(agentArtifacts.id, contentItem.currentArtifactId), eq(agentArtifacts.organizationId, input.organizationId)));
  if (!artifact?.content) throw new ContentNotEligibleForCommunicationError("Content's current artifact has no body.");

  const channel = CONTENT_TYPE_TO_CHANNEL[contentItem.contentType];
  const campaign = await resolveCampaignById(db, input.organizationId, contentItem.campaignId);

  const { template, version } = await createTemplate(db, {
    organizationId: input.organizationId,
    channel,
    name: `${contentItem.title} (from Marketing content)`,
    templateKey: `marketing-content-${contentItem.id}`,
    purpose: "One-off template wrapping already-approved Marketing OS content — no declared variables.",
    subjectTemplate: artifact.title,
    bodyTemplate: artifact.content,
    variableSchema: [],
    actorUserId: input.actorUserId,
  });
  await publishTemplateVersion(db, { organizationId: input.organizationId, templateId: template.id, versionId: version.id, expectedRevision: template.revision, actorUserId: input.actorUserId });

  const batch = await createBulkBatch(db, {
    organizationId: input.organizationId,
    name: `${campaign.name} — ${contentItem.title}`,
    channel,
    campaignId: campaign.id,
    audienceId: campaign.primaryAudienceId,
    templateId: template.id,
    maxRecipients: input.maxRecipients,
    actorUserId: input.actorUserId,
  });

  return { batchId: batch.id };
}
