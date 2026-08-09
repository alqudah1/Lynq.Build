import "server-only";
import { and, eq, count, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { communicationMessages, communicationConversations } from "@/db/schema";
import { resolveCommunicationAuthContext, requireCommunicationsViewAuthority } from "@/lib/communications-os/authz";
import { workspaceScopeCondition, GRAIN_TO_POSTGRES_MAP } from "../query-support";
import type { MetricHandler, MetricComputeContext, MetricComputeResult } from "./types";

async function requireCommunicationsAggregateAccess(ctx: MetricComputeContext): Promise<void> {
  const commsCtx = await resolveCommunicationAuthContext(ctx.db, { organizationId: ctx.organizationId, actorUserId: ctx.actorUserId });
  await requireCommunicationsViewAuthority(ctx.db, commsCtx, "communication_message", "analytics");
}

function single(value: number | null): MetricComputeResult {
  return { points: [{ value }], freshness: "live", asOf: new Date() };
}

function inRange(column: PgColumn, ctx: MetricComputeContext) {
  return sql`${column} >= ${ctx.from} AND ${column} <= ${ctx.to}`;
}

/** `communication_messages` carries no `workspaceId` of its own — its real scope is its own conversation's `workspaceId`, reached via a join. Every message-level metric below joins `communication_conversations` for this reason. */
function messagesJoinedToConversations(ctx: MetricComputeContext) {
  return { from: communicationMessages, join: [communicationConversations, eq(communicationConversations.id, communicationMessages.conversationId)] as const, workspace: workspaceScopeCondition(communicationConversations.workspaceId, ctx.workspaceId) };
}

export const communicationsMessagesSent: MetricHandler = {
  definition: {
    metricKey: "communications_messages_sent",
    name: "Messages sent",
    description: "Outbound messages with a real provider-accepted sentAt within the range — never counts a draft. Messages carry no workspace column of their own — scoped through their own conversation's real workspaceId via a join.",
    domain: "communications",
    valueType: "count",
    aggregationType: "count",
    unit: "messages",
    classification: "actual",
    supportsTimeSeries: true,
    supportedTimeGrains: ["day", "week", "month", "quarter"],
    supportedDimensions: ["channel", "provider"],
    version: 1,
    nullSemantics: "0 means nothing sent in this range — never null.",
  },
  compute: async (ctx) => {
    await requireCommunicationsAggregateAccess(ctx);
    const { join, workspace } = messagesJoinedToConversations(ctx);
    const base = and(eq(communicationMessages.organizationId, ctx.organizationId), eq(communicationMessages.direction, "outbound"), inRange(communicationMessages.sentAt, ctx), workspace);
    if (ctx.groupBy === "channel") {
      const rows = await ctx.db.select({ value: count(), dim: communicationMessages.channel }).from(communicationMessages).innerJoin(...join).where(base).groupBy(communicationMessages.channel);
      return { points: rows.map((r) => ({ value: r.value, dimensionValue: r.dim, dimensionLabel: r.dim })), freshness: "live", asOf: new Date() };
    }
    const [row] = await ctx.db.select({ value: count() }).from(communicationMessages).innerJoin(...join).where(base);
    return single(row.value);
  },
  computeSeries: async (ctx, grain) => {
    await requireCommunicationsAggregateAccess(ctx);
    const { join, workspace } = messagesJoinedToConversations(ctx);
    const bucket = sql<string>`date_trunc(${GRAIN_TO_POSTGRES_MAP[grain]}, ${communicationMessages.sentAt})`;
    const rows = await ctx.db
      .select({ bucket, value: sql<number>`count(*)::int` })
      .from(communicationMessages)
      .innerJoin(...join)
      .where(and(eq(communicationMessages.organizationId, ctx.organizationId), eq(communicationMessages.direction, "outbound"), inRange(communicationMessages.sentAt, ctx), workspace))
      .groupBy(bucket)
      .orderBy(bucket);
    return rows.map((r) => ({ bucketStart: new Date(r.bucket).toISOString(), value: r.value }));
  },
};

export const communicationsMessagesDelivered: MetricHandler = {
  definition: {
    metricKey: "communications_messages_delivered",
    name: "Messages delivered",
    description: "Messages with a REAL delivery event (deliveredAt set) within the range — requires actual provider delivery evidence, never inferred from a send. Scoped through the message's own conversation's real workspaceId via a join.",
    domain: "communications",
    valueType: "count",
    aggregationType: "count",
    unit: "messages",
    classification: "actual",
    supportsTimeSeries: true,
    supportedTimeGrains: ["day", "week", "month", "quarter"],
    supportedDimensions: ["channel"],
    version: 1,
    nullSemantics: "0 means no confirmed deliveries in this range — never null. Development providers never produce this signal (see MODULE_16_INTEGRATION_ADAPTERS.md), so this is always 0 for orgs on dev providers only.",
  },
  compute: async (ctx) => {
    await requireCommunicationsAggregateAccess(ctx);
    const { join, workspace } = messagesJoinedToConversations(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(communicationMessages)
      .innerJoin(...join)
      .where(and(eq(communicationMessages.organizationId, ctx.organizationId), eq(communicationMessages.status, "delivered"), inRange(communicationMessages.deliveredAt, ctx), workspace));
    return single(row.value);
  },
};

export const communicationsMessagesFailed: MetricHandler = {
  definition: {
    metricKey: "communications_messages_failed",
    name: "Messages failed",
    description: "Outbound messages that reached failed status, by failedAt, within the range. Scoped through the message's own conversation's real workspaceId via a join.",
    domain: "communications",
    valueType: "count",
    aggregationType: "count",
    unit: "messages",
    classification: "actual",
    supportsTimeSeries: true,
    supportedTimeGrains: ["day", "week", "month", "quarter"],
    supportedDimensions: ["channel"],
    version: 1,
    nullSemantics: "0 means no failures in this range — never null.",
  },
  compute: async (ctx) => {
    await requireCommunicationsAggregateAccess(ctx);
    const { join, workspace } = messagesJoinedToConversations(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(communicationMessages)
      .innerJoin(...join)
      .where(and(eq(communicationMessages.organizationId, ctx.organizationId), eq(communicationMessages.status, "failed"), inRange(communicationMessages.failedAt, ctx), workspace));
    return single(row.value);
  },
  drilldown: async (ctx) => {
    await requireCommunicationsAggregateAccess(ctx);
    const { join, workspace } = messagesJoinedToConversations(ctx);
    const rows = await ctx.db
      .select({ id: communicationMessages.id })
      .from(communicationMessages)
      .innerJoin(...join)
      .where(and(eq(communicationMessages.organizationId, ctx.organizationId), eq(communicationMessages.status, "failed"), inRange(communicationMessages.failedAt, ctx), workspace))
      .limit(200);
    return { entityType: "communication_message", ids: rows.map((r) => r.id), totalCount: rows.length };
  },
};

export const communicationsInboundMessages: MetricHandler = {
  definition: {
    metricKey: "communications_inbound_messages",
    name: "Inbound messages",
    description: "Real inbound messages received within the range, by receivedAt. Scoped through the message's own conversation's real workspaceId via a join.",
    domain: "communications",
    valueType: "count",
    aggregationType: "count",
    unit: "messages",
    classification: "actual",
    supportsTimeSeries: true,
    supportedTimeGrains: ["day", "week", "month", "quarter"],
    supportedDimensions: ["channel"],
    version: 1,
    nullSemantics: "0 means nothing received in this range — never null.",
  },
  compute: async (ctx) => {
    await requireCommunicationsAggregateAccess(ctx);
    const { join, workspace } = messagesJoinedToConversations(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(communicationMessages)
      .innerJoin(...join)
      .where(and(eq(communicationMessages.organizationId, ctx.organizationId), eq(communicationMessages.direction, "inbound"), inRange(communicationMessages.receivedAt, ctx), workspace));
    return single(row.value);
  },
};

export const communicationsDeliveryRate: MetricHandler = {
  definition: {
    metricKey: "communications_delivery_rate",
    name: "Delivery rate",
    description: "Of outbound messages sent in the range, the percentage that reached a confirmed delivered status. Only meaningful where the provider actually supplies delivery events. Scoped through each message's own conversation's real workspaceId via a join.",
    domain: "communications",
    valueType: "percentage",
    aggregationType: "ratio",
    unit: "%",
    classification: "derived",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: [],
    version: 1,
    nullSemantics: "null (not 0%) means nothing was sent in this range yet — a zero denominator, not a zero rate.",
  },
  compute: async (ctx) => {
    await requireCommunicationsAggregateAccess(ctx);
    const { join, workspace } = messagesJoinedToConversations(ctx);
    const [sentRow] = await ctx.db
      .select({ value: count() })
      .from(communicationMessages)
      .innerJoin(...join)
      .where(and(eq(communicationMessages.organizationId, ctx.organizationId), eq(communicationMessages.direction, "outbound"), inRange(communicationMessages.sentAt, ctx), workspace));
    if (sentRow.value === 0) return single(null);
    const [deliveredRow] = await ctx.db
      .select({ value: count() })
      .from(communicationMessages)
      .innerJoin(...join)
      .where(and(eq(communicationMessages.organizationId, ctx.organizationId), eq(communicationMessages.status, "delivered"), inRange(communicationMessages.deliveredAt, ctx), workspace));
    return single(Math.round((deliveredRow.value / sentRow.value) * 1000) / 10);
  },
};

export const communicationsConversationsActive: MetricHandler = {
  definition: {
    metricKey: "communications_conversations_active",
    name: "Active conversations",
    description: "Conversations currently in open or pending status.",
    domain: "communications",
    valueType: "count",
    aggregationType: "count",
    unit: "conversations",
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["channel"],
    version: 1,
    nullSemantics: "0 means no active conversations right now — never null.",
  },
  compute: async (ctx) => {
    await requireCommunicationsAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(communicationConversations)
      .where(and(eq(communicationConversations.organizationId, ctx.organizationId), sql`${communicationConversations.status} IN ('open','pending')`, workspaceScopeCondition(communicationConversations.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
};

export const COMMUNICATIONS_METRICS: MetricHandler[] = [
  communicationsMessagesSent,
  communicationsMessagesDelivered,
  communicationsMessagesFailed,
  communicationsInboundMessages,
  communicationsDeliveryRate,
  communicationsConversationsActive,
];
