import { beforeEach, describe, expect, it, vi } from "vitest";
import { jarvisTelegramEvents, jarvisTelegramLinks } from "@/db/schema";
import { deriveFounderPasscode } from "@/lib/voice/founder-verification";
import { TELEGRAM_LINK_SCOPE, type JarvisTelegramConfig } from "./config";
import { claimTelegramEvent, currentTelegramLinkCode, linkTelegramChat, recentEventCount, recentFailedLinkAttempts, recordEventOutcome, recordLinkRefusal } from "./link";

vi.mock("@/lib/audit", () => ({ recordAuditEvent: vi.fn(async () => undefined) }));

/**
 * Pairing is the whole security boundary of the Telegram lane: after it, a
 * chat can open projects and decide approvals. So the interesting cases are
 * the refusals — a wrong code, a stale code, a phone code replayed here,
 * and a chat that has already spent its attempts.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const FOUNDER = "22222222-2222-4222-8222-222222222222";
const CHAT = "4242";
const NOW = new Date("2026-09-04T12:00:00.000Z");

const config: JarvisTelegramConfig = {
  botToken: "1234567890:AAaaBBbbCCccDDddEEeeFFff",
  webhookSecret: "w".repeat(24),
  organizationId: ORG,
  founderUserId: FOUNDER,
  linkSecret: "s".repeat(32),
};

type State = {
  refusals: number;
  existingLink: boolean;
  insertedEvents: Record<string, unknown>[];
  insertedLinks: Record<string, unknown>[];
  conflict: boolean;
  conflictSets: Record<string, unknown>[];
  updates: Record<string, unknown>[];
};

let state: State;

function makeDb() {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === jarvisTelegramEvents) return Array.from({ length: state.refusals }, (_, index) => ({ id: `event-${index}` }));
          if (table === jarvisTelegramLinks) {
            return state.existingLink ? [{ id: "link-1", organizationId: ORG, userId: FOUNDER, telegramChatId: CHAT }] : [];
          }
          throw new Error("unexpected table");
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const sink = table === jarvisTelegramEvents ? state.insertedEvents : state.insertedLinks;
        sink.push(values);
        const returning = async () => (state.conflict && table === jarvisTelegramEvents ? [] : [{ id: "row-1", organizationId: ORG, userId: FOUNDER, telegramChatId: CHAT }]);
        return {
          returning,
          onConflictDoNothing: () => ({ returning, then: (resolve: (value: unknown) => unknown) => returning().then(resolve) }),
          onConflictDoUpdate: (options: { set: Record<string, unknown> }) => {
            state.conflictSets.push(options.set);
            return { returning, then: (resolve: (value: unknown) => unknown) => returning().then(resolve) };
          },
        };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.updates.push(values);
        return { where: async () => undefined };
      },
    }),
  } as never;
}

beforeEach(() => {
  state = { refusals: 0, existingLink: false, insertedEvents: [], insertedLinks: [], conflict: false, conflictSets: [], updates: [] };
});

describe("the pairing code", () => {
  it("is the one an authenticated session would show, and says how long it lasts", () => {
    const { code, expiresInMs } = currentTelegramLinkCode(config, NOW.getTime());
    expect(code).toBe(deriveFounderPasscode(config.linkSecret, NOW.getTime(), TELEGRAM_LINK_SCOPE));
    expect(code).toMatch(/^\d{8}$/);
    expect(expiresInMs).toBeGreaterThan(0);
  });

  it("is not the code the phone lane reads aloud", () => {
    expect(currentTelegramLinkCode(config, NOW.getTime()).code).not.toBe(deriveFounderPasscode(config.linkSecret, NOW.getTime()));
  });
});

describe("linking a chat", () => {
  const code = () => deriveFounderPasscode(config.linkSecret, NOW.getTime(), TELEGRAM_LINK_SCOPE);

  it("links on the right code, and records who it belongs to", async () => {
    const outcome = await linkTelegramChat(makeDb(), { config, chatId: CHAT, username: "mustafa", code: code(), now: NOW });
    expect(outcome).toMatchObject({ ok: true, relinked: false });
    expect(state.insertedLinks[0]).toMatchObject({ organizationId: ORG, userId: FOUNDER, telegramChatId: CHAT, telegramUsername: "mustafa" });
  });

  it("refuses a wrong code", async () => {
    const outcome = await linkTelegramChat(makeDb(), { config, chatId: CHAT, username: null, code: "00000000", now: NOW });
    expect(outcome).toEqual({ ok: false, reason: "bad_code" });
    expect(state.insertedLinks).toEqual([]);
  });

  it("refuses a code from the phone lane, replayed here", async () => {
    const phoneCode = deriveFounderPasscode(config.linkSecret, NOW.getTime());
    const outcome = await linkTelegramChat(makeDb(), { config, chatId: CHAT, username: null, code: phoneCode, now: NOW });
    expect(outcome).toEqual({ ok: false, reason: "bad_code" });
  });

  it("refuses a code that has aged out of its window", async () => {
    const stale = deriveFounderPasscode(config.linkSecret, NOW.getTime() - 30 * 60 * 1000, TELEGRAM_LINK_SCOPE);
    const outcome = await linkTelegramChat(makeDb(), { config, chatId: CHAT, username: null, code: stale, now: NOW });
    expect(outcome).toEqual({ ok: false, reason: "bad_code" });
  });

  it("accepts a code read just before it rotated", async () => {
    const previousStep = deriveFounderPasscode(config.linkSecret, NOW.getTime() - 5 * 60 * 1000, TELEGRAM_LINK_SCOPE);
    const outcome = await linkTelegramChat(makeDb(), { config, chatId: CHAT, username: null, code: previousStep, now: NOW });
    expect(outcome.ok).toBe(true);
  });

  it("stops a chat that has spent its attempts, before checking the code at all", async () => {
    state.refusals = 5;
    const outcome = await linkTelegramChat(makeDb(), { config, chatId: CHAT, username: null, code: code(), now: NOW });
    expect(outcome).toEqual({ ok: false, reason: "attempts_exhausted" });
    expect(state.insertedLinks).toEqual([]);
  });

  it("does not create a second row for a chat that is already linked", async () => {
    state.existingLink = true;
    const outcome = await linkTelegramChat(makeDb(), { config, chatId: CHAT, username: "mustafa", code: code(), now: NOW });
    expect(outcome).toMatchObject({ ok: true, relinked: true });
    expect(state.insertedLinks).toEqual([]);
  });

  it("counts only the refusals from the last hour", async () => {
    state.refusals = 3;
    expect(await recentFailedLinkAttempts(makeDb(), CHAT, NOW)).toBe(3);
  });
});

describe("handling an update exactly once", () => {
  it("claims a new update", async () => {
    expect(await claimTelegramEvent(makeDb(), { eventId: "77", organizationId: ORG, chatId: CHAT, kind: "message", outcome: "claimed", detail: null })).toBe(true);
    expect(state.insertedEvents[0]).toMatchObject({ externalEventId: "77" });
  });

  it("refuses a redelivery of one it has already handled", async () => {
    state.conflict = true;
    expect(await claimTelegramEvent(makeDb(), { eventId: "77", organizationId: ORG, chatId: CHAT, kind: "message", outcome: "claimed", detail: null })).toBe(false);
  });
});

/**
 * The claim row is written before the work, so it is written before anyone
 * knows what the update did. Everything that reads the event log afterwards
 * — the per-chat budgets above all — depends on that row being corrected.
 */
describe("saying what an update turned out to be", () => {
  it("replaces the placeholder outcome on the row that was claimed", async () => {
    await recordEventOutcome(makeDb(), { eventId: "77", outcome: "directive_created" });
    expect(state.updates).toEqual([{ outcome: "directive_created" }]);
  });

  it("writes a refused pairing onto the claimed row rather than a second one", async () => {
    // Inserting would conflict on the unique update id and record nothing,
    // and the attempt budget counts rows — so it would look enforced and be
    // enforcing nothing.
    await recordLinkRefusal(makeDb(), { eventId: "77", chatId: CHAT, reason: "bad_code" });
    expect(state.conflictSets).toEqual([{ outcome: "link_refused", detail: "bad_code" }]);
  });

  it("counts an outcome only within its window", async () => {
    state.refusals = 4;
    expect(await recentEventCount(makeDb(), { chatId: CHAT, outcome: "directive_created", now: NOW })).toBe(4);
  });
});
