import { describe, expect, it, vi } from "vitest";
import { brandPack, candidate, content, designProposal, packFrom, collectedBrandPack } from "../../../test/support/website-fixtures";
import { brandPackMarker, fingerprintBrandPack } from "./website/brand-pack";
import {
  awaitPreviewUrl,
  BrandPackApprovalMismatchError,
  buildApprovedRestaurantWebsite,
  demoIsBuilt,
  missingDemoParts,
  restaurantDemoPath,
  RestaurantResearchUnavailableError,
  withPreviewPath,
} from "./engineering";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "99999999-9999-4999-8999-999999999999";
const PROJECT_A = "44444444-4444-4444-8444-444444444444";
const PROJECT_B = "55555555-5555-4555-8555-555555555555";

const APPROVED_FINGERPRINT = fingerprintBrandPack(brandPack);

function contextFor(pack = brandPack): string {
  return [
    "# Prospect project",
    `<!-- LYNQ_RESTAURANT_RESEARCH ${JSON.stringify({
      searchArea: "Toronto, Canada",
      recommendation: candidate,
      alternatives: [candidate],
      uncertainty: ["Opening hours were only listed on one aggregator."],
    })} -->`,
    brandPackMarker(pack),
  ].join("\n\n");
}

const generator = async () => ({ design: designProposal, content }) as never;

describe("demo route identity", () => {
  it("scopes a demo route to the organization and project that owns it", () => {
    const route = restaurantDemoPath({ organizationId: ORG_A, projectId: PROJECT_A, projectKey: "BISTRO9-A7" });
    expect(route).toMatch(/^\/demos\/bistro9-a7-[0-9a-f]{12}$/);
    expect(restaurantDemoPath({ organizationId: ORG_A, projectId: PROJECT_A, projectKey: "BISTRO9-A7" })).toBe(route);
  });

  it("gives two organizations using the same project key different routes", () => {
    const first = restaurantDemoPath({ organizationId: ORG_A, projectId: PROJECT_A, projectKey: "SUMAC" });
    const second = restaurantDemoPath({ organizationId: ORG_B, projectId: PROJECT_B, projectKey: "SUMAC" });
    expect(first).not.toBe(second);
    expect(new Set([first, second]).size).toBe(2);
  });

  it("gives two projects in the same organization different routes", () => {
    expect(restaurantDemoPath({ organizationId: ORG_A, projectId: PROJECT_A, projectKey: "SUMAC" }))
      .not.toBe(restaurantDemoPath({ organizationId: ORG_A, projectId: PROJECT_B, projectKey: "SUMAC" }));
  });

  it("still produces a usable route when the project key contributes nothing", () => {
    expect(restaurantDemoPath({ organizationId: ORG_A, projectId: PROJECT_A, projectKey: "!!!" })).toMatch(/^\/demos\/[0-9a-f]{12}$/);
  });

  it("refuses to build a route without an owner", () => {
    expect(() => restaurantDemoPath({ organizationId: "", projectId: PROJECT_A, projectKey: "SUMAC" })).toThrow(/organization and the project/i);
    expect(() => restaurantDemoPath({ organizationId: ORG_A, projectId: "  ", projectKey: "SUMAC" })).toThrow(/organization and the project/i);
  });

  it("points a deployment preview at the generated demo", () => {
    expect(withPreviewPath("https://platform-example.vercel.app", "/demos/bistro9-a7")).toBe("https://platform-example.vercel.app/demos/bistro9-a7");
    expect(withPreviewPath("https://platform-example.vercel.app", null)).toBe("https://platform-example.vercel.app");
    expect(withPreviewPath(null, "/demos/bistro9-a7")).toBeNull();
  });
});

describe("when a demo counts as built", () => {
  const ready = { previewPath: "/demos/sumac-abc", commitSha: "abc123", previewUrl: "https://p.vercel.app/demos/sumac-abc", previewStatus: "ready" as const };

  it("is built only when the route, the commit and a working preview all exist", () => {
    expect(demoIsBuilt(ready)).toBe(true);
    expect(missingDemoParts(ready)).toEqual([]);
  });

  it.each([
    [{ ...ready, previewUrl: null, previewStatus: "pending" as const }, "a working preview link"],
    [{ ...ready, previewStatus: "unavailable" as const }, "a working preview link"],
    [{ ...ready, commitSha: "" }, "a commit on the feature branch"],
    [{ ...ready, previewPath: null }, "the public demo route"],
  ])("is not built when %o is missing something", (delivery, missing) => {
    expect(demoIsBuilt(delivery)).toBe(false);
    expect(missingDemoParts(delivery)).toContain(missing);
  });
});

