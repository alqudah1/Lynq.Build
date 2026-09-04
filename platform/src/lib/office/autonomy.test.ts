import { describe, expect, it } from "vitest";
import {
  autoDecisionMarker,
  autonomyFromDirective,
  autonomyMarker,
  DEFAULT_AUTONOMY,
  incompleteOutcomeMarker,
  isPermanentGap,
  parseAutoDecisions,
  parseAutonomy,
  parseIncompleteOutcomes,
} from "./autonomy";

/**
 * Autonomy is the difference between an assistant that waits for Mustafa
 * and one that gets the work done while he is at his shift, so what the
 * policy says — and where it comes from — has to be exact.
 */

describe("reading the policy out of the directive", () => {
  it("builds on its own and asks before contacting anyone, by default", () => {
    const policy = autonomyFromDirective("Find a good restaurant in Toronto and build them a demo site.");
    expect(policy).toEqual(DEFAULT_AUTONOMY);
    expect(policy.build).toBe("auto");
    expect(policy.outreach).toBe("ask");
  });

  it.each([
    "Find a restaurant, build the demo and send the email yourself.",
    "Do the whole thing, don't ask me.",
    "Run it end-to-end and tell me when it's done.",
    "Handle everything for me this week.",
    "Give it full autonomy.",
    "Reach out to them directly once the demo is ready.",
  ])("hands outreach over when the founder says: %s", (instruction) => {
    const policy = autonomyFromDirective(instruction);
    expect(policy.build).toBe("auto");
    expect(policy.outreach).toBe("auto");
    expect(policy.reason).toContain("end to end");
  });

  it.each([
    "Find a restaurant but ask me first.",
    "Check with me before you build anything.",
    "Let me approve it before you start.",
    "Show me first.",
  ])("keeps every gate when the founder says: %s", (instruction) => {
    expect(autonomyFromDirective(instruction)).toMatchObject({ build: "ask", outreach: "ask" });
  });

  it("does not read a request to be consulted as permission to send email", () => {
    // Both phrasings present: being asked to check in wins, because the
    // cost of over-reading autonomy is a stranger receiving an email.
    const policy = autonomyFromDirective("Run it end-to-end, but check with me first before you build anything.");
    expect(policy).toMatchObject({ build: "ask", outreach: "ask" });
  });

  it("survives a directive in Arabic", () => {
    expect(autonomyFromDirective("دور على مطعم وابدأ، لا تسألني").outreach).toBe("auto");
  });
});

describe("carrying the policy on the project", () => {
  it("round-trips through the project description", () => {
    const policy = autonomyFromDirective("Do the whole thing, don't ask me.");
    expect(parseAutonomy(`Founder directive\n\nsomething\n\n${autonomyMarker(policy)}`)).toEqual(policy);
  });

  it("falls back to the default for a project created before autonomy existed", () => {
    expect(parseAutonomy(null)).toEqual(DEFAULT_AUTONOMY);
    expect(parseAutonomy("Founder directive\n\nno marker here")).toEqual(DEFAULT_AUTONOMY);
    expect(parseAutonomy("<!-- LYNQ_OFFICE_AUTONOMY {broken} -->")).toEqual(DEFAULT_AUTONOMY);
    expect(parseAutonomy('<!-- LYNQ_OFFICE_AUTONOMY {"build":"maybe"} -->')).toEqual(DEFAULT_AUTONOMY);
  });
});

describe("decisions Jarvis took by itself", () => {
  const decision = {
    action: "restaurant_prospect_selection",
    decidedAt: "2026-08-20T10:00:00.000Z",
    policyReason: "You told Jarvis to run this end to end.",
    summary: "Went ahead with Sumac & Stone.",
    restaurantName: "Sumac & Stone",
    brandPackFingerprint: "abc123",
    commitSha: null,
  };

  it("records the same binding an approval would have carried", () => {
    const [parsed] = parseAutoDecisions(`notes\n\n${autoDecisionMarker(decision)}\n\nmore notes`);
    expect(parsed).toEqual(decision);
  });

  it("returns every decision on the project, not just the last", () => {
    const content = [
      autoDecisionMarker(decision),
      autoDecisionMarker({ ...decision, action: "office_demo_approval", commitSha: "sha999", brandPackFingerprint: null }),
    ].join("\n\nsome prose in between\n\n");
    const parsed = parseAutoDecisions(content);
    expect(parsed.map((item) => item.action)).toEqual(["restaurant_prospect_selection", "office_demo_approval"]);
    expect(parsed[1]?.commitSha).toBe("sha999");
  });

  it("ignores a damaged record rather than inventing one", () => {
    expect(parseAutoDecisions("<!-- LYNQ_OFFICE_AUTO_DECISION {not json} -->")).toEqual([]);
    expect(parseAutoDecisions(null)).toEqual([]);
  });
});

describe("work that could not be finished", () => {
  it("round-trips every recorded gap", () => {
    const outcome = { stage: "outreach", headline: "No public email", detail: "Nothing to send to.", recordedAt: "2026-08-20T10:00:00.000Z" };
    expect(parseIncompleteOutcomes(`a\n\n${incompleteOutcomeMarker(outcome)}\n\nb`)).toEqual([outcome]);
  });
});

describe("deciding whether to retry or report", () => {
  it.each([
    "Outreach is waiting for a verified public business email for the approved restaurant",
    "The generated website did not pass validation after 3 attempt(s)",
    "The approved brand pack on this project is malformed",
    "This prospect has no approved evidence version recorded",
    "The route /demos/x already belongs to project OTHER",
  ])("reports rather than retries: %s", (message) => {
    expect(isPermanentGap(new Error(message))).toBe(true);
  });

  it.each([
    "Quality Assurance is waiting for the preview link.",
    "GitHub request failed (502)",
    "The website generation provider failed after 3 attempt(s): 503",
    "ECONNRESET",
  ])("leaves to the retry policy: %s", (message) => {
    expect(isPermanentGap(new Error(message))).toBe(false);
  });
});
