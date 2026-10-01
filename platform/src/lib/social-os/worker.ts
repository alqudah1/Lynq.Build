import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { RuntimeJob } from "@/lib/runtime/queue";
import type { JobFailureClass } from "@/lib/runtime/validation";
import { SocialProviderError, SocialProviderNotConfiguredError, SocialProviderNotSupportedError, SocialVariantNotPublishableError, SocialAccountNotConnectedError, SocialCredentialMissingError, SocialGenerationFailedError, SocialGenerationLimitError, SocialAdChangeNotExecutableError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Module 19 — the Social Command Center's job dispatcher, called by the
 * runtime worker (`src/lib/runtime/worker.ts`) for every `social_*` job
 * type. Each handler is resumable and idempotent by construction: the
 * job's `idempotencyKey` names exactly one domain record, and the handler
 * re-reads that record's live state before doing anything a provider
 * would see twice.
 *
 * Job payload convention (runtime_jobs has no payload column — same as
 * `communication_send`): `<jobType>:<recordId>[:<suffix>]`.
 */
export async function processSocialJob(db: Db, job: RuntimeJob): Promise<Record<string, unknown>> {
  if (!job.organizationId) throw new Error(`${job.jobType} job is missing organizationId`);
  const recordId = parseSocialJobRecordId(job.idempotencyKey);
  if (!recordId) throw new Error(`${job.jobType} job has an unparseable idempotency key: ${job.idempotencyKey}`);

  switch (job.jobType) {
    case "social_publish": {
      const { processPublishJob } = await import("./publishing");
      return processPublishJob(db, { organizationId: job.organizationId, publishJobId: recordId });
    }
    case "social_metrics_sync": {
      const { syncAccountMetrics } = await import("./analytics-sync");
      return syncAccountMetrics(db, { organizationId: job.organizationId, channelAccountId: recordId });
    }
    case "social_engagement_sync": {
      const { syncAccountEngagement } = await import("./engagement");
      return syncAccountEngagement(db, { organizationId: job.organizationId, channelAccountId: recordId });
    }
    case "social_token_watch": {
      const { watchConnectionTokens } = await import("./connections");
      return watchConnectionTokens(db, { organizationId: job.organizationId });
    }
    case "social_automation_run": {
      const { runAutomationRule } = await import("./automation");
      return runAutomationRule(db, { organizationId: job.organizationId, ruleId: recordId, runtimeJobId: job.id });
    }
    case "social_ad_change_execute": {
      const { executeAdChangeRequest } = await import("./advertising");
      return executeAdChangeRequest(db, { organizationId: job.organizationId, changeRequestId: recordId });
    }
    case "social_generation_run": {
      const { runGenerationJob } = await import("./generation");
      return runGenerationJob(db, { organizationId: job.organizationId, generationId: recordId });
    }
    default:
      throw new Error(`processSocialJob received a non-social job type: ${job.jobType}`);
  }
}

/** `social_publish:<uuid>[:n]` → `<uuid>`; `social_token_watch:<orgId>` → `<orgId>`. */
export function parseSocialJobRecordId(idempotencyKey: string): string | null {
  const parts = idempotencyKey.split(":");
  if (parts.length < 2) return null;
  const id = parts[1];
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

/**
 * Maps social-domain errors onto the queue's failure taxonomy. Only a
 * provider error flagged `retryable` schedules a retry; everything else is
 * final (a lost authorization, a non-publishable post, a missing config)
 * and surfaces to a human instead of being hammered against the provider.
 */
export function classifySocialJobError(err: unknown): { failureClass: JobFailureClass; errorCode: string; requiresHumanReview: boolean } | null {
  if (err instanceof SocialProviderError) {
    if (err.authorizationLost) return { failureClass: "permission_revoked", errorCode: err.code, requiresHumanReview: true };
    return err.retryable ? { failureClass: "transient", errorCode: err.code, requiresHumanReview: false } : { failureClass: "permanent", errorCode: err.code, requiresHumanReview: true };
  }
  if (err instanceof SocialGenerationFailedError) return err.retryable ? { failureClass: "transient", errorCode: "generation_failed", requiresHumanReview: false } : { failureClass: "permanent", errorCode: "generation_failed", requiresHumanReview: false };
  if (err instanceof SocialGenerationLimitError) return { failureClass: "permanent", errorCode: "generation_limit", requiresHumanReview: true };
  if (err instanceof SocialProviderNotConfiguredError) return { failureClass: "permanent", errorCode: "provider_not_configured", requiresHumanReview: true };
  if (err instanceof SocialProviderNotSupportedError) return { failureClass: "permanent", errorCode: "provider_not_supported", requiresHumanReview: true };
  if (err instanceof SocialVariantNotPublishableError) return { failureClass: "permanent", errorCode: "variant_not_publishable", requiresHumanReview: true };
  if (err instanceof SocialAccountNotConnectedError) return { failureClass: "permission_revoked", errorCode: "account_not_connected", requiresHumanReview: true };
  if (err instanceof SocialCredentialMissingError) return { failureClass: "permission_revoked", errorCode: "credential_missing", requiresHumanReview: true };
  if (err instanceof SocialAdChangeNotExecutableError) return { failureClass: "permanent", errorCode: "ad_change_not_executable", requiresHumanReview: true };
  return null;
}
