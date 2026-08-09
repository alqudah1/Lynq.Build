import { z } from "zod";
import { resolveExecutionById } from "@/lib/agent-runtime/executions";
import { getMessageForUser } from "@/lib/communications-os/messages";
import type { ToolImplementation } from "../implementation-types";

/** communications.get_status — read_only. Live status, never cached. */
export const communicationsGetStatusInputSchema = z.object({ messageId: z.string().uuid() }).strict();
export type CommunicationsGetStatusInput = z.infer<typeof communicationsGetStatusInputSchema>;

export interface CommunicationsGetStatusOutput {
  messageId: string;
  status: string;
  providerMessageId: string | null;
  failureClass: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
}

export const communicationsGetStatusTool: ToolImplementation<CommunicationsGetStatusInput, CommunicationsGetStatusOutput> = {
  toolKey: "communications.get_status",
  version: 1,
  inputSchema: communicationsGetStatusInputSchema,
  execute: async (ctx, input) => {
    const execution = await resolveExecutionById(ctx.db, ctx.organizationId, ctx.executionId);
    const message = await getMessageForUser(ctx.db, { organizationId: ctx.organizationId, messageId: input.messageId, actorUserId: execution.ownerUserId });
    return {
      messageId: message.id,
      status: message.status,
      providerMessageId: message.providerMessageId,
      failureClass: message.failureClass,
      sentAt: message.sentAt ? message.sentAt.toISOString() : null,
      deliveredAt: message.deliveredAt ? message.deliveredAt.toISOString() : null,
    };
  },
};
