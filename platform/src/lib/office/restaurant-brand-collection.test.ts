import { describe, expect, it, vi } from "vitest";
import { candidate, collectedBrandPack, COLLECTED_AT } from "../../../test/support/website-fixtures";
import { collectRestaurantBrandPack } from "./restaurant-brand-collection";
import { fingerprintBrandPack } from "./website/brand-pack";

/**
 * Collection is the one place a model touches evidence, so these tests are
 * about what happens when it misbehaves or fails: the pipeline keeps
 * going, the founder is told plainly, and nothing unsourced survives.
 */

describe("collecting restaurant brand evidence", () => {
  it("normalises what the collector found and stamps the day it was collected", async () => {
    const outcome = await collectRestaurantBrandPack({
      candidate,
      now: COLLECTED_AT,
      collector: async () => collectedBrandPack,
    });

    expect(outcome.failure).toBeNull();
    expect(outcome.pack.restaurant.name).toBe("Sumac & Stone");
    expect(outcome.pack.collectedAt).toBe("2026-08-20");
    expect(outcome.pack.images).toHaveLength(3);
    expect(outcome.pack.menu).toHaveLength(2);
    expect(fingerprintBrandPack(outcome.pack)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("tells the collector which day it is, so retrieval dates are not guessed", async () => {
    const collector = vi.fn(async () => collectedBrandPack);
    await collectRestaurantBrandPack({ candidate, now: COLLECTED_AT, collector });
    expect(collector).toHaveBeenCalledWith(expect.objectContaining({ today: "2026-08-20" }));
  });

  it("keeps the prospect moving, with the gap stated, when the search provider fails", async () => {
    const outcome = await collectRestaurantBrandPack({
      candidate,
      now: COLLECTED_AT,
      collector: async () => {
        throw new Error("Gateway upstream returned 503");
      },
    });

    expect(outcome.pack.images).toEqual([]);
    expect(outcome.pack.menu).toEqual([]);
    expect(outcome.pack.hours).toEqual([]);
    expect(outcome.failure).toContain("could not finish gathering public evidence");
    expect(outcome.failure).toContain("503");
    expect(outcome.failure).toContain("no menu, images or opening hours");
  });

  it("uses none of it when the collector returns material without the sources every item needs", async () => {
    const outcome = await collectRestaurantBrandPack({
      candidate,
      now: COLLECTED_AT,
      collector: async () => ({ facts: [{ key: "contact.phone", label: "Phone", value: "+1 416 555 0142" }] }) as never,
    });

    expect(outcome.pack.facts).toEqual([]);
    expect(outcome.failure).toContain("did not include the sources every item needs");
  });

  it("drops what it cannot stand behind and records why, rather than filling gaps", async () => {
    const outcome = await collectRestaurantBrandPack({
      candidate,
      now: COLLECTED_AT,
      collector: async () => ({
        ...collectedBrandPack,
        hours: [{ day: "Sunday", hours: "Closed", provenance: { sourceUrl: "https://rumour.example.net/sumac", sourceType: "public_listing", retrievedAt: "2026-08-18", confidence: "verified", note: null } }],
      }),
    });

    expect(outcome.failure).toBeNull();
    expect(outcome.pack.hours).toEqual([]);
    expect(outcome.pack.rejected.some((item) => item.reason.includes("not one of the approved sources"))).toBe(true);
    expect(outcome.pack.uncertain.some((item) => item.label === "Sunday")).toBe(true);
  });
});
