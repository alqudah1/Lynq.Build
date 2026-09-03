import { describe, expect, it } from "vitest";
import { approvalMatchesDelivery, isSameRestaurantIdentity } from "./approvals";

const restaurant = {
  name: "Sumac & Stone",
  address: "100 King Street West",
  city: "Toronto",
  countryCode: "CA",
  website: "https://sumac.example/menu/",
};

describe("founder approval identity locks", () => {
  it("accepts harmless casing, spacing, and trailing-slash differences", () => {
    expect(isSameRestaurantIdentity(restaurant, {
      ...restaurant,
      name: "  SUMAC & STONE ",
      address: "100  King Street West",
      website: "https://sumac.example/menu",
    })).toBe(true);
  });

  it("does not treat a same-named restaurant at another address as approved", () => {
    expect(isSameRestaurantIdentity(restaurant, { ...restaurant, address: "200 Queen Street West" })).toBe(false);
  });

  it("binds demo approval to the exact reviewed commit", () => {
    expect(approvalMatchesDelivery({ commitSha: "abc123" }, "abc123")).toBe(true);
    expect(approvalMatchesDelivery({ commitSha: "old456" }, "abc123")).toBe(false);
    expect(approvalMatchesDelivery({}, "abc123")).toBe(false);
  });
});
