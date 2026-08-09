import { z } from "zod";
import { resolveExecutionById } from "@/lib/agent-runtime/executions";
import { queueMessageForSend } from "@/lib/communications-os/messages";
import type { ToolImplementation } from "../implementation-types";

/**
 * communications.send — external_write. Dispatches an ALREADY-approved
 * message to the durable send queue; this tool never creates the
 * approval itself (that is `communications.create_draft` +
 * Communications OS's own `submitMessageForApproval`/human decision path
 * — a message not yet `approved` is rejected by `queueMessageForSend`
 * itself with `MessageNotApprovedError`, never silently skipped). Worker-
 * driven from there — this tool only enqueues, it does not call a
 * provider adapter itself. Idempotent: re-invoking with the same message
 * id after it is already queued/sent is a safe no-op via the message's
 * own lifecycle guard.
 */
export const communicationsSendInputSchema = z.object({ messageId: z.string().uuid() }).strict();
export type CommunicationsSendInput = z.infer<typeof communicationsSendInputSchema>;

export interface CommunicationsSendOutput {
  messageId: string;
  status: string;
}

export const communicationsSendTool: ToolImplementation<CommunicationsSendInput, CommunicationsSendOutput> = {
  toolKey: "communications.send",
  version: 1,
  inputSchema: communicationsSendInputSchema,
  execute: async (ctx, input) => {
    const execution = await resolveExecutionById(ctx.db, ctx.organizationId, ctx.executionId);
    const message = await queueMessageForSend(ctx.db, { organizationId: ctx.organizationId, messageId: input.messageId, actorUserId: execution.ownerUserId });
    return { messageId: message.id, status: message.status };
  },
};
