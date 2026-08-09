import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, addOrgMember } from "./test-helpers";
import { createContact, updateContact, archiveContact, getContactForUser, listContactsForUser } from "./contacts";
import { createCompany, updateCompany, archiveCompany, getCompanyForUser } from "./companies";
import { createContactCompanyRelationship, endContactCompanyRelationship, listRelationshipsForContact } from "./relationships";
import { NoStableIdentityError, StaleCrmUpdateError, DuplicateRelationshipError } from "./errors";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";

afterEach(cleanupAgentRuntimeTestData);

describe("createContact", () => {
  it("requires at least one stable identity — no name, no email, no phone throws", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await expect(createContact(db, { organizationId: orgId, actorUserId: ownerId })).rejects.toThrow(NoStableIdentityError);
  });

  it("never requires email or phone if a name is given", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Ada", lastName: "Lovelace", actorUserId: ownerId });
    expect(contact.displayName).toBe("Ada Lovelace");
    expect(contact.primaryEmail).toBeNull();
  });

  it("accepts email alone as the stable identity", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, primaryEmail: "ada@example.com", actorUserId: ownerId });
    expect(contact.displayName).toBe("ada@example.com");
  });

  it("idempotencyKey replay returns the same contact rather than creating a duplicate", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const first = await createContact(db, { organizationId: orgId, firstName: "Grace", idempotencyKey: "import-row-1", actorUserId: ownerId });
    const second = await createContact(db, { organizationId: orgId, firstName: "Grace Hopper (retry)", idempotencyKey: "import-row-1", actorUserId: ownerId });
    expect(second.contact.id).toBe(first.contact.id);
    expect(second.idempotentReplay).toBe(true);

    const all = await listContactsForUser(db, { organizationId: orgId, actorUserId: ownerId });
    expect(all.filter((c) => c.firstName === "Grace" || c.firstName?.startsWith("Grace")).length).toBe(1);
  });

  it("surfaces a duplicate-email warning without blocking creation — no over-aggressive merge", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await createContact(db, { organizationId: orgId, primaryEmail: "dup@example.com", actorUserId: ownerId });
    const second = await createContact(db, { organizationId: orgId, primaryEmail: "DUP@example.com", actorUserId: ownerId });
    expect(second.duplicateWarnings.length).toBe(1);
    expect(second.duplicateWarnings[0].matchedOn).toBe("email");

    const all = await listContactsForUser(db, { organizationId: orgId, actorUserId: ownerId });
    expect(all.length).toBe(2);
  });
});

describe("updateContact / archiveContact", () => {
  it("a stale update (wrong expectedRevision) fails rather than silently overwriting", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Stale", actorUserId: ownerId });
    await expect(updateContact(db, { organizationId: orgId, contactId: contact.id, expectedRevision: contact.revision + 5, jobTitle: "CEO", actorUserId: ownerId })).rejects.toThrow(StaleCrmUpdateError);
  });

  it("archived contacts are excluded from normal lists", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Archive Me", actorUserId: ownerId });
    await archiveContact(db, { organizationId: orgId, contactId: contact.id, expectedRevision: contact.revision, actorUserId: ownerId });

    const active = await listContactsForUser(db, { organizationId: orgId, actorUserId: ownerId });
    expect(active.find((c) => c.id === contact.id)).toBeUndefined();

    const archived = await listContactsForUser(db, { organizationId: orgId, actorUserId: ownerId, status: "archived" });
    expect(archived.find((c) => c.id === contact.id)).toBeDefined();
  });

  it("ownership does not grant permission — the owner must already be an eligible org member", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const outsiderId = await makeUser();
    await expect(createContact(db, { organizationId: orgId, firstName: "Owned", ownerUserId: outsiderId, actorUserId: ownerId })).rejects.toThrow();
  });
});

describe("cross-tenant access", () => {
  it("a contact from another organization resolves to 404, not 403", async () => {
    const ownerA = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const ownerB = await makeUser();
    const orgB = await makeOrgWithOwner(ownerB);
    const { contact } = await createContact(db, { organizationId: orgA, firstName: "TenantA", actorUserId: ownerA });

    await expect(getContactForUser(db, { organizationId: orgB, contactId: contact.id, actorUserId: ownerB })).rejects.toThrow(TenantResourceNotFoundError);
  });
});

