import { describe, it, expect } from "vitest";
import { sniffImageDimensions, createAssetDeliveryToken, verifyAssetDeliveryToken, assetPublicUrl, safeAssetFilename, isPublicHttpsUrl, openAssetStream, type SocialAssetRow } from "./assets";
// Same bytes as test-helpers TINY_JPEG (test-helpers opens a DB connection, so it is not imported in a unit test).
const TINY_JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x03, 0x02, 0x02, 0x02, 0x02, 0x02, 0x03, 0x02, 0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x04, 0x06, 0x04, 0x04, 0x04, 0x04, 0x04, 0x08, 0x06,
  0x06, 0x05, 0x06, 0x09, 0x08, 0x0a, 0x0a, 0x09, 0x08, 0x09, 0x09, 0x0a, 0x0c, 0x0f, 0x0c, 0x0a, 0x0b, 0x0e, 0x0b, 0x09, 0x09, 0x0d, 0x11, 0x0d, 0x0e, 0x0f, 0x10, 0x10, 0x11, 0x10, 0x0a, 0x0c, 0x12, 0x13, 0x12, 0x10, 0x13, 0x0f, 0x10, 0x10, 0x10, 0xff, 0xc9, 0x00, 0x0b, 0x08, 0x00,
  0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xcc, 0x00, 0x06, 0x00, 0x10, 0x10, 0x05, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xd2, 0xcf, 0x20, 0xff, 0xd9,
]);

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, APP0 (length 16), SOF0 (length 17) with height/width, EOI.
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

const SECRET = "x".repeat(40);
const ASSET = "6f1d7a4e-2b7c-4a0e-9d55-1f2a3b4c5d6e";

describe("sniffImageDimensions", () => {
  it("reads PNG IHDR", () => {
    expect(sniffImageDimensions(png(1080, 1350))).toEqual({ width: 1080, height: 1350 });
  });
  it("reads JPEG SOF markers", () => {
    expect(sniffImageDimensions(jpeg(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(sniffImageDimensions(TINY_JPEG)).toEqual({ width: 1, height: 1 });
  });
  it("returns null for other or truncated data", () => {
    expect(sniffImageDimensions(Uint8Array.from([1, 2, 3, 4]))).toBeNull();
    expect(sniffImageDimensions(jpeg(10, 10).slice(0, 12))).toBeNull();
    expect(sniffImageDimensions(new TextEncoder().encode("%PDF-1.7 hello"))).toBeNull();
  });
});

describe("asset delivery tokens", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  it("signs and verifies for the same asset within the hour", () => {
    const token = createAssetDeliveryToken(ASSET, { secret: SECRET, now });
    expect(verifyAssetDeliveryToken(ASSET, token, { secret: SECRET, now: new Date(now.getTime() + 59 * 60_000) })).toBe(true);
  });
  it("rejects expired, tampered, other-asset and other-secret tokens", () => {
    const token = createAssetDeliveryToken(ASSET, { secret: SECRET, now });
    expect(verifyAssetDeliveryToken(ASSET, token, { secret: SECRET, now: new Date(now.getTime() + 61 * 60_000) })).toBe(false);
    expect(verifyAssetDeliveryToken("00000000-0000-4000-8000-000000000000", token, { secret: SECRET, now })).toBe(false);
    expect(verifyAssetDeliveryToken(ASSET, token, { secret: "y".repeat(40), now })).toBe(false);
    const [exp, sig] = token.split(".");
    expect(verifyAssetDeliveryToken(ASSET, `${Number(exp) + 3600}.${sig}`, { secret: SECRET, now })).toBe(false);
    expect(verifyAssetDeliveryToken(ASSET, null, { secret: SECRET, now })).toBe(false);
    expect(verifyAssetDeliveryToken(ASSET, "garbage", { secret: SECRET, now })).toBe(false);
  });
  it("builds the public URL under AUTH_BASE_URL", () => {
    const url = new URL(assetPublicUrl({ AUTH_BASE_URL: "https://app.lynq.build/", AUTH_SECRET: SECRET }, ASSET, now));
    expect(url.origin + url.pathname).toBe(`https://app.lynq.build/api/social/assets/${ASSET}`);
    expect(verifyAssetDeliveryToken(ASSET, url.searchParams.get("token"), { secret: SECRET, now })).toBe(true);
  });
});

describe("safeAssetFilename", () => {
  it("slugifies and picks an extension from the content type", () => {
    expect(safeAssetFilename("My Photo (final).PNG", "image/png")).toBe("my-photo-final.png");
    expect(safeAssetFilename(undefined, "image/jpeg")).toBe("asset.jpg");
  });
});

describe("external asset SSRF guard", () => {
  it("accepts public https hosts only", () => {
    expect(isPublicHttpsUrl("https://cdn.example.com/a.jpg")).toBe(true);
    expect(isPublicHttpsUrl("https://8.8.8.8/a.jpg")).toBe(true);
    for (const bad of ["http://cdn.example.com/a.jpg", "https://localhost/a", "https://127.0.0.1/a", "https://2130706433/a", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/a", "https://192.168.1.1/a", "https://172.20.0.1/a", "https://[::1]/a", "https://metadata.google.internal/a", "https://intranet/a", "https://user:pw@cdn.example.com/a"]) {
      expect(isPublicHttpsUrl(bad), bad).toBe(false);
    }
  });

  it("does not follow a redirect from a public URL into a private address", async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: string | URL) => {
      calls.push(String(input));
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/iam" } });
    };
    const asset = { storageKind: "external_url", url: "https://attacker.example.com/img.jpg", pathname: null, contentType: "image/jpeg", sizeBytes: 0 } as unknown as SocialAssetRow;
    expect(await openAssetStream(asset, { fetchImpl })).toBeNull();
    expect(calls).toEqual(["https://attacker.example.com/img.jpg"]);
  });
});
