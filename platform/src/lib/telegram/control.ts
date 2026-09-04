import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { organizations, projects } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { listPendingApprovalsForApprover } from "@/lib/agent-runtime/approvals";
import { decideFounderApproval } from "@/lib/founder-os/approval-center";
import { createDirectiveProject } from "@/lib/office/directive-intake";
import { autonomyFromDirective } from "@/lib/office/autonomy";
import { resolvePhoneCommandActor } from "@/lib/voice/call-store";
import { clampMessage, escapeTelegram, type TelegramTransport } from "./api";
import { linkTelegramChat, recentEventCount, recordLinkRefusal, resolveActiveLink, revokeTelegramLink, touchLink, type TelegramLink } from "./link";
import { decisionCallbackData, redactForEventLog, type NormalizedUpdate } from "./updates";
import { MAX_DIRECTIVES_PER_HOUR, type JarvisTelegramConfig } from "./config";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * What Jarvis does with a message from Telegram.
 *
 * The shape of every branch is the same: establish who is speaking, do the
 * one thing they asked for through the module that already owns it, and
 * answer in the chat. Nothing here re-implements a decision path — a
 * directive goes through `createDirectiveProject`, exactly as the browser
 * and the phone lane do, and an approval goes through
 * `decideFounderApproval`, which is Agent Runtime's own unmodified
 * approval with founder permission checks around it.
 *
 * Two rules are worth stating because they are easy to lose:
 *
 *  - **A link is not a role.** Every action re-proves that the linked user
 *    is still an owner or admin of the tenant. Revoking someone in the app
 *    revokes them here, without anyone remembering to unlink a chat.
 *  - **A tap is not consent for anything.** A low-risk approval decides on
 *    one tap; a high-risk one — the outreach that reaches a real business —
 *    asks again, in the same chat, naming what is about to happen.
 */

export type ControlResult = {
  /** What to record in the event log. */
  outcome: string;
  /** Projects whose executions were just launched, for the caller's drain. */
  launched: number;
  projectId: string | null;
};

const HELP = [
  "<b>Jarvis</b> — what you can send me here:",
  "",
  "• <b>Just type what you want done.</b> “Find a good restaurant in Little Italy and build them a demo.” I open the project and get on with it.",
  "• Add “<i>and send the email yourself</i>” and I will do the outreach too. Otherwise I stop and ask you first.",
  "• Add “<i>check with me first</i>” and I stop at every step.",
  "• /status — what I am working on and what is waiting on you.",
  "• /unlink — stop this chat from controlling Jarvis.",
].join("\n");

async function reply(transport: TelegramTransport, chatId: string, text: string, buttons?: { text: string; callbackData: string }[][]) {
  await transport
    .sendMessage({ chatId, text: clampMessage(text), buttons, disablePreview: false })
    .catch((error) => console.error("[jarvis-telegram] reply failed:", error instanceof Error ? error.message : "unknown error"));
}

/**
 * The link says who this chat acts as; this proves he may still act. A
 * founder removed from the organization loses Telegram control in the same
 * moment, without a second revocation step anybody has to remember.
 */
async function requireActor(db: Db, link: TelegramLink): Promise<{ organizationId: string; founderUserId: string; organizationSlug: string; founderName: string | null } | null> {
  try {
    // The phone lane's actor check, reused rather than reimplemented: it
    // proves live membership and an owner/admin role, which is exactly the
    // floor an Office approval already requires.
    return await resolvePhoneCommandActor(db, { organizationId: link.organizationId, founderUserId: link.userId });
  } catch {
    return null;
  }
}

function appUrl(slug: string, path: string): string {
  const base = (process.env.APP_BASE_URL || "https://lynq.build").replace(/\/$/, "");
  return `${base}/app/${encodeURIComponent(slug)}${path}`;
}

