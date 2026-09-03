import { describe, expect, it } from "vitest";
import { approvalMatchesBrandPack, approvalMatchesDelivery, isSameRestaurantIdentity } from "./approvals";

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

describe("evidence version locks", () => {
  it("binds a prospect approval to the exact evidence version reviewed", () => {
    expect(approvalMatchesBrandPack({ brandPackFingerprint: "abc123" }, "abc123")).toBe(true);
    expect(approvalMatchesBrandPack({ brandPackFingerprint: "older0" }, "abc123")).toBe(false);
  });

  it("treats an approval with no recorded evidence version as covering nothing", () => {
    expect(approvalMatchesBrandPack({}, "abc123")).toBe(false);
    expect(approvalMatchesBrandPack({ brandPackFingerprint: null }, "abc123")).toBe(false);
    expect(approvalMatchesBrandPack(null, "abc123")).toBe(false);
    expect(approvalMatchesBrandPack("abc123", "abc123")).toBe(false);
    expect(approvalMatchesBrandPack([{ brandPackFingerprint: "abc123" }], "abc123")).toBe(false);
  });
});