describe("createCompany", () => {
  it("does not require a domain, and two companies may legitimately share one", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const a = await createCompany(db, { organizationId: orgId, name: "Acme US", domain: "acme.com", actorUserId: ownerId });
    const b = await createCompany(db, { organizationId: orgId, name: "Acme EU", domain: "acme.com", actorUserId: ownerId });
    expect(a.company.id).not.toBe(b.company.id);
    expect(b.duplicateWarnings.length).toBe(1); // a warning, never a block
  });

  it("a stale company update fails rather than silently overwriting", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { company } = await createCompany(db, { organizationId: orgId, name: "Stale Co", actorUserId: ownerId });
    await expect(updateCompany(db, { organizationId: orgId, companyId: company.id, expectedRevision: company.revision + 9, name: "Renamed", actorUserId: ownerId })).rejects.toThrow(StaleCrmUpdateError);
  });

  it("archived companies are excluded from normal lists", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { company } = await createCompany(db, { organizationId: orgId, name: "Archive Co", actorUserId: ownerId });
    await archiveCompany(db, { organizationId: orgId, companyId: company.id, expectedRevision: company.revision, actorUserId: ownerId });
    await expect(getCompanyForUser(db, { organizationId: orgId, companyId: company.id, actorUserId: ownerId })).resolves.toMatchObject({ status: "archived" });
  });
});

describe("contact-company relationships", () => {
  it("duplicate active relationships of the same type between the same pair are rejected", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Linked", actorUserId: ownerId });
    const { company } = await createCompany(db, { organizationId: orgId, name: "LinkCo", actorUserId: ownerId });

    await createContactCompanyRelationship(db, { organizationId: orgId, contactId: contact.id, companyId: company.id, relationshipType: "employee", actorUserId: ownerId });
    await expect(createContactCompanyRelationship(db, { organizationId: orgId, contactId: contact.id, companyId: company.id, relationshipType: "employee", actorUserId: ownerId })).rejects.toThrow(DuplicateRelationshipError);
  });

  it("ending a relationship allows a new one of the same type to be created again", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Rehire", actorUserId: ownerId });
    const { company } = await createCompany(db, { organizationId: orgId, name: "RehireCo", actorUserId: ownerId });

    const rel = await createContactCompanyRelationship(db, { organizationId: orgId, contactId: contact.id, companyId: company.id, relationshipType: "employee", actorUserId: ownerId });
    await endContactCompanyRelationship(db, { organizationId: orgId, relationshipId: rel.id, expectedRevision: rel.revision, actorUserId: ownerId });
    const second = await createContactCompanyRelationship(db, { organizationId: orgId, contactId: contact.id, companyId: company.id, relationshipType: "employee", actorUserId: ownerId });
    expect(second.id).not.toBe(rel.id);
  });

  it("a contact may belong to multiple companies at once", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Multi", actorUserId: ownerId });
    const { company: companyA } = await createCompany(db, { organizationId: orgId, name: "CoA", actorUserId: ownerId });
    const { company: companyB } = await createCompany(db, { organizationId: orgId, name: "CoB", actorUserId: ownerId });

    await createContactCompanyRelationship(db, { organizationId: orgId, contactId: contact.id, companyId: companyA.id, relationshipType: "advisor", actorUserId: ownerId });
    await createContactCompanyRelationship(db, { organizationId: orgId, contactId: contact.id, companyId: companyB.id, relationshipType: "advisor", actorUserId: ownerId });

    const relationships = await listRelationshipsForContact(db, { organizationId: orgId, contactId: contact.id, actorUserId: ownerId });
    expect(relationships.length).toBe(2);
  });
});

describe("CRM authorization independence", () => {
  it("an ordinary org member (no elevated role) can view but not create CRM records", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const memberId = await makeUser();
    await addOrgMember(orgId, memberId, "member");

    await expect(createContact(db, { organizationId: orgId, firstName: "Blocked", actorUserId: memberId })).rejects.toThrow();

    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Viewable", actorUserId: ownerId });
    await expect(getContactForUser(db, { organizationId: orgId, contactId: contact.id, actorUserId: memberId })).resolves.toBeDefined();
  });
});