export async function handleTelegramUpdate(
  db: Db,
  input: { update: NormalizedUpdate; config: JarvisTelegramConfig; transport: TelegramTransport; now?: Date },
): Promise<ControlResult> {
  const { update, config, transport } = input;
  const now = input.now ?? new Date();
  const chatId = update.chatId;
  if (!chatId) return { outcome: "ignored_no_chat", launched: 0, projectId: null };

  if (update.callbackId) {
    await transport.answerCallback({ callbackId: update.callbackId }).catch(() => undefined);
  }

  /* --- pairing ------------------------------------------------------ */

  if (update.action.kind === "link") {
    const outcome = await linkTelegramChat(db, { config, chatId, username: update.username, code: update.action.code, now });
    if (!outcome.ok) {
      await recordLinkRefusal(db, { eventId: update.eventId, chatId, reason: outcome.reason });
      await reply(
        transport,
        chatId,
        outcome.reason === "attempts_exhausted"
          ? "Too many wrong codes from this chat. Try again in an hour."
          : "That code is not right, or it has expired. Open Jarvis in LYNQ, read the current code, and send <code>/start &lt;code&gt;</code> again.",
      );
      return { outcome: "link_refused", launched: 0, projectId: null };
    }
    await reply(transport, chatId, `${outcome.relinked ? "This chat is already linked." : "Linked."}\n\n${HELP}`);
    return { outcome: outcome.relinked ? "link_repeated" : "linked", launched: 0, projectId: null };
  }

  /* --- everything else needs a trusted chat ------------------------- */

  const link = await resolveActiveLink(db, chatId);
  // A link that points at a different tenant than this deployment is
  // configured for is not usable here. It can only happen if the
  // configuration was repointed after a chat was linked, and acting on the
  // old tenant would be acting outside what the deployment declares.
  if (link && link.organizationId !== config.organizationId) {
    await reply(transport, chatId, "This chat is linked to a different workspace than this bot now serves. Unlink it and link it again.");
    return { outcome: "link_tenant_mismatch", launched: 0, projectId: null };
  }
  if (!link) {
    await reply(
      transport,
      chatId,
      "I don't know you yet. Open Jarvis in LYNQ, read the pairing code, and send it here as <code>/start &lt;code&gt;</code>.",
    );
    return { outcome: "not_linked", launched: 0, projectId: null };
  }

  const actor = await requireActor(db, link);
  if (!actor) {
    await reply(transport, chatId, "This chat is linked, but that LYNQ account can no longer act on this workspace. Nothing was done.");
    return { outcome: "actor_unavailable", launched: 0, projectId: null };
  }
  await touchLink(db, link, now);

  switch (update.action.kind) {
    case "help":
      await reply(transport, chatId, HELP);
      return { outcome: "help", launched: 0, projectId: null };

    case "unlink":
      await revokeTelegramLink(db, { link, actorUserId: actor.founderUserId, now });
      await reply(transport, chatId, "Unlinked. This chat can no longer control Jarvis. Send a fresh pairing code to link it again.");
      return { outcome: "unlinked", launched: 0, projectId: null };

    case "status":
      await reply(transport, chatId, await renderStatus(db, actor));
      return { outcome: "status", launched: 0, projectId: null };

    case "directive": {
      // Each directive opens a project and runs models on the founder's own
      // account. The ceiling is far above ordinary use and far below a bill
      // worth noticing.
      const opened = await recentEventCount(db, { chatId, outcome: "directive_created", now });
      if (opened >= MAX_DIRECTIVES_PER_HOUR) {
        await reply(
          transport,
          chatId,
          `That is ${opened} directives in the last hour, which is as many as I'll start from one chat. Try again shortly, or use the Command Center.`,
        );
        return { outcome: "directive_rate_limited", launched: 0, projectId: null };
      }
      const policy = autonomyFromDirective(update.action.instruction);
      const result = await createDirectiveProject(db, {
        organizationId: actor.organizationId,
        instruction: update.action.instruction,
        actorUserId: actor.founderUserId,
        source: "founder_telegram",
      });
      await recordAuditEvent(db, {
        eventType: "jarvis_telegram_directive_created",
        organizationId: actor.organizationId,
        actorUserId: actor.founderUserId,
        targetType: "project",
        targetId: result.project.id,
        metadata: { projectKey: result.project.projectKey, build: policy.build, outreach: policy.outreach },
      }).catch(() => undefined);

      await reply(
        transport,
        chatId,
        [
          `<b>${escapeTelegram(result.project.name)}</b> is open.`,
          "",
          escapeTelegram(result.assistantReply),
          "",
          policy.outreach === "auto"
            ? "I'll build it and send the outreach myself, then tell you when it's done."
            : policy.build === "auto"
              ? "I'll research, build and check it myself, then come back to you before anything is sent."
              : "I'll come back to you at every step, as you asked.",
          "",
          appUrl(actor.organizationSlug, `/jarvis/${result.project.id}`),
        ].join("\n"),
      );
      return { outcome: "directive_created", launched: result.launchedCount, projectId: result.project.id };
    }

    case "decision":
      return await handleDecision(db, { update, chatId, transport, actor });

    default:
      await reply(transport, chatId, `I didn't understand that.\n\n${HELP}`);
      return { outcome: redactForEventLog(update.action), launched: 0, projectId: null };
  }
}

