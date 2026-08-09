import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, addOrgMember } from "./test-helpers";
import { createLead } from "@/lib/crm/leads";
import { grantAnalyticsRole, revokeAnalyticsRole } from "./roles";
import { createSavedReport, updateSavedReport } from "./reports";
import { runAnalyticsQuery } from "./query";
import { exportAnalyticsQueryToCsv } from "./export";
import { StaleAnalyticsUpdateError, AnalyticsRoleAlreadyGrantedError } from "./errors";
import { AuthzError } from "@/lib/authz/errors";

afterEach(cleanupAgentRuntimeTestData);

describe("Analytics OS concurrency guarantees", () => {
  it("concurrent saved-report updates with the same expectedRevision: exactly one wins, the loser gets a stale-update error", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const report = await createSavedReport(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, name: "Race Report", metricKeys: ["crm_contacts_total"], dateRangeStrategy: "last_30_days", comparisonEnabled: false, timeGrain: "day", visualization: "kpi_card", visibility: "private" });

    const results = await Promise.allSettled([
      updateSavedReport(db, { organizationId: orgId, actorUserId: ownerId, reportId: report.id, expectedRevision: report.revision, name: "Renamed A" }),
      updateSavedReport(db, { organizationId: orgId, actorUserId: ownerId, reportId: report.id, expectedRevision: report.revision, name: "Renamed B" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(StaleAnalyticsUpdateError);
  });

  it("concurrent saved-report creation never corrupts state — both succeed with distinct ids", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const [a, b] = await Promise.all([
      createSavedReport(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, name: "Report A", metricKeys: ["crm_contacts_total"], dateRangeStrategy: "last_30_days", comparisonEnabled: false, timeGrain: "day", visualization: "kpi_card", visibility: "private" }),
      createSavedReport(db, { organizationId: orgId, workspaceId: null, actorUserId: ownerId, name: "Report B", metricKeys: ["crm_leads_open"], dateRangeStrategy: "last_30_days", comparisonEnabled: false, timeGrain: "day", visualization: "kpi_card", visibility: "private" }),
    ]);
    expect(a.id).not.toBe(b.id);
  });

  it("permission revocation is immediate — a query issued right after revocation sees the new state, never a cached grant", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const userId = await makeUser();
    await addOrgMember(orgId, userId, "member");
    const assignment = await grantAnalyticsRole(db, { organizationId: orgId, userId, role: "viewer", actorUserId: ownerId });

    await runAnalyticsQuery(db, { organizationId: orgId, workspaceId: null, actorUserId: userId, metricKeys: ["crm_contacts_total"] });

    await revokeAnalyticsRole(db, { organizationId: orgId, roleAssignmentId: assignment.id, expectedRevision: assignment.revision, actorUserId: ownerId });

    await expect(runAnalyticsQuery(db, { organizationId: orgId, workspaceId: null, actorUserId: userId, metricKeys: ["crm_contacts_total"] })).rejects.toThrow(AuthzError);
  });

  it("granting the same user an active Analytics role twice is rejected, not silently duplicated", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const userId = await makeUser();
    await addOrgMember(orgId, userId, "member");
    await grantAnalyticsRole(db, { organizationId: orgId, userId, role: "viewer", actorUserId: ownerId });

    await expect(grantAnalyticsRole(db, { organizationId: orgId, userId, role: "analytics_manager", actorUserId: ownerId })).rejects.toThrow(AnalyticsRoleAlreadyGrantedError);
  });

  it("concurrent revocation of the same role assignment: exactly one wins", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const userId = await makeUser();
    await addOrgMember(orgId, userId, "member");
    const assignment = await grantAnalyticsRole(db, { organizationId: orgId, userId, role: "viewer", actorUserId: ownerId });

    const results = await Promise.allSettled([
      revokeAnalyticsRole(db, { organizationId: orgId, roleAssignmentId: assignment.id, expectedRevision: assignment.revision, actorUserId: ownerId }),
      revokeAnalyticsRole(db, { organizationId: orgId, roleAssignmentId: assignment.id, expectedRevision: assignment.revision, actorUserId: ownerId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(results.filter((r) => r.status === "rejected").length).toBe(1);
  });

  it("concurrent aggregate queries across two orgs stay tenant-safe under real concurrency", async () => {
    const ownerA = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const ownerB = await makeUser();
    const orgB = await makeOrgWithOwner(ownerB);

    await createLead(db, { organizationId: orgA, actorUserId: ownerA });
    await Promise.all([createLead(db, { organizationId: orgB, actorUserId: ownerB }), createLead(db, { organizationId: orgB, actorUserId: ownerB }), createLead(db, { organizationId: orgB, actorUserId: ownerB })]);

    const [resultA, resultB] = await Promise.all([
      runAnalyticsQuery(db, { organizationId: orgA, workspaceId: null, actorUserId: ownerA, metricKeys: ["crm_leads_open"], dateRangeStrategy: "year_to_date" }),
      runAnalyticsQuery(db, { organizationId: orgB, workspaceId: null, actorUserId: ownerB, metricKeys: ["crm_leads_open"], dateRangeStrategy: "year_to_date" }),
    ]);
    expect(resultA.metrics[0].current.points[0].value).toBe(1);
    expect(resultB.metrics[0].current.points[0].value).toBe(3);
  });

  it("concurrent CSV exports across two orgs never leak the other org's rows", async () => {
    const ownerA = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const ownerB = await makeUser();
    const orgB = await makeOrgWithOwner(ownerB);
    await createLead(db, { organizationId: orgA, actorUserId: ownerA });
    await createLead(db, { organizationId: orgB, actorUserId: ownerB });

    const [exportA, exportB] = await Promise.all([
      exportAnalyticsQueryToCsv(db, { organizationId: orgA, workspaceId: null, actorUserId: ownerA, metricKeys: ["crm_leads_open"], dateRangeStrategy: "year_to_date" }),
      exportAnalyticsQueryToCsv(db, { organizationId: orgB, workspaceId: null, actorUserId: ownerB, metricKeys: ["crm_leads_open"], dateRangeStrategy: "year_to_date" }),
    ]);
    expect(exportA.csv).toContain("crm_leads_open,Open leads,,1,");
    expect(exportB.csv).toContain("crm_leads_open,Open leads,,1,");
  });
});
