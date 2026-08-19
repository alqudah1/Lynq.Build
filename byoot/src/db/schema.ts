/**
 * byoot/ schema. Per LYNQ_ENGINEERING_STANDARD.md Part F, this is a NEW
 * schema (not imported from platform/) — copying platform/'s auth/session/
 * audit/rate-limit *patterns* does not mean copying its organization/
 * workspace tenancy model, which BYOOT has no use for. See
 * BYOOT_TRANSFORMATION_PLAN.md Section A/C for the reasoning behind the
 * listings/listings_vow split specifically.
 *
 * No "server-only" import here, deliberately — same as platform/src/db/schema.ts.
 * drizzle-kit reads this file directly via Node, outside any Next.js server
 * boundary.
 */
import {
  pgTable,
  pgEnum,
  pgPolicy,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ---------------------------------------------------------------------------
// users / sessions / audit_logs / rate_limit_counters
//
// Copied from platform/src/db/schema.ts (Part F: "copy, don't import"), with
// one addition: `bonaFideConsumerAckAt` on `users`. Everything else here is
// the identical shape platform/'s copied auth/session/audit/rate-limit code
// expects — that's the point of copying the pattern rather than reinventing
// a different one.
//
// Deliberately NOT copied yet: `organizations`, `organization_memberships`,
// `workspaces`, `workspace_memberships`, `accounts` (OAuth provider
// linkage). BYOOT has no multi-tenant org/workspace concept in this
// scaffold, and no OAuth provider flow has been wired up yet (see
// byoot/README.md and the final report for why that's a deliberate,
// separate scope decision, not an oversight). `accounts` should be added
// back, matching platform/'s table exactly, whenever real OAuth login is
// built.
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    name: text("name"),
    /**
     * The VOW gate's entire enforcement chain (BYOOT_TRANSFORMATION_PLAN.md
     * Section C) starts here: null until a user completes the explicit
     * bona-fide-consumer acknowledgment flow. Never set by any path other
     * than that flow — see src/lib/listings/vow-gate.ts.
     */
    bonaFideConsumerAckAt: timestamp("bona_fide_consumer_ack_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_lower_unique").on(sql`lower(${t.email})`)]
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_unique").on(t.tokenHash),
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    // Text, not an enum — same reasoning as platform/'s audit_logs: the
    // event list is expected to grow, validated at the application layer
    // (see src/lib/audit.ts's AuditEventType union) rather than requiring
    // an ALTER TYPE per new event.
    eventType: text("event_type").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_actor_user_id_idx").on(t.actorUserId),
    index("audit_logs_created_at_idx").on(t.createdAt),
  ]
);

