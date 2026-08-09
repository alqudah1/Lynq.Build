import { describe, it, expect, vi } from "vitest";
import { completeLogin, completeLink } from "./account-linking";
import { IdentityConflictError } from "./errors";
import type { ProviderIdentity } from "./callback";

function identity(overrides: Partial<ProviderIdentity> = {}): ProviderIdentity {
  return {
    provider: "google",
    providerAccountId: "provider-sub-1",
    email: "Alice@Example.com",
    emailVerified: true,
    name: "Alice",
    image: null,
    ...overrides,
  };
}

/** Queue-based fake: each call to select().from().where() returns the next queued result. */
function createFakeDb(queuedSelects: unknown[][]) {
  let i = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(queuedSelects[i++] ?? []),
      }),
    }),
  };
}

function uniqueViolation(): Error & { code: string } {
  const err = new Error("duplicate key value violates unique constraint") as Error & { code: string };
  err.code = "23505";
  return err;
}

function createFakeRawSql(transactionImpl?: (queries: unknown[]) => Promise<unknown>) {
  const transactionMock = vi.fn(transactionImpl ?? (() => Promise.resolve([])));
  const tag = ((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): unknown;
    transaction: typeof transactionMock;
  };
  tag.transaction = transactionMock;
  return { fakeRawSql: tag, fakeTransaction: transactionMock };
}

const CONTEXT = { ipAddress: "203.0.113.5", userAgent: "test-agent" };

describe("completeLogin", () => {
  it("issues a session for an existing account match, atomically with the login-success audit event, without touching users/accounts", async () => {
    const fakeDb = createFakeDb([[{ userId: "user-1" }]]); // accounts select
    const { fakeRawSql, fakeTransaction } = createFakeRawSql();

    const result = await completeLogin(fakeDb as never, fakeRawSql as never, identity(), CONTEXT);

    expect(result.outcome).toBe("existing");
    expect(result.userId).toBe("user-1");
    expect(result.rawToken).toBeTruthy();
    expect(fakeTransaction).toHaveBeenCalledTimes(1);
    expect((fakeTransaction.mock.calls[0][0] as unknown[]).length).toBe(2); // session insert + audit insert
  });

  it("creates a new user when no account matches and the email is unverified — never looks up existing users by email", async () => {
    const fakeDb = createFakeDb([[], [{ id: "some-other-user" }]]); // accounts: none; users: would-match but unverified so never queried
    const { fakeRawSql, fakeTransaction } = createFakeRawSql();

    const result = await completeLogin(fakeDb as never, fakeRawSql as never, identity({ emailVerified: false }), CONTEXT);

    expect(result.outcome).toBe("created");
    expect((fakeTransaction.mock.calls[0][0] as unknown[]).length).toBe(5); // user, account, session, sign_up, login_success
  });

  it("creates a new user when no account matches, the email is verified, and no existing user matches it", async () => {
    const fakeDb = createFakeDb([[], []]);
    const { fakeRawSql, fakeTransaction } = createFakeRawSql();

    const result = await completeLogin(fakeDb as never, fakeRawSql as never, identity(), CONTEXT);

    expect(result.outcome).toBe("created");
    expect(fakeTransaction).toHaveBeenCalledTimes(1);
  });

  it("throws IdentityConflictError — never creates anything — when a verified email matches an existing user via a different provider", async () => {
    const fakeDb = createFakeDb([[], [{ id: "existing-user-1" }], []]);
    const { fakeRawSql, fakeTransaction } = createFakeRawSql();

    await expect(completeLogin(fakeDb as never, fakeRawSql as never, identity(), CONTEXT)).rejects.toThrow(
      IdentityConflictError
    );
    expect(fakeTransaction).not.toHaveBeenCalled();
  });

  it("resolves to the existing identity, not a conflict, when a concurrent identical signup already committed between the email lookup and the conflict decision", async () => {
    // accounts (initial): none yet. users (by email): matches — looks like
    // a conflict so far. accounts (re-check, right before throwing): now
    // found — a concurrent request for this exact identity won the race in
    // between. This must resolve to the existing user, never a false conflict.
    const fakeDb = createFakeDb([[], [{ id: "existing-user-1" }], [{ userId: "existing-user-1" }]]);
    const { fakeRawSql, fakeTransaction } = createFakeRawSql();

    const result = await completeLogin(fakeDb as never, fakeRawSql as never, identity(), CONTEXT);

    expect(result.outcome).toBe("existing");
    expect(result.userId).toBe("existing-user-1");
    expect(fakeTransaction).toHaveBeenCalledTimes(1); // session + audit only, no user/account creation
  });

  it("resolves a racing duplicate signup to the winner's existing identity with a fresh session — never a raw error", async () => {
    let call = 0;
    const fakeRawSqlObj = createFakeRawSql(() => {
      call++;
      if (call === 1) return Promise.reject(uniqueViolation());
      return Promise.resolve([]);
    });
    // Reads: 1) accounts (none yet) 2) users (none) [initial attempt]
    // Then after the race is caught: 3) accounts (winner found)
    const fakeDb = createFakeDb([[], [], [{ userId: "winner-user-1" }]]);

    const result = await completeLogin(fakeDb as never, fakeRawSqlObj.fakeRawSql as never, identity(), CONTEXT);

    expect(result.outcome).toBe("existing");
    expect(result.userId).toBe("winner-user-1");
    expect(fakeRawSqlObj.fakeTransaction).toHaveBeenCalledTimes(2); // failed create attempt + fresh session issuance
  });

  it("surfaces a genuine conflict (not a race) when the unique violation wasn't on the (provider, providerAccountId) constraint", async () => {
    const fakeRawSqlObj = createFakeRawSql(() => Promise.reject(uniqueViolation()));
    // Reads: 1) accounts (none) 2) users (none) [initial] 3) accounts (still none post-failure) 4) users (the real conflicting row)
    const fakeDb = createFakeDb([[], [], [], [{ id: "conflicting-user-1" }]]);

    await expect(
      completeLogin(fakeDb as never, fakeRawSqlObj.fakeRawSql as never, identity(), CONTEXT)
    ).rejects.toThrow(IdentityConflictError);
  });
});

