import { z } from "zod";
import { resolveExecutionById } from "@/lib/agent-runtime/executions";
import { createDraftMessage } from "@/lib/communications-os/messages";
import { COMMUNICATION_CHANNELS } from "@/lib/communications-os/validation";
import type { ToolImplementation } from "../implementation-types";

/**
 * communications.create_draft — internal_write. Creates a canonical DRAFT
 * only, never a sent communication. The launching human's own
 * Communications OS authority (the execution's `ownerUserId`) is what
 * gates this — the same "agent reads/writes through the launching human's
 * own authority" pattern Sales/Marketing OS's own agents already
 * establish, never a separate agent-specific bypass.
 */
export const communicationsCreateDraftInputSchema = z
  .object({
    conversationId: z.string().uuid(),
    channel: z.enum(COMMUNICATION_CHANNELS),
    recipientReference: z.string().trim().min(1).max(320),
    subject: z.string().trim().max(300).optional(),
    bodyText: z.string().trim().min(1).max(20000),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

export type CommunicationsCreateDraftInput = z.infer<typeof communicationsCreateDraftInputSchema>;

export interface CommunicationsCreateDraftOutput {
  messageId: string;
  status: string;
}

export const communicationsCreateDraftTool: ToolImplementation<CommunicationsCreateDraftInput, CommunicationsCreateDraftOutput> = {
  toolKey: "communications.create_draft",
  version: 1,
  inputSchema: communicationsCreateDraftInputSchema,
  execute: async (ctx, input) => {
    const execution = await resolveExecutionById(ctx.db, ctx.organizationId, ctx.executionId);
    const message = await createDraftMessage(ctx.db, {
      organizationId: ctx.organizationId,
      conversationId: input.conversationId,
      channel: input.channel,
      recipientReference: input.recipientReference,
      subject: input.subject,
      bodyText: input.bodyText,
      idempotencyKey: input.idempotencyKey,
      createdByAgentId: ctx.principal.agentId,
      actorUserId: execution.ownerUserId,
    });
    return { messageId: message.id, status: message.status };
  },
};