/* ------------------------------------------------------------------ */
/* Approvals                                                           */
/* ------------------------------------------------------------------ */

/**
 * A high-risk approval is the one that reaches a real business. One
 * mis-tap in a pocket should not send it, so those ask a second time and
 * name the consequence; everything else decides on the first tap.
 */
const NEEDS_SECOND_TAP = new Set(["high", "critical"]);

async function handleDecision(
  db: Db,
  input: {
    update: NormalizedUpdate;
    chatId: string;
    transport: TelegramTransport;
    actor: { organizationId: string; founderUserId: string; organizationSlug: string };
  },
): Promise<ControlResult> {
  const action = input.update.action;
  if (action.kind !== "decision") return { outcome: "ignored", launched: 0, projectId: null };

  const pending = await listPendingApprovalsForApprover(db, { organizationId: input.actor.organizationId, actorUserId: input.actor.founderUserId });
  const approval = pending.find((item) => item.id === action.approvalId);
  if (!approval) {
    await reply(input.transport, input.chatId, "That decision has already been made, or it expired. Nothing changed.");
    return { outcome: "decision_stale", launched: 0, projectId: null };
  }

  if (action.decision === "approve" && NEEDS_SECOND_TAP.has(approval.riskLevel) && !action.confirmed) {
    await reply(
      input.transport,
      input.chatId,
      [`<b>Confirm.</b> This one reaches someone outside LYNQ.`, "", escapeTelegram(approval.summary)].join("\n"),
      [[{ text: "Yes, do it", callbackData: decisionCallbackData({ decision: "approve", approvalId: approval.id, confirmed: true }) }], [{ text: "No", callbackData: decisionCallbackData({ decision: "reject", approvalId: approval.id, confirmed: true }) }]],
    );
    return { outcome: "decision_confirm_requested", launched: 0, projectId: null };
  }

  await decideFounderApproval(db, {
    organizationId: input.actor.organizationId,
    approvalId: approval.id,
    decision: action.decision === "approve" ? "approve" : "reject",
    decisionNote: `Decided from Telegram by the linked founder account.`,
    actorUserId: input.actor.founderUserId,
  });
  await recordAuditEvent(db, {
    eventType: "jarvis_telegram_approval_decided",
    organizationId: input.actor.organizationId,
    actorUserId: input.actor.founderUserId,
    targetType: "agent_approval_request",
    targetId: approval.id,
    metadata: { decision: action.decision, riskLevel: approval.riskLevel, channel: "telegram" },
  }).catch(() => undefined);

  await reply(
    input.transport,
    input.chatId,
    action.decision === "approve" ? "Approved. Carrying on — I'll tell you when it's done." : "Stopped. I won't take that any further.",
  );
  return { outcome: `decision_${action.decision}`, launched: 0, projectId: null };
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

async function renderStatus(db: Db, actor: { organizationId: string; founderUserId: string; organizationSlug: string }): Promise<string> {
  const [pending, active] = await Promise.all([
    listPendingApprovalsForApprover(db, { organizationId: actor.organizationId, actorUserId: actor.founderUserId }),
    db
      .select({ id: projects.id, name: projects.name, status: projects.status })
      .from(projects)
      .where(and(eq(projects.organizationId, actor.organizationId), inArray(projects.status, ["active", "planning"])))
      .orderBy(desc(projects.createdAt))
      .limit(5),
  ]);

  const lines = ["<b>Where things stand</b>", ""];
  lines.push(active.length > 0 ? "Running now:" : "Nothing is running.");
  for (const project of active) {
    lines.push(`• ${escapeTelegram(project.name)} — ${appUrl(actor.organizationSlug, `/jarvis/${project.id}`)}`);
  }
  lines.push("");
  lines.push(pending.length > 0 ? `Waiting on you (${pending.length}):` : "Nothing is waiting on you.");
  for (const approval of pending.slice(0, 5)) {
    lines.push(`• ${escapeTelegram(approval.summary.slice(0, 160))}`);
  }
  return lines.join("\n");
}

/** Used by the notifier to name the workspace in a message without a second query. */
export async function organizationSlug(db: Db, organizationId: string): Promise<string | null> {
  const [row] = await db.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, organizationId));
  return row?.slug ?? null;
}
