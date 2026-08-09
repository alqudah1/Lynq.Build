export { db, rawSql, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, addOrgMember } from "@/lib/crm/test-helpers";

import { db, makeUser, addOrgMember } from "@/lib/crm/test-helpers";
import { grantCommunicationRole } from "./roles";
import { createConnection, verifyConnection } from "./connections";
import { findOrCreateConversation } from "./conversations";
import { createTemplate, publishTemplateVersion } from "./templates";
import type { CommunicationRole, CommunicationChannel } from "./validation";

function randKey(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

/** A real org member with an active Communications OS role, ready to be an actor. */
export async function makeCommunicationsUser(orgId: string, role: CommunicationRole = "communications_agent", grantedByUserId?: string): Promise<string> {
  const userId = await makeUser();
  await addOrgMember(orgId, userId, "member");
  await grantCommunicationRole(db, { organizationId: orgId, userId, role, actorUserId: grantedByUserId ?? userId });
  return userId;
}

/** A connected development-provider connection — never a real provider, always verifies. */
export async function makeTestConnection(orgId: string, actorUserId: string, channel: CommunicationChannel = "email") {
  const provider = channel === "email" ? "dev_email" : channel === "sms" ? "dev_sms" : "dev_whatsapp";
  const connection = await createConnection(db, { organizationId: orgId, provider, integrationType: channel, displayName: "Test Connection", actorUserId });
  const verified = await verifyConnection(db, { organizationId: orgId, connectionId: connection.id, actorUserId });
  return verified;
}

/** A conversation with no resolved contact, ready to attach messages to. */
export async function makeTestConversation(orgId: string, actorUserId: string, channel: CommunicationChannel = "email", connectionId?: string) {
  return findOrCreateConversation(db, { organizationId: orgId, channel, integrationConnectionId: connectionId ?? null, actorUserId });
}

/** A published, no-variable template — the minimum a bulk batch needs. */
export async function makeTestTemplate(orgId: string, actorUserId: string, channel: CommunicationChannel = "email") {
  const { template, version } = await createTemplate(db, { organizationId: orgId, channel, name: "Test Template", templateKey: randKey("tmpl").toLowerCase(), bodyTemplate: "Hello there.", variableSchema: [], actorUserId });
  await publishTemplateVersion(db, { organizationId: orgId, templateId: template.id, versionId: version.id, expectedRevision: template.revision, actorUserId });
  return { template, version };
}

export function randCommunicationsKey(prefix: string): string {
  return randKey(prefix);
}
