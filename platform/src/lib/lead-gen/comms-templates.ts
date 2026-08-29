import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { communicationMessageTemplates } from "@/db/schema";
import { createTemplate, publishTemplateVersion, resolveTemplateById, type CommunicationTemplate } from "@/lib/communications-os/templates";
import {
  namedOutreachTemplateBody,
  outreachTemplateKey,
  outreachTemplateVariableDeclarations,
  type OutreachTemplateName,
} from "./outreach";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Ensures the Communications OS template that mirrors a Meta approved
 * template exists and is published, so a bulk batch can reference it.
 * Idempotent: called repeatedly, it resolves the existing template rather
 * than creating a second one.
 *
 * Important: this publishes a template inside LYNQ. It does NOT approve
 * anything at Meta — Meta template approval happens in WhatsApp Manager
 * and is Mustafa's manual step. The two are kept textually identical by
 * deriving both from `OUTREACH_TEMPLATE_BODIES`.
 */
export async function ensureOutreachTemplate(
  db: Db,
  input: { organizationId: string; templateName: OutreachTemplateName; actorUserId: string }
): Promise<CommunicationTemplate> {
  const templateKey = outreachTemplateKey(input.templateName);

  const [existing] = await db
    .select()
    .from(communicationMessageTemplates)
    .where(and(eq(communicationMessageTemplates.organizationId, input.organizationId), eq(communicationMessageTemplates.templateKey, templateKey)));

  if (existing) {
    if (existing.currentPublishedVersionId) return existing as CommunicationTemplate;
    // Created but never published — finish the job rather than leaving a
    // template a batch cannot reference.
    const { communicationTemplateVersions } = await import("@/db/schema");
    const [draft] = await db
      .select()
      .from(communicationTemplateVersions)
      .where(and(eq(communicationTemplateVersions.templateId, existing.id), eq(communicationTemplateVersions.organizationId, input.organizationId), eq(communicationTemplateVersions.status, "draft")));
    if (!draft) return existing as CommunicationTemplate;
    await publishTemplateVersion(db, { organizationId: input.organizationId, templateId: existing.id, versionId: draft.id, expectedRevision: existing.revision, actorUserId: input.actorUserId });
    return resolveTemplateById(db, input.organizationId, existing.id);
  }

  const { template, version } = await createTemplate(db, {
    organizationId: input.organizationId,
    channel: "whatsapp",
    name: `LYNQ outreach — ${input.templateName}`,
    templateKey,
    purpose: "Business-initiated WhatsApp outreach introducing a prospect's own demo. Mirrors the Meta approved template of the same name.",
    bodyTemplate: namedOutreachTemplateBody(input.templateName),
    variableSchema: outreachTemplateVariableDeclarations(),
    actorUserId: input.actorUserId,
  });

  await publishTemplateVersion(db, { organizationId: input.organizationId, templateId: template.id, versionId: version.id, expectedRevision: template.revision, actorUserId: input.actorUserId });
  return resolveTemplateById(db, input.organizationId, template.id);
}
