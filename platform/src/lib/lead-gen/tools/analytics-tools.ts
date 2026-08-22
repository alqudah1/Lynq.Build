import { z } from "zod";
import { and, eq, sql, inArray } from "drizzle-orm";
import { communicationBulkBatches, communicationBulkRecipients, communicationMessages, crmLeads } from "@/db/schema";
import { runAnalyticsQuery } from "@/lib/analytics-os/query";
import { ANALYTICS_DATE_RANGE_STRATEGIES } from "@/lib/analytics-os/validation";
import type { ToolImplementation } from "@/lib/tools/implementation-types";
import { resolveActingUserId } from "./shared";

/**
 * ============================================================================
 * Campaign analytics
 * ============================================================================
 * Two layers, deliberately kept apart:
 *
 *   - Organization-wide communications metrics come from Analytics OS's own
 *     registry, so they obey its authority model and its null semantics
 *     (a delivery rate over zero messages is null, never 0%).
 *   - Batch-level counts are read directly from the batch's own recipient
 *     and message rows, because a single campaign's funnel is not a metric
 *     in the registry and inventing one there would be a bigger change than
 *     this question deserves.
 *
 * Both report only what a provider actually confirmed. "Sent" counts
 * messages with a real provider message ID; a development-provider log line
 * is reported separately as simulated so it can never inflate a real number.
 */

const getCampaignAnalyticsInput = z
  .object({
    batchId: z.string().uuid().optional(),
    dateRangeStrategy: z.enum(ANALYTICS_DATE_RANGE_STRATEGIES).default("last_30_days"),
    includeOrganizationMetrics: z.boolean().default(true),
  })
  .strict();

export const getCampaignAnalyticsTool: ToolImplementation<z.infer<typeof getCampaignAnalyticsInput>, unknown> = {
  toolKey: "leadgen.get_campaign_analytics",
  version: 1,
  inputSchema: getCampaignAnalyticsInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);

    const organizationMetrics = input.includeOrganizationMetrics
      ? await runAnalyticsQuery(ctx.db, {
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          actorUserId,
          metricKeys: [
            "communications_messages_sent",
            "communications_messages_delivered",
            "communications_messages_failed",
            "communications_inbound_messages",
            "communications_delivery_rate",
            "communications_conversations_active",
          ],
          dateRangeStrategy: input.dateRangeStrategy,
          // An agent poll is not a human-driven query; keeping it out of the
          // audit trail is Analytics OS's own stated rule.
          recordAudit: false,
        }).then((result) =>
          result.metrics.map((metric) => ({ metricKey: metric.metricKey, value: metric.current.points[0]?.value ?? null, nullSemantics: metric.nullSemantics, asOf: metric.asOf }))
        )
      : null;

    // Demos that exist and have passed review — the top of this funnel.
    const [demoCounts] = await ctx.db
      .select({
        total: sql<number>`count(*)::int`,
        reviewed: sql<number>`count(*) filter (where demo_review is not null)::int`,
        passed: sql<number>`count(*) filter (where (demo_review ->> 'passed') = 'true')::int`,
      })
      .from(sql`crm_companies`)
      .where(sql`organization_id = ${ctx.organizationId} and idempotency_key like 'lynq-prospect-company:%'`);

    const [leadCounts] = await ctx.db
      .select({
        total: sql<number>`count(*)::int`,
        qualified: sql<number>`count(*) filter (where status = 'qualified')::int`,
        converted: sql<number>`count(*) filter (where status = 'converted')::int`,
        disqualified: sql<number>`count(*) filter (where status = 'disqualified')::int`,
      })
      .from(crmLeads)
      .where(eq(crmLeads.organizationId, ctx.organizationId));

    let batch = null;
    if (input.batchId) {
      const [batchRow] = await ctx.db
        .select()
        .from(communicationBulkBatches)
        .where(and(eq(communicationBulkBatches.id, input.batchId), eq(communicationBulkBatches.organizationId, ctx.organizationId)));

      if (batchRow) {
        const recipients = await ctx.db
          .select({ messageId: communicationBulkRecipients.messageId, status: communicationBulkRecipients.status })
          .from(communicationBulkRecipients)
          .where(and(eq(communicationBulkRecipients.organizationId, ctx.organizationId), eq(communicationBulkRecipients.batchId, batchRow.id)));

        const messageIds = recipients.map((row) => row.messageId).filter((id): id is string => Boolean(id));
        const messages = messageIds.length
          ? await ctx.db
              .select({ status: communicationMessages.status, provider: communicationMessages.provider, providerMessageId: communicationMessages.providerMessageId })
              .from(communicationMessages)
              .where(and(eq(communicationMessages.organizationId, ctx.organizationId), inArray(communicationMessages.id, messageIds)))
          : [];

        const realSends = messages.filter((m) => m.provider === "whatsapp_cloud_api" && Boolean(m.providerMessageId));
        const simulated = messages.filter((m) => m.provider === "dev_whatsapp");

        batch = {
          batchId: batchRow.id,
          name: batchRow.name,
          status: batchRow.status,
          recipientsSnapshotted: batchRow.recipientSnapshotCount,
          skippedSuppressed: recipients.filter((r) => r.status === "skipped_suppressed").length,
          skippedNoConsent: recipients.filter((r) => r.status === "skipped_no_consent").length,
          queued: recipients.filter((r) => r.status === "queued").length,
          // Only a real provider acknowledgement counts.
          sentConfirmedByProvider: realSends.length,
          delivered: messages.filter((m) => m.status === "delivered").length,
          failed: messages.filter((m) => m.status === "failed").length,
          simulatedByDevelopmentProvider: simulated.length,
        };
      }
    }

    return {
      dateRangeStrategy: input.dateRangeStrategy,
      demos: demoCounts ?? { total: 0, reviewed: 0, passed: 0 },
      leads: leadCounts ?? { total: 0, qualified: 0, converted: 0, disqualified: 0 },
      batch,
      organizationMetrics,
      note: "Sent counts include only messages a real provider acknowledged with its own message ID. Development-provider messages are reported separately and are never delivery.",
    };
  },
};
