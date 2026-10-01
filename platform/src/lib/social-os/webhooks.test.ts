import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/lib/runtime/queue", () => ({ enqueueJob: vi.fn() }));
vi.mock("@/db/schema", () => ({ marketingChannelAccounts: {}, communicationProviderEvents: {} }));

import { verifyMetaSignature, handleMetaWebhookEvent } from "./webhooks";

const SECRET = "meta-app-secret";
const body = JSON.stringify({ object: "page", entry: [{ id: "111", time: 1, changes: [{ field: "feed", value: { item: "comment", comment_id: "c1", verb: "add" } }] }] });
const sign = (raw: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

describe("verifyMetaSignature", () => {
  it("accepts a valid X-Hub-Signature-256", () => {
    expect(verifyMetaSignature({ appSecret: SECRET, rawBody: body, signatureHeader: sign(body) })).toBe(true);
    expect(verifyMetaSignature({ appSecret: SECRET, rawBody: new TextEncoder().encode(body), signatureHeader: sign(body).toUpperCase().replace("SHA256=", "sha256=") })).toBe(true);
  });

  it("rejects a wrong secret, a modified body, a missing or malformed header", () => {
    expect(verifyMetaSignature({ appSecret: SECRET, rawBody: body, signatureHeader: sign(body, "other") })).toBe(false);
    expect(verifyMetaSignature({ appSecret: SECRET, rawBody: `${body} `, signatureHeader: sign(body) })).toBe(false);
    expect(verifyMetaSignature({ appSecret: SECRET, rawBody: body, signatureHeader: null })).toBe(false);
    expect(verifyMetaSignature({ appSecret: SECRET, rawBody: body, signatureHeader: "sha1=abc" })).toBe(false);
    expect(verifyMetaSignature({ appSecret: "", rawBody: body, signatureHeader: sign(body, "") })).toBe(false);
  });
});

describe("handleMetaWebhookEvent (no DB paths)", () => {
  it("ignores unparseable payloads and changes we do not act on", async () => {
    const db = { select: vi.fn() } as never;
    expect(await handleMetaWebhookEvent(db, { rawPayload: "not json" })).toEqual({ received: 0, enqueued: 0, duplicates: 0, ignored: 1 });
    const reactions = { object: "page", entry: [{ id: "111", time: 1, changes: [{ field: "feed", value: { item: "reaction" } }, { field: "ratings", value: {} }] }] };
    expect(await handleMetaWebhookEvent(db, { rawPayload: reactions })).toEqual({ received: 2, enqueued: 0, duplicates: 0, ignored: 2 });
  });
});
