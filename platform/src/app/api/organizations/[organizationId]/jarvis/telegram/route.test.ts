import { beforeEach, describe, expect, it, vi } from "vitest";
import { jarvisTelegramLinks } from "@/db/schema";

/**
 * The pairing code is the second factor for the whole Telegram lane, so
 * this route is held to the same floor as the phone lane's passcode:
 * whoever can mint the code holds the credential, and the configuration
 * names exactly one person.
 *
 * Revocation is the deliberate exception. The case that matters is the
 * founder's phone in someone else's hand, and refusing to cut a chat off
 * because the admin at the keyboard is not the configured founder — or
 * because the lane has since been switched off — would be failing closed
 * in the direction that keeps the attacker in.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const FOUNDER = "22222222-2222-4222-8222-222222222222";
const OTHER_ADMIN = "33333333-3333-4333-8333-333333333333";

const getAuthenticatedUser = vi.hoisted(() => vi.fn());
const requireOrganizationAdminOverride = vi.hoisted(() => vi.fn());
const resolveTelegramConfig = vi.hoisted(() => vi.fn());
const revokeTelegramLink = vi.hoisted(() => vi.fn());
const currentTelegramLinkCode = vi.hoisted(() => vi.fn());
const recordAttempt = vi.hoisted(() => vi.fn());
const recordAuditEvent = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({ createDbClient: () => db }));
vi.mock("@/lib/env", () => ({ loadEnv: () => ({ DATABASE_URL: "postgres://x" }) }));
vi.mock("@/lib/http/auth", () => ({ getAuthenticatedUser }));
vi.mock("@/lib/authz/helpers", () => ({ requireOrganizationAdminOverride }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent }));
vi.mock("@/lib/rate-limit/postgres", () => ({ PostgresRateLimiter: class { recordAttempt = recordAttempt; } }));
vi.mock("@/lib/telegram/config", () => ({ resolveTelegramConfig }));
vi.mock("@/lib/telegram/link", () => ({ currentTelegramLinkCode, revokeTelegramLink }));

let links: Record<string, unknown>[] = [];

const db = {
  select: () => ({
    from: (table: unknown) => {
      const rows = async () => (table === jarvisTelegramLinks ? links : []);
      return { where: () => ({ orderBy: rows, then: (resolve: (value: unknown) => unknown) => rows().then(resolve) }) };
    },
  }),
} as never;

const { GET, DELETE } = await import("./route");

const params = (organizationId = ORG) => ({ params: Promise.resolve({ organizationId }) });
const request = () => new Request("https://lynq.build/api/organizations/x/jarvis/telegram");

async function body(response: Response) {
  return (await response.json()) as {
    data: { available?: boolean; code: string | null; revoked?: number; reason: string | null; links?: { id: string }[] };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  links = [{ id: "link-1", organizationId: ORG, userId: FOUNDER, telegramChatId: "4242", username: "mustafa", linkedAt: new Date(), lastSeenAt: new Date() }];
  getAuthenticatedUser.mockResolvedValue({ userId: FOUNDER });
  requireOrganizationAdminOverride.mockResolvedValue(undefined);
  recordAttempt.mockResolvedValue({ allowed: true });
  recordAuditEvent.mockResolvedValue(undefined);
  currentTelegramLinkCode.mockReturnValue({ code: "41729608", expiresInMs: 120_000 });
  resolveTelegramConfig.mockReturnValue({
    ok: true,
    config: { botToken: "1234567890:AAaa", webhookSecret: "w".repeat(24), organizationId: ORG, founderUserId: FOUNDER, linkSecret: "s".repeat(32) },
  });
});

describe("reading the pairing code", () => {
  it("gives it to the founder's own authenticated session", async () => {
    const response = await GET(request(), params());
    const { data } = await body(response);

    expect(data.available).toBe(true);
    expect(data.code).toBe("41729608");
    // A live credential: no intermediary may keep a copy of this response.
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("withholds it from another admin of the same workspace, but still shows what is linked", async () => {
    getAuthenticatedUser.mockResolvedValue({ userId: OTHER_ADMIN });
    const { data } = await body(await GET(request(), params()));

    expect(data.available).toBe(false);
    expect(data.code).toBeNull();
    // Which chats can drive Jarvis is not a credential, and this admin is
    // the one who may need to cut them off.
    expect(data.links).toHaveLength(1);
  });

  it("shows what is linked even when the lane has been switched off", async () => {
    resolveTelegramConfig.mockReturnValue({ ok: false, reason: "disabled", missing: [] });
    const { data } = await body(await GET(request(), params()));

    expect(data.code).toBeNull();
    expect(data.links).toHaveLength(1);
  });

  it("withholds it for a workspace this deployment does not serve", async () => {
    const { data } = await body(await GET(request(), params(OTHER_ORG)));
    expect(data.code).toBeNull();
  });

  it("says the lane is not set up rather than naming what is missing", async () => {
    resolveTelegramConfig.mockReturnValue({ ok: false, reason: "incomplete", missing: ["TELEGRAM_BOT_TOKEN"] });
    const { data } = await body(await GET(request(), params()));

    expect(data.code).toBeNull();
    expect(data.reason).not.toContain("TELEGRAM_BOT_TOKEN");
  });

  it("refuses an automated client flooding the audit trail", async () => {
    recordAttempt.mockResolvedValue({ allowed: false });
    expect((await GET(request(), params())).status).toBeGreaterThanOrEqual(400);
  });
});

describe("cutting every chat off", () => {
  it("revokes every active link for the workspace", async () => {
    const { data } = await body(await DELETE(request(), params()));

    expect(data.revoked).toBe(1);
    expect(revokeTelegramLink).toHaveBeenCalledTimes(1);
  });

  it("works for any admin of the workspace, not only the configured founder", async () => {
    // The phone in someone else's hand is exactly when the person at the
    // keyboard is not the founder.
    getAuthenticatedUser.mockResolvedValue({ userId: OTHER_ADMIN });
    const { data } = await body(await DELETE(request(), params()));

    expect(data.revoked).toBe(1);
    expect(revokeTelegramLink).toHaveBeenCalledWith(db, expect.objectContaining({ actorUserId: OTHER_ADMIN }));
  });

  it("works after the lane has been switched off, because the links outlive it", async () => {
    resolveTelegramConfig.mockReturnValue({ ok: false, reason: "disabled", missing: [] });
    const { data } = await body(await DELETE(request(), params()));
    expect(data.revoked).toBe(1);
  });

  it("still requires an admin of this workspace", async () => {
    requireOrganizationAdminOverride.mockRejectedValue(Object.assign(new Error("forbidden"), { httpStatus: 403, code: "forbidden" }));
    const response = await DELETE(request(), params());

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(revokeTelegramLink).not.toHaveBeenCalled();
  });
});
