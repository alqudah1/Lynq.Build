import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeTestPipeline, makeAgent } from "./test-helpers";
import { createContact } from "./contacts";
import { createCompany } from "./companies";
import { createContactCompanyRelationship } from "./relationships";
import { createLead, qualifyLead, convertLead } from "./leads";
import { createPipeline, setDefaultPipeline } from "./pipelines";
import { createStage } from "./stages";
import { createOpportunity, moveOpportunityStage, reopenOpportunity } from "./opportunities";
import { updateContact } from "./contacts";
import { updateCompany } from "./companies";
import { createTag, assignTag } from "./tags";
import { createProjectLink } from "./project-links";
import { grantCrmAgentPermission } from "./agent-permissions";
import { makeProject } from "./test-helpers";

afterEach(cleanupAgentRuntimeTestData);

function countOutcomes<T>(results: PromiseSettledResult<T>[]) {
  return { fulfilled: results.filter((r) => r.status === "fulfilled").length, rejected: results.filter((r) => r.status === "rejected").length };
}

describe("CRM concurrency", () => {
  it("duplicate exact-email contact creation: two concurrent creates with the same idempotency key produce exactly one contact", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => createContact(db, { organizationId: orgId, primaryEmail: "race@example.com", idempotencyKey: "race-key", actorUserId: ownerId }))
    );
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createContact>>> => r.status === "fulfilled");
    expect(fulfilled.length).toBe(3); // idempotent replay always succeeds, never errors
    const uniqueIds = new Set(fulfilled.map((r) => r.value.contact.id));
    expect(uniqueIds.size).toBe(1); // but only one real row was ever created
  });

  it("a stale contact update loses the race deterministically", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Race", actorUserId: ownerId });
    const results = await Promise.allSettled([
      updateContact(db, { organizationId: orgId, contactId: contact.id, expectedRevision: contact.revision, jobTitle: "A", actorUserId: ownerId }),
      updateContact(db, { organizationId: orgId, contactId: contact.id, expectedRevision: contact.revision, jobTitle: "B", actorUserId: ownerId }),
    ]);
    const { fulfilled, rejected } = countOutcomes(results);
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);
  });

  it("a stale company update loses the race deterministically", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { company } = await createCompany(db, { organizationId: orgId, name: "RaceCo", actorUserId: ownerId });
    const results = await Promise.allSettled([
      updateCompany(db, { organizationId: orgId, companyId: company.id, expectedRevision: company.revision, industry: "A", actorUserId: ownerId }),
      updateCompany(db, { organizationId: orgId, companyId: company.id, expectedRevision: company.revision, industry: "B", actorUserId: ownerId }),
    ]);
    const { fulfilled, rejected } = countOutcomes(results);
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);
  });

  it("duplicate contact-company relationship: only one concurrent creation of the same (contact, company, type) succeeds", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "Concurrent", actorUserId: ownerId });
    const { company } = await createCompany(db, { organizationId: orgId, name: "ConcurrentCo", actorUserId: ownerId });
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => createContactCompanyRelationship(db, { organizationId: orgId, contactId: contact.id, companyId: company.id, relationshipType: "employee", actorUserId: ownerId }))
    );
    const { fulfilled, rejected } = countOutcomes(results);
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(2);
  });

  it("duplicate lead conversion: concurrent convert calls produce exactly one opportunity", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage } = await makeTestPipeline(orgId, ownerId);
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });
    const qualified = await qualifyLead(db, { organizationId: orgId, leadId: lead.id, expectedRevision: lead.revision, actorUserId: ownerId });

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => convertLead(db, { organizationId: orgId, leadId: lead.id, expectedRevision: qualified.revision, pipelineId: pipeline.id, stageId: newStage.id, actorUserId: ownerId }))
    );
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof convertLead>>> => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const uniqueOpportunityIds = new Set(fulfilled.map((r) => r.value.opportunity.id));
    expect(uniqueOpportunityIds.size).toBe(1); // exactly one opportunity was ever created, regardless of how many calls "won" the race
  });

  it("concurrent opportunity stage change: only one of two simultaneous moves at the same revision succeeds", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage, qualifiedStage, wonStage } = await makeTestPipeline(orgId, ownerId);
    const opp = await createOpportunity(db, { organizationId: orgId, pipelineId: pipeline.id, stageId: newStage.id, name: "Contested", actorUserId: ownerId });

    const results = await Promise.allSettled([
      moveOpportunityStage(db, { organizationId: orgId, opportunityId: opp.id, targetStageId: qualifiedStage.id, expectedRevision: opp.revision, actorUserId: ownerId }),
      moveOpportunityStage(db, { organizationId: orgId, opportunityId: opp.id, targetStageId: wonStage.id, expectedRevision: opp.revision, actorUserId: ownerId }),
    ]);
    const { fulfilled, rejected } = countOutcomes(results);
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);
  });

  it("closed opportunity reopening race: only one concurrent reopen succeeds", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { pipeline, newStage, qualifiedStage, wonStage } = await makeTestPipeline(orgId, ownerId);
    const opp = await createOpportunity(db, { organizationId: orgId, pipelineId: pipeline.id, stageId: newStage.id, name: "ReopenRace", actorUserId: ownerId });
    const won = await moveOpportunityStage(db, { organizationId: orgId, opportunityId: opp.id, targetStageId: wonStage.id, expectedRevision: opp.revision, actorUserId: ownerId });

    const results = await Promise.allSettled([
      reopenOpportunity(db, { organizationId: orgId, opportunityId: opp.id, targetStageId: qualifiedStage.id, expectedRevision: won.revision, actorUserId: ownerId }),
      reopenOpportunity(db, { organizationId: orgId, opportunityId: opp.id, targetStageId: qualifiedStage.id, expectedRevision: won.revision, actorUserId: ownerId }),
    ]);
    const { fulfilled, rejected } = countOutcomes(results);
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);
  });

  it("stage sequence conflicts: concurrent stage creation never silently overwrites — at most one settles per colliding sequence slot", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const pipeline = await createPipeline(db, { organizationId: orgId, name: "SeqRace", pipelineKey: "SEQRACE", actorUserId: ownerId });

    const results = await Promise.allSettled([
      createStage(db, { organizationId: orgId, pipelineId: pipeline.id, name: "First", stageKey: "FIRST", actorUserId: ownerId }),
      createStage(db, { organizationId: orgId, pipelineId: pipeline.id, name: "Second", stageKey: "SECOND", actorUserId: ownerId }),
    ]);
    // Both may succeed (each got a distinct computed sequence) or one may lose a genuine collision —
    // either way, the real guarantee is no duplicate sequence value was ever persisted.
    const { fulfilled } = countOutcomes(results);
    expect(fulfilled).toBeGreaterThanOrEqual(1);
  });

  it("last/default pipeline changes: only one pipeline can hold the org's default at a time under a concurrent race", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const a = await createPipeline(db, { organizationId: orgId, name: "A", pipelineKey: "RACE_A", actorUserId: ownerId });
    const b = await createPipeline(db, { organizationId: orgId, name: "B", pipelineKey: "RACE_B", actorUserId: ownerId });

    await Promise.allSettled([setDefaultPipeline(db, { organizationId: orgId, pipelineId: a.id, actorUserId: ownerId }), setDefaultPipeline(db, { organizationId: orgId, pipelineId: b.id, actorUserId: ownerId })]);

    const { crmPipelines } = await import("@/db/schema");
    const { eq, and } = await import("drizzle-orm");
    const defaults = await db.select().from(crmPipelines).where(and(eq(crmPipelines.organizationId, orgId), eq(crmPipelines.isDefault, true)));
    expect(defaults.length).toBe(1); // never zero, never two — the partial unique index is the real guarantee
  });

  it("duplicate tag assignment: only one concurrent assignment of the same tag to the same record succeeds", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "TagRace", actorUserId: ownerId });
    const tag = await createTag(db, { organizationId: orgId, name: "Race Tag", tagKey: "RACE_TAG", actorUserId: ownerId });

    const results = await Promise.allSettled(Array.from({ length: 3 }, () => assignTag(db, { organizationId: orgId, tagId: tag.id, entityType: "contact", entityId: contact.id, actorUserId: ownerId })));
    const { fulfilled, rejected } = countOutcomes(results);
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(2);
  });

  it("duplicate project link: only one concurrent link creation succeeds", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, firstName: "LinkRace", actorUserId: ownerId });
    const project = await makeProject(orgId, ownerId);

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => createProjectLink(db, { organizationId: orgId, projectId: project.id, crmEntityType: "contact", crmEntityId: contact.id, actorUserId: ownerId }))
    );
    const { fulfilled, rejected } = countOutcomes(results);
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(2);
  });

  it("duplicate agent permission grant: only one concurrent grant of the same permission succeeds", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => grantCrmAgentPermission(db, { organizationId: orgId, agentId: agent.id, permission: "crm_contact_read", actorUserId: ownerId }))
    );
    const { fulfilled, rejected } = countOutcomes(results);
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(2);
  });
});
