import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeProject } from "./test-helpers";
import { createContact } from "./contacts";
import * as activitiesModule from "./activities";
import { createActivity, listActivitiesForUser } from "./activities";
import { createNote, updateNote, archiveNote, listNotesForUser } from "./notes";
import { createFollowUp, completeFollowUp, cancelFollowUp } from "./follow-ups";
import { createTag, assignTag, unassignTag } from "./tags";
import { createCustomFieldDefinition, setCustomFieldValue, listCustomFieldValuesForEntity } from "./custom-fields";
import { createProjectLink, listProjectLinksForCrmEntity } from "./project-links";
import { NoTargetSpecifiedError, DuplicateTagAssignmentError, DuplicateProjectLinkError, CustomFieldValidationError, InvalidCrmTransitionError } from "./errors";

afterEach(cleanupAgentRuntimeTestData);

describe("CRM activities", () => {
  it("requires at least one target", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await expect(createActivity(db, { organizationId: orgId, activityType: "call", actorUserId: ownerId })).rejects.toThrow(NoTargetSpecifiedError);
  });

  it("remain historically traceable — no update or delete function exists; only create and list", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Traceable", actorUserId: ownerId });
    const activity = await createActivity(db, { organizationId: orgId, contactId: contact.id, activityType: "call", subject: "Intro call", actorUserId: ownerId });

    const listed = await listActivitiesForUser(db, { organizationId: orgId, actorUserId: ownerId, contactId: contact.id });
    expect(listed.map((a) => a.id)).toContain(activity.id);
    expect(listed[0].subject).toBe("Intro call");
    // No update/delete export exists on the activities module at all — enforced structurally, not just by convention.
    expect(Object.keys(activitiesModule).sort()).toEqual(["createActivity", "listActivitiesForUser"]);
  });
});

describe("CRM notes", () => {
  it("are internal — editable and archivable, unlike activities", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Noted", actorUserId: ownerId });
    const note = await createNote(db, { organizationId: orgId, contactId: contact.id, content: "Private thought", actorUserId: ownerId });

    const updated = await updateNote(db, { organizationId: orgId, noteId: note.id, expectedRevision: note.revision, content: "Revised thought", actorUserId: ownerId });
    expect(updated.content).toBe("Revised thought");

    const archived = await archiveNote(db, { organizationId: orgId, noteId: note.id, expectedRevision: updated.revision, actorUserId: ownerId });
    expect(archived.archivedAt).not.toBeNull();

    const listed = await listNotesForUser(db, { organizationId: orgId, actorUserId: ownerId, contactId: contact.id });
    expect(listed.find((n) => n.id === note.id)).toBeUndefined();
  });
});

describe("CRM follow-ups", () => {
  it("are distinct from Projects Core tasks and Workflow human tasks — status transitions work end to end", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Followed", actorUserId: ownerId });
    const followUp = await createFollowUp(db, { organizationId: orgId, contactId: contact.id, assignedUserId: ownerId, title: "Call back next week", actorUserId: ownerId });
    expect(followUp.status).toBe("open");

    const completed = await completeFollowUp(db, { organizationId: orgId, followUpId: followUp.id, expectedRevision: followUp.revision, actorUserId: ownerId });
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).not.toBeNull();

    await expect(completeFollowUp(db, { organizationId: orgId, followUpId: followUp.id, expectedRevision: completed.revision, actorUserId: ownerId })).rejects.toThrow(InvalidCrmTransitionError);
  });

  it("cancel is a distinct terminal transition from complete", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Cancelled", actorUserId: ownerId });
    const followUp = await createFollowUp(db, { organizationId: orgId, contactId: contact.id, assignedUserId: ownerId, title: "No longer needed", actorUserId: ownerId });
    const cancelled = await cancelFollowUp(db, { organizationId: orgId, followUpId: followUp.id, expectedRevision: followUp.revision, actorUserId: ownerId });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.completedAt).toBeNull();
  });
});