describe("waiting for the preview deployment", () => {
  const base = { token: "t", repository: "owner/repo", commitSha: "abc123" };

  it("returns the preview as soon as one appears", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      previewResponse(String(url), "https://demo-preview.vercel.app"),
    );
    const sleep = vi.fn(async () => undefined);
    const result = await awaitPreviewUrl({ ...base, attempts: 5, delayMs: 1, sleep });
    expect(result).toEqual({ previewUrl: "https://demo-preview.vercel.app", status: "ready" });
    expect(sleep).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("reports a preview that never appears as pending rather than inventing one", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => previewResponse(String(url), null));
    const sleep = vi.fn(async () => undefined);
    const result = await awaitPreviewUrl({ ...base, attempts: 3, delayMs: 1, sleep });
    expect(result).toEqual({ previewUrl: null, status: "pending" });
    expect(sleep).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it("distinguishes a deployment that could not be read from one that simply has not happened", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const result = await awaitPreviewUrl({ ...base, attempts: 2, delayMs: 1, sleep: async () => undefined });
    expect(result).toEqual({ previewUrl: null, status: "unavailable" });
    fetchMock.mockRestore();
  });

  it("keeps trying after a transient failure and still reports a preview it finds", async () => {
    let call = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      call += 1;
      if (call <= 3) throw new Error("rate limited");
      return previewResponse(String(url), "https://late-preview.vercel.app");
    });
    const result = await awaitPreviewUrl({ ...base, attempts: 4, delayMs: 1, sleep: async () => undefined });
    expect(result.status).toBe("ready");
    expect(result.previewUrl).toBe("https://late-preview.vercel.app");
    fetchMock.mockRestore();
  });
});

function previewResponse(url: string, preview: string | null): Response {
  const body = url.includes("/status")
    ? { state: "success", statuses: preview ? [{ target_url: preview, context: "vercel" }] : [] }
    : url.includes("/check-runs")
      ? { check_runs: [] }
      : [];
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("building the founder-approved restaurant website", () => {
  it("refuses to build without founder-approved research recorded on the project", async () => {
    await expect(
      buildApprovedRestaurantWebsite({ projectKey: "SUMAC", route: "/demos/sumac", objective: "Build it.", sharedContext: "No research here.", approvedBrandPackFingerprint: APPROVED_FINGERPRINT, generator }),
    ).rejects.toBeInstanceOf(RestaurantResearchUnavailableError);
  });

  it("refuses to build when approved brand material will not parse, rather than quietly dropping it", async () => {
    const broken = `${contextFor()}\n\n<!-- LYNQ_APPROVED_BRAND_PACK {"schemaVersion":1,"images":[{"id":"x"}]} -->`;
    await expect(
      buildApprovedRestaurantWebsite({ projectKey: "SUMAC", route: "/demos/sumac", objective: "Build it.", sharedContext: broken, approvedBrandPackFingerprint: APPROVED_FINGERPRINT, generator }),
    ).rejects.toThrow(/brand pack .* is malformed/i);
  });

  it("builds a validated site from the approved research and the approved evidence version", async () => {
    const website = await buildApprovedRestaurantWebsite({
      projectKey: "SUMAC",
      route: "/demos/sumac-abc123def456",
      objective: "Build it.",
      sharedContext: contextFor(),
      approvedBrandPackFingerprint: APPROVED_FINGERPRINT,
      generator,
    });
    expect(website.report.ok).toBe(true);
    expect(website.routeSourceDir).toBe("platform/src/app/demos/sumac-abc123def456");
    expect(website.spec.businessName).toBe("Sumac & Stone");
    expect(website.uncertainties).toContain("Opening hours were only listed on one aggregator.");
  });

  describe("evidence changed after approval", () => {
    it("refuses to build evidence the founder has not seen", async () => {
      // One image removed: a different set of evidence, and therefore a
      // different version from the one that was approved.
      const changed = packFrom({ ...collectedBrandPack, images: collectedBrandPack.images.slice(0, 2) });
      expect(fingerprintBrandPack(changed)).not.toBe(APPROVED_FINGERPRINT);

      const error = await buildApprovedRestaurantWebsite({
        projectKey: "SUMAC",
        route: "/demos/sumac",
        objective: "Build it.",
        sharedContext: contextFor(changed),
        approvedBrandPackFingerprint: APPROVED_FINGERPRINT,
        generator,
      }).catch((thrown) => thrown);

      expect(error).toBeInstanceOf(BrandPackApprovalMismatchError);
      expect((error as Error).message).toMatch(/changed since you approved it/i);
      expect((error as BrandPackApprovalMismatchError).approvedFingerprint).toBe(APPROVED_FINGERPRINT);
      expect((error as BrandPackApprovalMismatchError).currentFingerprint).toBe(fingerprintBrandPack(changed));
    });

    it("refuses when no evidence version was approved at all", async () => {
      const error = await buildApprovedRestaurantWebsite({
        projectKey: "SUMAC",
        route: "/demos/sumac",
        objective: "Build it.",
        sharedContext: contextFor(),
        approvedBrandPackFingerprint: null,
        generator,
      }).catch((thrown) => thrown);

      expect(error).toBeInstanceOf(BrandPackApprovalMismatchError);
      expect((error as Error).message).toMatch(/no approved evidence version/i);
    });

    it("refuses when the approved evidence has been removed from the project", async () => {
      const withoutPack = contextFor().replace(/<!-- LYNQ_APPROVED_BRAND_PACK [\s\S]*? -->/, "");
      const error = await buildApprovedRestaurantWebsite({
        projectKey: "SUMAC",
        route: "/demos/sumac",
        objective: "Build it.",
        sharedContext: withoutPack,
        approvedBrandPackFingerprint: APPROVED_FINGERPRINT,
        generator,
      }).catch((thrown) => thrown);

      expect(error).toBeInstanceOf(BrandPackApprovalMismatchError);
      expect((error as Error).message).toMatch(/no longer on this project/i);
    });
  });
});
