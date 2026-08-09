import { z } from "zod";
import { and, eq, isNotNull } from "drizzle-orm";
import { toolInvocations } from "@/db/schema";
import { createArtifact } from "@/lib/agent-runtime/artifacts";
import type { ToolImplementation } from "../implementation-types";

/**
 * artifact.create_report — internal-write. Creates a Runtime artifact
 * (Brain Module 7's existing `agent_artifacts`/`createArtifact`, reused
 * directly — never a second artifact table). The artifact's content is a
 * bounded JSON document; `createArtifact` itself enforces the
 * 20,000-character ceiling already established there. Never automatically
 * promoted into the Brain — that stays an explicit, separate, human-gated
 * decision (§13), unaffected by this tool.
 */
const citationSchema = z.object({
  knowledgeItemId: z.string().uuid(),
  versionNumber: z.number().int().min(1),
  title: z.string().max(300),
  domain: z.string(),
  sourceType: z.string().nullable(),
  trustTier: z.string().nullable(),
  retrievedAt: z.string(),
});

export const artifactCreateReportInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(2000),
    keyFindings: z.array(z.string().trim().min(1).max(1000)).max(50),
    supportingReferences: z.array(citationSchema).max(50),
    contradictions: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
    missingInformation: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  })
  .strict();

export type ArtifactCreateReportInput = z.infer<typeof artifactCreateReportInputSchema>;

export interface ArtifactCreateReportOutput {
  artifactId: string;
  reusedFromPriorAttempt: boolean;
}

export const artifactCreateReportTool: ToolImplementation<ArtifactCreateReportInput, ArtifactCreateReportOutput> = {
  toolKey: "artifact.create_report",
  version: 1,
  inputSchema: artifactCreateReportInputSchema,
  execute: async (ctx, input) => {
    // §8/§12 "a confirmed side effect must not be repeated after recovery":
    // if an EARLIER attempt under this exact idempotency key already
    // produced an artifact (the invocation crashed between creating it and
    // being marked succeeded), reuse that artifact rather than creating a
    // second one.
    const [priorAttempt] = await ctx.db
      .select({ artifactId: toolInvocations.artifactId })
      .from(toolInvocations)
      .where(
        and(
          eq(toolInvocations.organizationId, ctx.organizationId),
          eq(toolInvocations.executionId, ctx.executionId),
          eq(toolInvocations.toolKey, "artifact.create_report"),
          eq(toolInvocations.idempotencyKey, ctx.idempotencyKey),
          isNotNull(toolInvocations.artifactId)
        )
      )
      .limit(1);

    if (priorAttempt?.artifactId) {
      return { artifactId: priorAttempt.artifactId, reusedFromPriorAttempt: true };
    }

    const generatedAt = new Date().toISOString();
    const content = JSON.stringify({
      title: input.title,
      summary: input.summary,
      keyFindings: input.keyFindings,
      supportingReferences: input.supportingReferences,
      contradictions: input.contradictions,
      missingInformation: input.missingInformation,
      generatedAt,
      agentId: ctx.principal.agentId,
    });

    const artifact = await createArtifact(ctx.db, {
      organizationId: ctx.organizationId,
      executionId: ctx.executionId,
      artifactType: "report",
      title: input.title,
      content,
      actorAgentId: ctx.principal.agentId,
    });

    return { artifactId: artifact.id, reusedFromPriorAttempt: false };
  },
};
