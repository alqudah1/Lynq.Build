import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, addOrgMember, cleanupAgentRuntimeTestData, makeSalesRepUser } from "./test-helpers";
import { createLead } from "@/lib/crm/leads";
import { assignLead } from "./lead-assignment";
import { grantSalesRole, revokeSalesRole } from "./roles";
import { getSalesConfiguration, upsertSalesConfiguration } from "./configuration";
import { InsufficientRoleError, TenantResourceNotFoundError } from "@/lib/authz/errors";
import { IneligibleAssigneeError, SalesRoleAlreadyGrantedError } from "./errors";

afterEach(cleanupAgentRuntimeTestData);

describe("Sales OS authorization — independence from CRM, tenant safety", () => {
  it("a Sales OS admin who is only an ordinary org member still cannot assign a lead — CRM's own manage authority is enforced independently of any Sales OS capability", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });

    const memberId = await makeUser();
    await addOrgMember(orgId, memberId, "member");
    await grantSalesRole(db, { organizationId: orgId, userId: memberId, role: "sales_admin", actorUserId: ownerId });

    const assigneeId = await makeSalesRepUser(orgId, "sales_rep", ownerId);

    await expect(assignLead(db, { organizationId: orgId, leadId: lead.id, assigneeUserId: assigneeId, actorUserId: memberId })).rejects.toThrow(InsufficientRoleError);
  });

  it("an ordinary member with no Sales OS role cannot self-grant one", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const memberId = await makeUser();
    await addOrgMember(orgId, memberId, "member");

    await expect(grantSalesRole(db, { organizationId: orgId, userId: memberId, role: "sales_admin", actorUserId: memberId })).rejects.toThrow(InsufficientRoleError);
  });

  it("a user whose Sales OS role was revoked is no longer an eligible lead assignee", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });

    const repId = await makeUser();
    await addOrgMember(orgId, repId, "member");
    const grant = await grantSalesRole(db, { organizationId: orgId, userId: repId, role: "sales_rep", actorUserId: ownerId });
    await revokeSalesRole(db, { organizationId: orgId, roleAssignmentId: grant.id, expectedRevision: grant.revision, actorUserId: ownerId });

    await expect(assignLead(db, { organizationId: orgId, leadId: lead.id, assigneeUserId: repId, actorUserId: ownerId })).rejects.toThrow(IneligibleAssigneeError);
  });

  it("granting the same role twice while still active is rejected, not silently duplicated", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const repId = await makeUser();
    await addOrgMember(orgId, repId, "member");
    await grantSalesRole(db, { organizationId: orgId, userId: repId, role: "sales_rep", actorUserId: ownerId });

    await expect(grantSalesRole(db, { organizationId: orgId, userId: repId, role: "sales_manager", actorUserId: ownerId })).rejects.toThrow(SalesRoleAlreadyGrantedError);
  });

  it("a lead from another organization is not reachable — indistinguishable from not existing", async () => {
    const ownerAId = await makeUser();
    const orgAId = await makeOrgWithOwner(ownerAId);
    const lead = await createLead(db, { organizationId: orgAId, actorUserId: ownerAId });

    const ownerBId = await makeUser();
    const orgBId = await makeOrgWithOwner(ownerBId);
    const repInB = await makeSalesRepUser(orgBId, "sales_rep", ownerBId);

    await expect(assignLead(db, { organizationId: orgBId, leadId: lead.id, assigneeUserId: repInB, actorUserId: ownerBId })).rejects.toThrow(TenantResourceNotFoundError);
  });

  it("sales configuration is scoped independently per organization — a config saved in one organization never appears in another", async () => {
    const ownerAId = await makeUser();
    const orgAId = await makeOrgWithOwner(ownerAId);
    await upsertSalesConfiguration(db, { organizationId: orgAId, workspaceId: null, actorUserId: ownerAId, currency: "EUR" });

    const ownerBId = await makeUser();
    const orgBId = await makeOrgWithOwner(ownerBId);
    const configB = await getSalesConfiguration(db, { organizationId: orgBId, workspaceId: null, actorUserId: ownerBId });

    expect(configB).toBeNull();
  });
});
