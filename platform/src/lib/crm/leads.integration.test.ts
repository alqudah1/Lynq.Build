import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeTestPipeline } from "./test-helpers";
import { createContact } from "./contacts";
import { createLead, qualifyLead, disqualifyLead, convertLead, getLeadForUser } from "./leads";
import { resolveOpportunityById } from "./opportunities";
import { StaleCrmUpdateError, InvalidLeadTransitionError, LeadNotQualifiedError } from "./errors";

afterEach(cleanupAgentRuntimeTestData);

describe("lead qualification lifecycle", () => {
  it("new -> qualified is allowed; disqualified is terminal", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    expect(lead.status).toBe("new");

    const qualified = await qualifyLead(db, { organizationId: orgId, leadId: lead.id, expectedRevision: lead.revision, actorUserId: ownerId });
    expect(qualified.status).toBe("qualified");
    expect(qualified.qualifiedAt).not.toBeNull();
  });

  it("a converted lead cannot be re-qualified or disqualified", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage } = await makeTestPipeline(orgId, ownerId);
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const qualified = await qualifyLead(db, { organizationId: orgId, leadId: lead.id, expectedRevision: lead.revision, actorUserId: ownerId });
    const { lead: converted } = await convertLead(db, { organizationId: orgId, leadId: lead.id, expectedRevision: qualified.revision, pipelineId: pipeline.id, stageId: newStage.id, actorUserId: ownerId });

    await expect(qualifyLead(db, { organizationId: orgId, leadId: lead.id, expectedRevision: converted.revision, actorUserId: ownerId })).rejects.toThrow(InvalidLeadTransitionError);
    await expect(disqualifyLead(db, { organizationId: orgId, leadId: lead.id, expectedRevision: converted.revision, actorUserId: ownerId })).rejects.toThrow(InvalidLeadTransitionError);
  });

  it("only a qualified lead may be converted", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage } = await makeTestPipeline(orgId, ownerId);
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });

    await expect(convertLead(db, { organizationId: orgId, leadId: lead.id, expectedRevision: lead.revision, pipelineId: pipeline.id, stageId: newStage.id, actorUserId: ownerId })).rejects.toThrow(LeadNotQualifiedError);
  });

  it("a stale qualify (wrong expectedRevision) fails deterministically", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    await expect(qualifyLead(db, { organizationId: orgId, leadId: lead.id, expectedRevision: lead.revision + 10, actorUserId: ownerId })).rejects.toThrow(StaleCrmUpdateError);
  });
});

describe("lead conversion", () => {
  it("is idempotent — repeated conversion calls return the same, already-created opportunity", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage } = await makeTestPipeline(orgId, ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Convert", actorUserId: ownerId });
    const lead = await createLead(db, { organizationId: orgId, contactId: contact.id, actorUserId: ownerId });
    const qualified = await qualifyLead(db, { organizationId: orgId, leadId: lead.id, expectedRevision: lead.revision, actorUserId: ownerId });

    const first = await convertLead(db, { organizationId: orgId, leadId: lead.id, expectedRevision: qualified.revision, pipelineId: pipeline.id, stageId: newStage.id, actorUserId: ownerId });
    const second = await convertLead(db, { organizationId: orgId, leadId: lead.id, expectedRevision: first.lead.revision, pipelineId: pipeline.id, stageId: newStage.id, actorUserId: ownerId });

    expect(second.opportunity.id).toBe(first.opportunity.id);
  });

  it("the converted lead references the created opportunity, and the opportunity carries the lead's contact forward", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage } = await makeTestPipeline(orgId, ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Carry", actorUserId: ownerId });
    const lead = await createLead(db, { organizationId: orgId, contactId: contact.id, actorUserId: ownerId });
    const qualified = await qualifyLead(db, { organizationId: orgId, leadId: lead.id, expectedRevision: lead.revision, actorUserId: ownerId });
    const { lead: converted, opportunity } = await convertLead(db, { organizationId: orgId, leadId: lead.id, expectedRevision: qualified.revision, pipelineId: pipeline.id, stageId: newStage.id, actorUserId: ownerId });

    expect(converted.convertedOpportunityId).toBe(opportunity.id);
    expect(opportunity.primaryContactId).toBe(contact.id);

    const reloaded = await getLeadForUser(db, { organizationId: orgId, leadId: lead.id, actorUserId: ownerId });
    expect(reloaded.status).toBe("converted");

    const resolvedOpportunity = await resolveOpportunityById(db, orgId, opportunity.id);
    expect(resolvedOpportunity.status).toBe("open");
  });
});
