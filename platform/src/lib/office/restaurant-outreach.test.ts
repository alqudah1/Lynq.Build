import { describe, expect, it } from "vitest";
import { parseRestaurantOutreach, restaurantOutreachMarker } from "./restaurant-outreach";

describe("restaurant outreach evidence", () => {
  it("round-trips the provider message reference", () => {
    const input = {
      messageId: "c56455a8-df9b-4db7-a425-106846301443",
      recipient: "owner@example.com",
      previewUrl: "https://preview.example.com",
    };
    expect(parseRestaurantOutreach(`${restaurantOutreachMarker(input)}\n\nDraft`)).toEqual(input);
  });

  it("rejects malformed evidence", () => {
    expect(parseRestaurantOutreach("<!-- LYNQ_RESTAURANT_OUTREACH {} -->")).toBeNull();
  });
});
