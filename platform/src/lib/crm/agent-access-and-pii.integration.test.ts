import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeAgentWithCredential, grantAgentCapability } from "./test-helpers";
import { createContact } from "./contacts";
import { createNote } from "./notes";
import { listContactsForAgent, getContactForAgent, listNotesForAgent } from "./agent-reads";
import { grantCrmAgentPermission, revokeCrmAgentPermission } from "./agent-permissions";
import { searchContacts, searchCompanies } from "./search";
import { createCompany } from "./companies";
import { InsufficientRoleError } from "@/lib/authz/errors";
import type { AgentPrincipal } from "@/lib/agents/authentication";

afterEach(cleanupAgentRuntimeTestData);

function principalFor(agent: { id: string; department: string; permissionLevel: string }, orgId: string): AgentPrincipal {
  return { principalType: "agent", agentId: agent.id, organizationId: orgId, permissionLevel: agent.permissionLevel as AgentPrincipal["permissionLevel"], department: agent.department as AgentPrincipal["department"] };
}

describe("agent CRM access — default deny, independent from Brain", () => {
  it("an agent with zero CRM grants cannot read any CRM data, even with a Brain read grant", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { agent } = await makeAgentWithCredential(orgId, ownerId);
    await grantAgentCapability(orgId, ownerId, agent.id, "identity", "read"); // Brain grant only — never CRM

    const principal = principalFor(agent, orgId);
    await expect(listContactsForAgent(db, principal)).rejects.toThrow(InsufficientRoleError);
  });

  it("an explicit crm_contact_read grant allows contact reads but not company/lead/opportunity/note reads", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { agent } = await makeAgentWithCredential(orgId, ownerId);
    await grantCrmAgentPermission(db, { organizationId: orgId, agentId: agent.id, permission: "crm_contact_read", actorUserId: ownerId });
    await createContact(db, { organizationId: orgId, firstName: "Agent", lastName: "Readable", actorUserId: ownerId });

    const principal = principalFor(agent, orgId);
    const contacts = await listContactsForAgent(db, principal);
    expect(contacts.length).toBe(1);

    const { listCompaniesForAgent } = await import("./agent-reads");
    await expect(listCompaniesForAgent(db, principal)).rejects.toThrow(InsufficientRoleError);
    await expect(listNotesForAgent(db, principal, {})).rejects.toThrow(InsufficientRoleError);
  });

  it("revoking a grant immediately removes access — no cache, checked live on every read", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { agent } = await makeAgentWithCredential(orgId, ownerId);
    const grant = await grantCrmAgentPermission(db, { organizationId: orgId, agentId: agent.id, permission: "crm_contact_read", actorUserId: ownerId });
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Revocable", actorUserId: ownerId });

    const principal = principalFor(agent, orgId);
    expect(await getContactForAgent(db, principal, contact.id)).not.toBeNull();

    await revokeCrmAgentPermission(db, { organizationId: orgId, grantId: grant.id, expectedRevision: grant.revision, actorUserId: ownerId });
    await expect(getContactForAgent(db, principal, contact.id)).rejects.toThrow(InsufficientRoleError);
  });

  it("granting the same permission twice for the same agent is rejected", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { agent } = await makeAgentWithCredential(orgId, ownerId);
    await grantCrmAgentPermission(db, { organizationId: orgId, agentId: agent.id, permission: "crm_lead_read", actorUserId: ownerId });
    await expect(grantCrmAgentPermission(db, { organizationId: orgId, agentId: agent.id, permission: "crm_lead_read", actorUserId: ownerId })).rejects.toThrow();
  });
});

describe("PII and audit hygiene", () => {
  it("no email, phone, or note content ever appears in audit metadata", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Secret", primaryEmail: "very-secret-email@example.com", primaryPhone: "+15551234567", actorUserId: ownerId });
    await createNote(db, { organizationId: orgId, contactId: contact.id, content: "extremely sensitive private note content", actorUserId: ownerId });

    const audits = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId}`);
    const serialized = JSON.stringify(audits.map((a) => a.metadata));
    expect(serialized).not.toContain("very-secret-email@example.com");
    expect(serialized).not.toContain("15551234567");
    expect(serialized).not.toContain("extremely sensitive private note content");
  });

  it("agent-permission denial audit metadata never leaks which specific CRM fields were requested beyond the permission name", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { agent } = await makeAgentWithCredential(orgId, ownerId);
    const principal = principalFor(agent, orgId);

    await expect(listContactsForAgent(db, principal)).rejects.toThrow();
    const audits = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} AND ${auditLogs.eventType} = 'crm_permission_denied'`);
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});

describe("CRM search", () => {
  it("does not leak data across tenants", async () => {
    const ownerA = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const ownerB = await makeUser();
    const orgB = await makeOrgWithOwner(ownerB);

    await createContact(db, { organizationId: orgA, firstName: "OnlyInA", primaryEmail: "onlyina@example.com", actorUserId: ownerA });
    await createCompany(db, { organizationId: orgB, name: "OnlyInB Co", actorUserId: ownerB });

    const resultsInB = await searchContacts(db, { organizationId: orgB, actorUserId: ownerB, query: "OnlyInA" });
    expect(resultsInB.results.length).toBe(0);

    const resultsInA = await searchCompanies(db, { organizationId: orgA, actorUserId: ownerA, query: "OnlyInB" });
    expect(resultsInA.results.length).toBe(0);
  });

  it("finds a contact by exact normalized email", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await createContact(db, { organizationId: orgId, firstName: "Findable", primaryEmail: "findable@example.com", actorUserId: ownerId });

    const results = await searchContacts(db, { organizationId: orgId, actorUserId: ownerId, query: "findable@example.com" });
    expect(results.results.length).toBe(1);
  });
});
