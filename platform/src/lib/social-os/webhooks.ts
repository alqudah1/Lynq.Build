import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingChannelAccounts, communicationProviderEvents } from "@/db/schema";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { enqueueJob } from "@/lib/runtime/queue";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Module 19 — Meta webhooks (Page `feed`, Instagram `comments` / `mentions`).
 * The webhook is only a nudge: we verify the signature over the raw body,
 * dedupe each change through `communication_provider_events`, and enqueue a
 * `social_engagement_sync` job for the affected account. The sync job reads
 * the comments through the adapter with the stored credential — webhook
 * payload text is never trusted or stored as engagement content.
 */

/** Verifies `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(appSecret, rawBody)>` in constant time. */
export function verifyMetaSignature(input: { appSecret: string; rawBody: string | Uint8Array; signatureHeader: string | null | undefined }): boolean {
  if (!input.appSecret || !input.signatureHeader) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(input.signatureHeader.trim());
  if (!match) return false;
  const expected = createHmac("sha256", input.appSecret).update(typeof input.rawBody === "string" ? Buffer.from(input.rawBody, "utf8") : Buffer.from(input.rawBody)).digest();
  const actual = Buffer.from(match[1].toLowerCase(), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

interface MetaWebhookChange {
  field?: string;
  value?: Record<string, unknown>;
}

interface MetaWebhookEntry {
  id?: string | number;
  time?: number;
  changes?: MetaWebhookChange[];
}

export interface MetaWebhookResult {
  received: number;
  enqueued: number;
  duplicates: number;
  ignored: number;
}

/** Returns the platform + a stable per-item id for changes we act on; null for everything else. */
function classifyChange(object: string, change: MetaWebhookChange): { platform: "facebook" | "instagram"; itemId: string; eventType: string } | null {
  const v = change.value ?? {};
  const str = (x: unknown) => (typeof x === "string" || typeof x === "number" ? String(x) : null);
  if (object === "page" && change.field === "feed") {
    if (v.item !== "comment") return null;
    const id = str(v.comment_id) ?? str(v.post_id);
    return id ? { platform: "facebook", itemId: id, eventType: `page.feed.comment.${str(v.verb) ?? "unknown"}` } : null;
  }
  if (object === "instagram" && (change.field === "comments" || change.field === "mentions")) {
    const id = str(v.comment_id) ?? str(v.id) ?? str(v.media_id);
    return id ? { platform: "instagram", itemId: id, eventType: `instagram.${change.field}` } : null;
  }
  return null;
}

export async function handleMetaWebhookEvent(db: Db, input: { rawPayload: string | unknown }): Promise<MetaWebhookResult> {
  let payload: unknown = input.rawPayload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return { received: 0, enqueued: 0, duplicates: 0, ignored: 1 };
    }
  }
  const body = (payload && typeof payload === "object" ? payload : {}) as { object?: string; entry?: MetaWebhookEntry[] };
  const object = typeof body.object === "string" ? body.object : "";
  const entries = Array.isArray(body.entry) ? body.entry : [];
  const result: MetaWebhookResult = { received: 0, enqueued: 0, duplicates: 0, ignored: 0 };
  const enqueuedAccounts = new Set<string>();

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      result.received++;
      const classified = entry.id !== undefined ? classifyChange(object, change) : null;
      if (!classified) {
        result.ignored++;
        continue;
      }
      const externalAccountId = String(entry.id);
      const accounts = await db
        .select({ id: marketingChannelAccounts.id, organizationId: marketingChannelAccounts.organizationId, integrationConnectionId: marketingChannelAccounts.integrationConnectionId })
        .from(marketingChannelAccounts)
        .where(and(eq(marketingChannelAccounts.platform, classified.platform), eq(marketingChannelAccounts.externalAccountId, externalAccountId), eq(marketingChannelAccounts.connectionStatus, "connected"), isNull(marketingChannelAccounts.archivedAt)));
      const usable = accounts.filter((a): a is typeof a & { integrationConnectionId: string } => Boolean(a.integrationConnectionId));
      if (!usable.length) {
        result.ignored++;
        continue;
      }
      const externalEventId = `${externalAccountId}:${classified.itemId}:${entry.time ?? 0}`;
      for (const account of usable) {
        try {
          await db.insert(communicationProviderEvents).values({
            organizationId: account.organizationId,
            connectionId: account.integrationConnectionId,
            provider: "meta",
            externalEventId,
            eventType: classified.eventType,
            processingStatus: "processed",
            normalizedEntityType: "marketing_channel_account",
            normalizedEntityId: account.id,
          });
        } catch (err) {
          if (isPostgresUniqueViolation(err)) {
            result.duplicates++;
            continue;
          }
          throw err;
        }
        if (!enqueuedAccounts.has(account.id)) {
          await enqueueJob(db, { organizationId: account.organizationId, jobType: "social_engagement_sync", idempotencyKey: `social_engagement_sync:${account.id}` });
          enqueuedAccounts.add(account.id);
          result.enqueued++;
        }
      }
    }
  }
  return result;
}
