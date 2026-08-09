import { describe, it, expect } from "vitest";
import { toOrganizationSwitcherItems, toWorkspaceSwitcherItems } from "./view-models";

describe("toOrganizationSwitcherItems", () => {
  it("maps only slug/name/role — never id, deletedAt, or timestamps (client-safe boundary)", () => {
    const input = [
      { id: "org-1", slug: "acme", name: "Acme", role: "owner", deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
    ];

    const result = toOrganizationSwitcherItems(input);

    expect(result).toEqual([{ slug: "acme", name: "Acme", role: "owner" }]);
    expect(Object.keys(result[0]).sort()).toEqual(["name", "role", "slug"]);
  });
});

describe("toWorkspaceSwitcherItems", () => {
  it("maps only slug/name/role — never id, organizationId, or timestamps (client-safe boundary)", () => {
    const input = [
      {
        id: "ws-1",
        organizationId: "org-1",
        slug: "marketing",
        name: "Marketing",
        role: "manager",
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = toWorkspaceSwitcherItems(input);

    expect(result).toEqual([{ slug: "marketing", name: "Marketing", role: "manager" }]);
    expect(Object.keys(result[0]).sort()).toEqual(["name", "role", "slug"]);
  });
});