describe("completeLink", () => {
  it("links an unverified Microsoft identity through the explicit authenticated flow without using email as an identity signal", async () => {
    const fakeDb = createFakeDb([[]]);
    const { fakeRawSql, fakeTransaction } = createFakeRawSql();

    await expect(
      completeLink(
        fakeDb as never,
        fakeRawSql as never,
        identity({ provider: "microsoft", emailVerified: false }),
        "current-user-1"
      )
    ).resolves.toEqual({ outcome: "linked" });
    expect(fakeTransaction).toHaveBeenCalledTimes(1);
  });

  it("is idempotent when already linked to the current user, without a transaction", async () => {
    const fakeDb = createFakeDb([[{ userId: "current-user-1" }]]);
    const { fakeRawSql, fakeTransaction } = createFakeRawSql();

    const result = await completeLink(fakeDb as never, fakeRawSql as never, identity(), "current-user-1");

    expect(result).toEqual({ outcome: "already-linked" });
    expect(fakeTransaction).not.toHaveBeenCalled();
  });

  it("rejects when already linked to a different user", async () => {
    const fakeDb = createFakeDb([[{ userId: "someone-else" }]]);
    const { fakeRawSql } = createFakeRawSql();

    await expect(completeLink(fakeDb as never, fakeRawSql as never, identity(), "current-user-1")).rejects.toThrow(
      IdentityConflictError
    );
  });

  it("rejects when the verified email belongs to a different existing user", async () => {
    const fakeDb = createFakeDb([[], [{ id: "a-different-user" }]]);
    const { fakeRawSql } = createFakeRawSql();

    await expect(completeLink(fakeDb as never, fakeRawSql as never, identity(), "current-user-1")).rejects.toThrow(
      IdentityConflictError
    );
  });

  it("links successfully, atomically with the account-linked audit event, when nothing conflicts", async () => {
    const fakeDb = createFakeDb([[], []]);
    const { fakeRawSql, fakeTransaction } = createFakeRawSql();

    const result = await completeLink(fakeDb as never, fakeRawSql as never, identity(), "current-user-1");

    expect(result).toEqual({ outcome: "linked" });
    expect(fakeTransaction).toHaveBeenCalledTimes(1);
    expect((fakeTransaction.mock.calls[0][0] as unknown[]).length).toBe(2); // account insert + audit insert
  });

  it("resolves a racing duplicate link request from the same user to 'already-linked'", async () => {
    const fakeRawSqlObj = createFakeRawSql(() => Promise.reject(uniqueViolation()));
    const fakeDb = createFakeDb([[], [], [{ userId: "current-user-1" }]]);

    const result = await completeLink(fakeDb as never, fakeRawSqlObj.fakeRawSql as never, identity(), "current-user-1");

    expect(result).toEqual({ outcome: "already-linked" });
  });

  it("rejects a racing link request that actually belongs to a different user", async () => {
    const fakeRawSqlObj = createFakeRawSql(() => Promise.reject(uniqueViolation()));
    const fakeDb = createFakeDb([[], [], [{ userId: "someone-else" }]]);

    await expect(
      completeLink(fakeDb as never, fakeRawSqlObj.fakeRawSql as never, identity(), "current-user-1")
    ).rejects.toThrow(IdentityConflictError);
  });
});
