import "server-only";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { communicationMessageTemplates, communicationTemplateVersions } from "@/db/schema";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveCommunicationAuthContext, requireCommunicationsViewAuthority, requireCommunicationsManageTemplatesAuthority } from "./authz";
import { CommunicationKeyAlreadyTakenError, TemplateVersionImmutableError, TemplateNotPublishedError, StaleCommunicationUpdateError, UnknownTemplateVariableError, MissingRequiredTemplateVariableError } from "./errors";
import { templateVariableSchemaArray, type CommunicationChannel } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface CommunicationTemplate {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  channel: CommunicationChannel;
  name: string;
  templateKey: string;
  purpose: string | null;
  status: "draft" | "published" | "archived";
  currentPublishedVersionId: string | null;
  createdByUserId: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateVariableDeclaration {
  name: string;
  description?: string;
  required: boolean;
}

export interface CommunicationTemplateVersion {
  id: string;
  organizationId: string;
  templateId: string;
  versionNumber: number;
  status: "draft" | "published" | "superseded";
  subjectTemplate: string | null;
  bodyTemplate: string;
  variableSchema: TemplateVariableDeclaration[];
  publishedAt: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
}

export async function createTemplate(
  db: Db,
  input: { organizationId: string; workspaceId?: string | null; channel: CommunicationChannel; name: string; templateKey: string; purpose?: string; bodyTemplate: string; subjectTemplate?: string; variableSchema?: TemplateVariableDeclaration[]; actorUserId: string }
): Promise<{ template: CommunicationTemplate; version: CommunicationTemplateVersion }> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageTemplatesAuthority(db, ctx, "communication_message_template", "new");

  const variables = templateVariableSchemaArray.parse(input.variableSchema ?? []);

  let template: CommunicationTemplate;
  try {
    [template] = await db
      .insert(communicationMessageTemplates)
      .values({ organizationId: input.organizationId, workspaceId: input.workspaceId ?? null, channel: input.channel, name: input.name, templateKey: input.templateKey, purpose: input.purpose ?? null, createdByUserId: input.actorUserId })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new CommunicationKeyAlreadyTakenError("That template key is already in use.");
    throw err;
  }

  const [version] = await db
    .insert(communicationTemplateVersions)
    .values({ organizationId: input.organizationId, templateId: template.id, versionNumber: 1, subjectTemplate: input.subjectTemplate ?? null, bodyTemplate: input.bodyTemplate, variableSchema: variables, createdByUserId: input.actorUserId })
    .returning();

  await recordAuditEvent(db, { eventType: "communication_template_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "communication_message_template", targetId: template.id, metadata: { channel: input.channel, templateKey: input.templateKey } });
  return { template: template as CommunicationTemplate, version: version as unknown as CommunicationTemplateVersion };
}

export async function resolveTemplateById(db: Db, organizationId: string, templateId: string): Promise<CommunicationTemplate> {
  const [row] = await db.select().from(communicationMessageTemplates).where(and(eq(communicationMessageTemplates.id, templateId), eq(communicationMessageTemplates.organizationId, organizationId)));
  if (!row) throw new TenantResourceNotFoundError();
  return row as CommunicationTemplate;
}

export async function getTemplateForUser(db: Db, input: { organizationId: string; templateId: string; actorUserId: string }): Promise<CommunicationTemplate> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsViewAuthority(db, ctx, "communication_message_template", input.templateId);
  return resolveTemplateById(db, input.organizationId, input.templateId);
}

export async function listTemplatesForUser(db: Db, input: { organizationId: string; channel?: CommunicationChannel; actorUserId: string }): Promise<CommunicationTemplate[]> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsViewAuthority(db, ctx, "communication_message_template", "list");
  const conditions = [eq(communicationMessageTemplates.organizationId, input.organizationId)];
  if (input.channel) conditions.push(eq(communicationMessageTemplates.channel, input.channel));
  return db.select().from(communicationMessageTemplates).where(and(...conditions)).orderBy(desc(communicationMessageTemplates.createdAt)) as Promise<CommunicationTemplate[]>;
}

export async function createTemplateVersion(
  db: Db,
  input: { organizationId: string; templateId: string; bodyTemplate: string; subjectTemplate?: string; variableSchema?: TemplateVariableDeclaration[]; actorUserId: string }
): Promise<CommunicationTemplateVersion> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageTemplatesAuthority(db, ctx, "communication_message_template", input.templateId);

  const [latest] = await db
    .select({ versionNumber: communicationTemplateVersions.versionNumber })
    .from(communicationTemplateVersions)
    .where(and(eq(communicationTemplateVersions.templateId, input.templateId), eq(communicationTemplateVersions.organizationId, input.organizationId)))
    .orderBy(desc(communicationTemplateVersions.versionNumber))
    .limit(1);

  const variables = templateVariableSchemaArray.parse(input.variableSchema ?? []);
  const [version] = await db
    .insert(communicationTemplateVersions)
    .values({ organizationId: input.organizationId, templateId: input.templateId, versionNumber: (latest?.versionNumber ?? 0) + 1, subjectTemplate: input.subjectTemplate ?? null, bodyTemplate: input.bodyTemplate, variableSchema: variables, createdByUserId: input.actorUserId })
    .returning();
  return version as unknown as CommunicationTemplateVersion;
}