export const rateLimitCounters = pgTable("rate_limit_counters", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// listings (IDX tier) — BYOOT_TRANSFORMATION_PLAN.md Section A.
//
// Field set is the IDX-eligible subset of the full schema BYOOT_AUDIT.md
// Section B documented from the client's actual trebb-sync mapping — this
// is a fresh table, not a port, but the field names/shapes deliberately
// track that audit closely so a future real sync implementation has
// nothing to reinvent.
//
// `listOfficeName` is NOT NULL — BYOOT_DATA_CONSTRAINTS.md Section 4 names
// this exact field as captured-but-never-displayed in the client's current
// site. Making it required at the schema level means a sync that can't
// populate it fails loudly at insert time instead of silently shipping an
// attribution gap forward again.
// ---------------------------------------------------------------------------

export const propertyTypeEnum = pgEnum("property_type", [
  "Detached",
  "Semi-Detached",
  "Condo",
  "Townhome",
  "Multi-Family",
  "Land",
  "Commercial",
  "Industrial",
  "MobileTrailer",
  "Other",
]);

export const listingStatusEnum = pgEnum("listing_status", ["Active", "Pending", "Sold", "Off-Market"]);

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mlsNumber: text("mls_number").notNull(),
    title: text("title").notNull(),
    address: text("address").notNull(),
    city: text("city"),
    province: text("province").notNull().default("ON"),
    postalCode: text("postal_code"),
    price: integer("price").notNull(),
    beds: integer("beds").notNull().default(0),
    baths: integer("baths").notNull().default(0),
    propertyType: propertyTypeEnum("property_type"),
    status: listingStatusEnum("status").notNull().default("Active"),
    // Stored as-is from the feed, per BYOOT_AUDIT.md Section C's finding
    // that the client's own PublicRemarks handling never rewrites it —
    // carried forward as a deliberate constraint, not just a default.
    description: text("description"),
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lon: numeric("lon", { precision: 9, scale: 6 }),
    yearBuilt: integer("year_built"),
    lotSize: text("lot_size"),
    lotFrontage: numeric("lot_frontage", { precision: 10, scale: 2 }),
    lotDepth: numeric("lot_depth", { precision: 10, scale: 2 }),
    lotSizeUnits: text("lot_size_units"),
    parking: integer("parking"),
    garageSpaces: integer("garage_spaces"),
    basement: text("basement"),
    virtualTourUrl: text("virtual_tour_url"),
    style: text("style"),
    // IDX display-permission flags from the feed — BYOOT_AUDIT.md Section B
    // confirmed the client's current sync captures and filters on these;
    // any query surfacing `listings` publicly must respect both.
    internetEntireListingDisplay: boolean("internet_entire_listing_display").notNull().default(true),
    internetAddressDisplay: boolean("internet_address_display").notNull().default(true),
    listOfficeName: text("list_office_name").notNull(),
    community: text("community"),
    sqft: integer("sqft"),
    sqftRange: text("sqft_range"),
    taxAnnual: integer("tax_annual"),
    // Feed photo URLs, hotlinked — BYOOT_TRANSFORMATION_PLAN.md Section A's
    // caching-strategy decision: no re-hosting, so this is just the
    // MediaURL array, same as the client's current `images` column.
    images: jsonb("images").$type<string[]>().notNull().default([]),
    modificationTimestamp: timestamp("modification_timestamp", { withTimezone: true }),
    source: text("source").notNull().default("synthetic"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("listings_mls_number_unique").on(t.mlsNumber),
    index("listings_city_idx").on(t.city),
    index("listings_status_idx").on(t.status),
    index("listings_price_idx").on(t.price),
    index("listings_modification_timestamp_idx").on(t.modificationTimestamp),
  ]
);

// ---------------------------------------------------------------------------
// listings_vow (VOW tier) — the compliance-critical table.
//
// Reachable through exactly ONE application code path:
// src/lib/listings/vow-gate.ts's `getVowData()`. Nothing else in this
// codebase may import this table directly — that's an application-layer
// convention, and conventions get violated by mistake, which is the whole
// reason for the second, independent enforcement layer below.
//
// RLS (`.enableRLS()`) plus exactly one policy, scoped to a distinct
// `vow_reader` Postgres role — NOT the app's normal DATABASE_URL role, and
// NOT a session-settable GUC (which any caller sharing that same
// connection role could set themselves, making it no real barrier at all).
// The normal application role has no policy granting it access, so RLS
// enabled + zero matching policies for that role means Postgres denies the
// read outright, regardless of what application code does or forgets to
// do. Only code that explicitly obtains vow-reader credentials (i.e. only
// getVowData(), which is the one place DATABASE_URL_VOW_READER is read —
// see src/lib/env.ts) can read this table at all.
//
// See src/lib/listings/vow-gate.test.ts (application-layer gate,
// runnable now) and src/lib/listings/vow-gate.integration.test.ts (the
// genuinely adversarial "bypass the service function, query the table
// directly with the normal role, confirm it's still blocked" test — needs
// a real database, not runnable in this scaffold; see byoot/README.md).
// ---------------------------------------------------------------------------

export const listingsVow = pgTable(
  "listings_vow",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    soldPrice: integer("sold_price"),
    soldDate: timestamp("sold_date", { withTimezone: true }),
    // Append-only history of list-price changes and status transitions —
    // BYOOT_DATA_CONSTRAINTS.md Section 3 names "price history" explicitly
    // as VOW-tier, not just the final sold price.
    priceHistory: jsonb("price_history").$type<Array<{ date: string; price: number; event: string }>>().notNull().default([]),
    domHistorical: integer("dom_historical"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("listings_vow_listing_id_unique").on(t.listingId),
    pgPolicy("vow_reader_select", {
      for: "select",
      to: "vow_reader",
      using: sql`true`,
    }),
  ]
).enableRLS();