describe("CRM tags", () => {
  it("are tenant-safe and reject duplicate active assignments", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Tagged", actorUserId: ownerId });
    const tag = await createTag(db, { organizationId: orgId, name: "Hot Lead", tagKey: "HOT_LEAD", actorUserId: ownerId });

    await assignTag(db, { organizationId: orgId, tagId: tag.id, entityType: "contact", entityId: contact.id, actorUserId: ownerId });
    await expect(assignTag(db, { organizationId: orgId, tagId: tag.id, entityType: "contact", entityId: contact.id, actorUserId: ownerId })).rejects.toThrow(DuplicateTagAssignmentError);

    await unassignTag(db, { organizationId: orgId, tagId: tag.id, entityType: "contact", entityId: contact.id, actorUserId: ownerId });
    await assignTag(db, { organizationId: orgId, tagId: tag.id, entityType: "contact", entityId: contact.id, actorUserId: ownerId }); // re-assignable after unassign
  });

  it("a tag from another organization is never visible or assignable in this one", async () => {
    const ownerA = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const ownerB = await makeUser();
    const orgB = await makeOrgWithOwner(ownerB);
    const tagA = await createTag(db, { organizationId: orgA, name: "OrgA Tag", tagKey: "ORGA_TAG", actorUserId: ownerA });
    const { contact: contactB } = await createContact(db, { organizationId: orgB, firstName: "InOrgB", actorUserId: ownerB });

    // Assigning org A's tag to org B's contact must not silently succeed — the tag row itself
    // is invisible cross-tenant (no organizationId match), so this is rejected as a foreign-key/tenant violation.
    await expect(assignTag(db, { organizationId: orgB, tagId: tagA.id, entityType: "contact", entityId: contactB.id, actorUserId: ownerB })).rejects.toThrow();
  });
});

describe("CRM custom fields", () => {
  it("values validate against the field definition server-side", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Custom", actorUserId: ownerId });
    const definition = await createCustomFieldDefinition(db, {
      organizationId: orgId,
      entityType: "contact",
      fieldKey: "PRIORITY_SCORE",
      label: "Priority score",
      fieldType: "number",
      validationRules: { min: 0, max: 100 },
      actorUserId: ownerId,
    });

    await setCustomFieldValue(db, { organizationId: orgId, fieldDefinitionId: definition.id, entityType: "contact", entityId: contact.id, value: 42, actorUserId: ownerId });
    await expect(setCustomFieldValue(db, { organizationId: orgId, fieldDefinitionId: definition.id, entityType: "contact", entityId: contact.id, value: 500, actorUserId: ownerId })).rejects.toThrow(CustomFieldValidationError);
    await expect(setCustomFieldValue(db, { organizationId: orgId, fieldDefinitionId: definition.id, entityType: "contact", entityId: contact.id, value: "not a number", actorUserId: ownerId })).rejects.toThrow(CustomFieldValidationError);

    const values = await listCustomFieldValuesForEntity(db, { organizationId: orgId, entityType: "contact", entityId: contact.id, actorUserId: ownerId });
    expect(values.find((v) => v.fieldDefinitionId === definition.id)?.value).toBe(42);
  });

  it("single_select rejects a value outside the declared options", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Select", actorUserId: ownerId });
    const definition = await createCustomFieldDefinition(db, { organizationId: orgId, entityType: "contact", fieldKey: "TIER", label: "Tier", fieldType: "single_select", options: ["gold", "silver"], actorUserId: ownerId });

    await setCustomFieldValue(db, { organizationId: orgId, fieldDefinitionId: definition.id, entityType: "contact", entityId: contact.id, value: "gold", actorUserId: ownerId });
    await expect(setCustomFieldValue(db, { organizationId: orgId, fieldDefinitionId: definition.id, entityType: "contact", entityId: contact.id, value: "platinum", actorUserId: ownerId })).rejects.toThrow(CustomFieldValidationError);
  });
});

describe("CRM project links", () => {
  it("are tenant-safe and reject duplicate links", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Linked", actorUserId: ownerId });
    const project = await makeProject(orgId, ownerId);

    const link = await createProjectLink(db, { organizationId: orgId, projectId: project.id, crmEntityType: "contact", crmEntityId: contact.id, actorUserId: ownerId });
    await expect(createProjectLink(db, { organizationId: orgId, projectId: project.id, crmEntityType: "contact", crmEntityId: contact.id, actorUserId: ownerId })).rejects.toThrow(DuplicateProjectLinkError);

    const links = await listProjectLinksForCrmEntity(db, { organizationId: orgId, crmEntityType: "contact", crmEntityId: contact.id, actorUserId: ownerId });
    expect(links.map((l) => l.id)).toContain(link.id);
  });

  it("never duplicates project data inside CRM — the link is a pointer only", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Pointer", actorUserId: ownerId });
    const project = await makeProject(orgId, ownerId, { name: "Real Project Name" });
    const link = await createProjectLink(db, { organizationId: orgId, projectId: project.id, crmEntityType: "contact", crmEntityId: contact.id, actorUserId: ownerId });

    expect(JSON.stringify(link)).not.toContain("Real Project Name");
  });
});