/** One-way — a published version is never editable again; publishing a new version instead. Marks any prior published version `superseded`. Revision-guarded on the template's own `currentPublishedVersionId` pointer update. */
export async function publishTemplateVersion(db: Db, input: { organizationId: string; templateId: string; versionId: string; expectedRevision: number; actorUserId: string }): Promise<CommunicationTemplateVersion> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsManageTemplatesAuthority(db, ctx, "communication_message_template", input.templateId);

  const [version] = await db.select().from(communicationTemplateVersions).where(and(eq(communicationTemplateVersions.id, input.versionId), eq(communicationTemplateVersions.organizationId, input.organizationId)));
  if (!version) throw new TenantResourceNotFoundError();
  if (version.status !== "draft") throw new TemplateVersionImmutableError();

  await db
    .update(communicationTemplateVersions)
    .set({ status: "superseded" })
    .where(and(eq(communicationTemplateVersions.templateId, input.templateId), eq(communicationTemplateVersions.status, "published")));

  const [published] = await db.update(communicationTemplateVersions).set({ status: "published", publishedAt: new Date() }).where(eq(communicationTemplateVersions.id, input.versionId)).returning();

  const [template] = await db
    .update(communicationMessageTemplates)
    .set({ status: "published", currentPublishedVersionId: input.versionId, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(communicationMessageTemplates.id, input.templateId), eq(communicationMessageTemplates.organizationId, input.organizationId), eq(communicationMessageTemplates.revision, input.expectedRevision)))
    .returning();
  if (!template) throw new StaleCommunicationUpdateError("communication message template");

  await recordAuditEvent(db, { eventType: "communication_template_version_published", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "communication_message_template", targetId: input.templateId, metadata: { versionId: input.versionId, versionNumber: version.versionNumber } });
  return published as unknown as CommunicationTemplateVersion;
}

export async function resolvePublishedTemplateVersion(db: Db, input: { organizationId: string; templateId: string }): Promise<CommunicationTemplateVersion> {
  const template = await resolveTemplateById(db, input.organizationId, input.templateId);
  if (!template.currentPublishedVersionId) throw new TemplateNotPublishedError();
  const [version] = await db.select().from(communicationTemplateVersions).where(eq(communicationTemplateVersions.id, template.currentPublishedVersionId));
  if (!version) throw new TemplateNotPublishedError();
  return version as unknown as CommunicationTemplateVersion;
}

export async function listTemplateVersions(db: Db, input: { organizationId: string; templateId: string; actorUserId: string }): Promise<CommunicationTemplateVersion[]> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsViewAuthority(db, ctx, "communication_message_template", input.templateId);
  return db
    .select()
    .from(communicationTemplateVersions)
    .where(and(eq(communicationTemplateVersions.templateId, input.templateId), eq(communicationTemplateVersions.organizationId, input.organizationId)))
    .orderBy(desc(communicationTemplateVersions.versionNumber)) as unknown as Promise<CommunicationTemplateVersion[]>;
}

const VARIABLE_TOKEN_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * A fixed `{{variableName}}` substitution engine — never arbitrary
 * JavaScript/code execution. Every token in the template body must be a
 * variable explicitly declared on this version's `variableSchema`
 * (`UnknownTemplateVariableError` otherwise); every declared REQUIRED
 * variable must be supplied (`MissingRequiredTemplateVariableError`
 * otherwise). Values are inserted as plain text — no HTML/script
 * injection surface, since output is always treated as a message body,
 * never re-parsed as markup by this engine.
 */
export function renderTemplate(version: Pick<CommunicationTemplateVersion, "bodyTemplate" | "subjectTemplate" | "variableSchema">, values: Record<string, string>): { subject: string | null; body: string } {
  const declared = new Map(version.variableSchema.map((v) => [v.name, v]));

  for (const decl of version.variableSchema) {
    if (decl.required && (values[decl.name] === undefined || values[decl.name] === "")) {
      throw new MissingRequiredTemplateVariableError(decl.name);
    }
  }

  const substitute = (text: string): string =>
    text.replace(VARIABLE_TOKEN_PATTERN, (_match, name: string) => {
      if (!declared.has(name)) throw new UnknownTemplateVariableError(name);
      return values[name] ?? "";
    });

  return {
    subject: version.subjectTemplate ? substitute(version.subjectTemplate) : null,
    body: substitute(version.bodyTemplate),
  };
}
