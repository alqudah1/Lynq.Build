import { describe, it, expect } from "vitest";
import { requireOrganizationRole, requireWorkspaceRole, requireTenantScopedResource } from "./helpers";
import { InsufficientRoleError, TenantResourceNotFoundError } from "./errors";
import type { OrganizationMembershipRecord, WorkspaceMembershipRecord } from "./helpers";

function orgMembership(role: OrganizationMembershipRecord["role"]): OrganizationMembershipRecord {
  return { organizationId: "org-1", userId: "user-1", role };
}
function workspaceMembership(role: WorkspaceMembershipRecord["role"]): WorkspaceMembershipRecord {
  return { workspaceId: "ws-1", organizationId: "org-1", userId: "user-1", role };
}

describe("requireOrganizationRole", () => {
  it("passes silently when the membership's role is in the allowed list", () => {
    expect(() => requireOrganizationRole(orgMembership("owner"), ["owner", "admin"])).not.toThrow();
  });

  it("throws InsufficientRoleError when the role is not in the allowed list", () => {
    expect(() => requireOrganizationRole(orgMembership("member"), ["owner", "admin"])).toThrow(InsufficientRoleError);
  });

  it("rejects a viewer for any mutating allow-list", () => {
    expect(() => requireOrganizationRole(orgMembership("viewer"), ["owner", "admin", "member"])).toThrow(
      InsufficientRoleError
    );
  });
});

describe("requireWorkspaceRole", () => {
  it("passes silently when the membership's role is in the allowed list", () => {
    expect(() => requireWorkspaceRole(workspaceMembership("manager"), ["manager"])).not.toThrow();
  });

  it("throws InsufficientRoleError when the role is not in the allowed list", () => {
    expect(() => requireWorkspaceRole(workspaceMembership("viewer"), ["manager", "member"])).toThrow(
      InsufficientRoleError
    );
  });
});

describe("requireTenantScopedResource", () => {
  it("returns the row when the (already tenant-scoped) query finds one", async () => {
    const result = await requireTenantScopedResource(async () => ({ id: "resource-1" }));
    expect(result).toEqual({ id: "resource-1" });
  });

  it("throws TenantResourceNotFoundError when the query finds nothing — never leaks whether that's because it doesn't exist or belongs to another tenant", async () => {
    await expect(requireTenantScopedResource(async () => undefined)).rejects.toThrow(TenantResourceNotFoundError);
    await expect(requireTenantScopedResource(async () => null)).rejects.toThrow(TenantResourceNotFoundError);
  });
});
