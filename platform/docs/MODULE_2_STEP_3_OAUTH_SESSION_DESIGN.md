# Module 2 Step 3 — OAuth and Session Foundation: Implementation Design

Implemented (locally, pending live-provider acceptance — see §16). Original design approved, then revised twice during implementation as real findings surfaced: once when Arctic was discovered to have been deprecated by its maintainer two days before this step began, and again during a dedicated security-correction pass (this revision) that replaced structural ID-token decoding with full cryptographic OIDC validation, added nonce protection, corrected Microsoft's stable identity, corrected session expiration, added real database transaction boundaries, and reconciled the audit-event taxonomy. Every correction is recorded in place below with its own note, not silently folded in, so the history stays legible.

Scope is strictly: provider-agnostic OAuth configuration, Google and Microsoft provider setup, state/PKCE/nonce handling, cryptographic callback validation, account lookup/linking rules, database-backed session primitives, session cookie issuance/validation/revocation, a provider-agnostic rate-limiter interface with its initial Postgres implementation, authentication/session audit events, and tests. **Not** in scope: organization creation, organization/workspace authorization helpers, invitations, onboarding or dashboard UI, application-wide middleware, or Brain/agent/workflow/marketing features.

This design also enforces the Neon Auth isolation boundaries from the master design doc's §19 point 6: no Neon Auth/Better Auth SDK, no reference to `NEON_AUTH_BASE_URL`/`VITE_NEON_AUTH_URL`, no query against `neon_auth`, and a static check enforcing this in CI.

---

## 1. A schema addition this step requires — flagged up front

Every table needed for Step 3's actual feature work already exists from Module 2 Step 2 and the schema-hardening pass — **except one**. §11's rate-limiter design requires an atomic `INSERT ... ON CONFLICT (key) DO UPDATE SET count = count + 1 ... RETURNING count` against a real counter table, and no such table exists among the originally-approved nine. This means Step 3 requires a **tenth table** — the master doc's §6 and §18 have been updated to reflect this; the application schema now totals ten tables, not nine.

```ts
export const rateLimitCounters = pgTable("rate_limit_counters", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});
```

- **Why it exists**: §11's rate-limiting design (already approved) is not real without a durable, atomically-updatable counter — this table *is* that mechanism.
- **Primary relationships**: none — a rate-limit key is a string derived from scope/action/identifier (§11), never a foreign key to another table.
- **Unique constraints**: the primary key on `key` itself.
- **Schema qualification**: `public`, via plain `pgTable`, per the Neon Auth boundary rule — no `pgSchema` wrapper, ever.

Applied via migration `drizzle/0002_square_doctor_doom.sql`, through the same HTTP-transport-plus-manual-bookkeeping discipline as the Step 2 hardening pass (the websocket-based `drizzle-kit migrate` transport remains broken in this sandbox). Verified directly: `drizzle-kit check` clean, and the atomic upsert proven under 20 real concurrent calls against Postgres, producing exactly counts 1–20 with no lost updates.

---

## 2. Exact files created or modified

```
src/db/schema.ts                                          — rate_limit_counters (§1)
drizzle/0002_square_doctor_doom.sql                       — its migration

src/lib/auth/env.ts                                        — loadAuthEnv(): OAuth-specific env validation, deliberately separate from src/lib/env.ts (would otherwise break the already-shipped health check)
src/lib/auth/providers.ts                                  — Google/Microsoft endpoint configs, authorization-URL builder, token exchange, userinfo fetch, and verifyIdToken (§3/§4 correction: full JWKS-based cryptographic verification via `jose`)
src/lib/auth/state.ts                                       — state/PKCE/nonce generation + signed pre-auth cookie read/write (§7, correction pass §2)
src/lib/auth/callback.ts                                   — assertStateMatches, assertNonceMatches, resolveProviderAccountId, resolveProviderIdentity (correction pass §2/§3)
src/lib/auth/account-linking.ts                             — completeLogin, completeLink: account-linking policy AND atomic transaction boundary (correction pass §5)
src/lib/auth/session.ts                                     — token generation/hashing, computeExpiresAt, createSession, validateSessionToken, revokeSession(s), deleteExpiredSessions (correction pass §4, §6, §7)
src/lib/auth/cookies.ts                                     — session cookie get/set/clear (`__Host-lynq_session`)
src/lib/auth/audit.ts                                       — recordAuthEvent + auditInsertQuery (raw-SQL batch variant for transactions), the auth audit-event union (correction pass §8)
src/lib/auth/errors.ts                                      — typed error classes, including NonceMismatchError and TokenExchangeError's outage/rejection classification (correction pass §2, §8)
src/lib/auth/redirects.ts                                   — isSafeRedirectTarget / resolveSafeRedirectTarget

src/lib/rate-limit/types.ts                                 — RateLimiter interface (§11)
src/lib/rate-limit/postgres.ts                              — Postgres implementation + deleteStaleRateLimitCounters (correction pass §7)

src/app/api/auth/[provider]/route.ts                        — GET, start login
src/app/api/auth/[provider]/callback/route.ts               — GET, handle callback (login or link intent)
src/app/api/auth/link/[provider]/route.ts                   — GET, start authenticated linking (requires a valid session; no UI calls it yet)
src/app/api/auth/logout/route.ts                             — POST, revoke session + clear cookie

src/static-checks/no-neon-auth-usage.test.ts                 — the required Neon Auth isolation check

Every *.ts file above has a colocated *.test.ts (unit, mocked, offline) —
matching the codebase's existing convention over the originally-proposed
test/ directory tree. Real-database behavior lives in colocated
*.integration.test.ts files, run separately via `npm run test:integration`
(needs .env.local sourced), never as part of the default `npm test`:
session.integration.test.ts, account-linking.integration.test.ts,
audit.integration.test.ts, rate-limit/postgres.integration.test.ts.
vitest.config.mts / vitest.integration.config.mts split accordingly.

src/app/api/auth/[provider]/callback/no-secrets-in-logs.test.ts — correction pass §9: exercises the real callback route (real signing/verification, not mocked) with secret-shaped fixture values and asserts none leak into console.error, redirects, or audit metadata.
```

No changes to any existing route, any UI file, or any file outside `src/lib/auth/`, `src/lib/rate-limit/`, `src/app/api/auth/`, `src/static-checks/`, `src/db/schema.ts`, and `drizzle/`.

---

## 3. Exact dependencies and versions

| Package | Version | Purpose |
|---|---|---|
| `jose` | `6.2.6` | JWKS retrieval/caching/rotation and cryptographic JWT (ID token) signature verification — correction pass §1 |

That's the only runtime dependency, added during the correction pass. Everything else is unchanged from the original Step 3 implementation:

- `node:crypto` — session token generation/hashing, OAuth `state`/`nonce`/PKCE generation, pre-auth cookie HMAC signing.
- `drizzle-orm@0.45.2` / `@neondatabase/serverless@1.1.0` — schema, reads, and the raw `neon()` tagged-template client used for atomic multi-row transactions (correction pass §5).
- `zod@4.4.3` — pre-auth cookie payload schema validation, env validation.
- Vitest — all tests.

No Auth.js, no `arctic` (uninstalled — see §4), no `openid-client` (evaluated and rejected — see §4), no `better-auth`.

---

## 4. OAuth/OIDC library choice and justification

This section has now been corrected twice during implementation. Both corrections are kept in full below, in order, since each was a real finding, not a cosmetic change.

### First correction (original implementation): Arctic → hand-rolled

Arctic was deprecated by its maintainer on 2026-07-29, two days before this step began, for maintenance/philosophical reasons ("the OAuth 2.0 protocol isn't an ideal layer to abstract into a library"), not a security incident. It was uninstalled before any code was written against it. The authorization-URL construction and token-exchange `POST` request — simple, publicly documented REST calls, not cryptographic operations — were hand-rolled instead, with zero new runtime dependencies at that point.

### Second correction (this pass): structural ID-token decoding was insufficient; `jose` added

The original hand-rolled implementation decoded the ID token's JSON payload without verifying its signature, relying on: (a) the token having been obtained via a direct, TLS-secured, back-channel token exchange, and (b) an independent userinfo-endpoint cross-check. On review, this was judged insufficient — a full OIDC-compliant client must cryptographically verify the JWT signature against the provider's published JWKS, not merely trust the back-channel transport.

**`openid-client` (evaluated first, per the explicit instruction to prefer it) was rejected** for a concrete, verified reason, not a preference: its high-level `discovery()` + `authorizationCodeGrant()` flow expects a single, fixed OIDC issuer per `Configuration`. Microsoft's multi-tenant `organizations` endpoint's own discovery document — confirmed live by fetching `https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration` directly — returns `"issuer": "https://login.microsoftonline.com/{tenantid}/v2.0"`. This is **documented Microsoft Entra ID provider behavior for multi-tenant applications, not a defect**: Microsoft's own guidance is explicit that an application using a multi-tenant endpoint (`organizations`/`common`) must substitute the token's own `tid` claim into that template and require an exact match itself (*"Applications should replace the `{tenantid}` value in the issuer metadata with the tenant ID that is the target of the current request, and then check the exact match against the token's own `tid` claim"*) — the template is how Microsoft expects multi-tenant validation to work, by design, not something a generic OIDC library can fully automate on an application's behalf (also confirmed via `panva/openid-client` issue #718, where the maintainer categorizes it as provider-specific behavior outside the library's own scope to special-case). Auth.js's own Microsoft Entra ID provider (which also wraps `openid-client`) works around this with a `customFetch` interceptor that rewrites the discovery response — a workaround whose correctness for genuinely multi-tenant "any organization" sign-in (as opposed to a single fixed tenant) could not be independently verified from the library's own documentation, and openid-client's `Configuration` object model (session/config lifecycle it manages internally) was also a larger architectural shift than this step's existing hand-rolled callback flow needed.

**`jose` (also maintained by openid-client's author) was chosen instead** — a lower-level primitives library, not a framework:
- `createRemoteJWKSet(jwksUri)` — automatic JWKS retrieval, in-memory caching, and key rotation, satisfying "do not manually implement JWKS retrieval, key rotation" without adopting a full discovery/session model.
- `jwtVerify(idToken, jwks, { algorithms: ["RS256"], audience, issuer, maxTokenAge, clockTolerance })` — cryptographic signature verification, algorithm allow-listing, audience check, and standard expiry/issued-at validation, satisfying "do not manually implement JWT signature verification."
- For Google, `issuer` is passed directly as the fixed expected string (`jose` accepts only a fixed string or array — sufficient for Google's single, compliant issuer).
- For Microsoft, `issuer` is deliberately omitted from `jwtVerify`'s own check (jose cannot express a pattern), and the already-verified token's `iss` claim is validated immediately afterward against a tenant-shaped regex (`^https:\/\/login\.microsoftonline\.com\/[0-9a-fA-F-]{36}\/v2\.0$`) — the exact approach Microsoft's own documentation describes as required for multi-tenant applications. This is not a substitute for cryptographic verification (the signature is already fully verified via JWKS before this check ever runs) — only for the one claim value `jose`'s API cannot express as a pattern.
- Nonce comparison is not a `jose` claim-validation concern (nonce isn't a registered JWT claim any library validates generically) — it's compared directly against the value stored in the signed pre-auth cookie, using `crypto.timingSafeEqual` (correction pass §2).

**The userinfo endpoint cross-check is retained**, exactly as the instruction specified: a supplementary consistency check (comparing the userinfo response's `sub` against the now-cryptographically-verified ID token's `sub`), never a replacement for signature verification.

**Conclusion, updated**: Auth.js remains not required (same reasons as before — its automatic account-linking-by-email default and adapter/schema mismatch). `openid-client` was evaluated in good faith and rejected for a specific, verified, real reason (Microsoft's documented multi-tenant issuer-templating behavior requires exactly the kind of application-level, per-token tenant binding this design already needed to own directly — see §6's Gate-1 tenant-binding correction below). `jose` fits the existing hand-rolled callback architecture directly, adding exactly one dependency for exactly the cryptographic primitives that must never be hand-rolled, while leaving every project-specific decision (account linking, session shape, transaction boundaries, audit events, and the exact tenant-binding rule) as fully-owned, reviewable code.

---

## 5. Google and Microsoft callback flow (corrected)

**Start** (`GET /api/auth/[provider]`):
1. Validate `provider` is `google` or `microsoft` (404 otherwise).
2. `generateState()`, `generateCodeVerifier()`, **`generateNonce()`** (correction pass §2) — each `randomBytes(32)` base64url-encoded, via `node:crypto`.
3. Build the authorization URL with `code_challenge`/`code_challenge_method=S256`, `state`, and **`nonce`** attached.
4. Write the short-lived (10 minute), HMAC-signed pre-auth cookie: `{ provider, state, codeVerifier, nonce, intent, linkUserId?, redirectTo, expiresAt }`.
5. Redirect (302) to the authorization URL.

**Callback** (`GET /api/auth/[provider]/callback`):
1. Read and verify the signed pre-auth cookie (missing/expired/tampered → reject, audit `oauth_login_failure`, clear the cookie).
2. Compare `state` (exact match) — mismatch → reject (§2's CSRF mitigation).
3. Exchange the authorization code for tokens (`fetch` `POST`). A non-2xx or network failure is classified `unavailable` (provider outage) vs `rejected` (invalid request) — correction pass §8 — audited as `oauth_provider_unavailable` vs `oauth_login_failure` respectively.
4. **`verifyIdToken(provider, idToken)`** (correction pass §1) — full cryptographic verification via `jose`: JWKS signature, algorithm (RS256 only), audience, expiry, issued-at freshness (`maxTokenAge`, bounded to the same 10-minute pre-auth window), and issuer. For Google, the issuer is checked as an exact fixed string by `jose` itself. For Microsoft, **Gate 1's exact tenant-binding check** runs immediately after signature verification succeeds (§6 below) — not a general issuer-shape pattern match, but a requirement that `tid` and `oid` are present and well-formed GUIDs, and that `iss` exactly equals `https://login.microsoftonline.com/${tid}/v2.0` constructed from the token's own validated `tid`.
5. **`assertNonceMatches(expectedNonce, claims.nonce)`** (correction pass §2) — constant-time comparison; missing or mismatched nonce is rejected *before* any user/account is created or linked. The nonce value itself is never included in the thrown error or in any audit metadata — only the fact of a mismatch (`reason: "nonce_mismatch"`).
6. Independent userinfo cross-check: the userinfo endpoint's `sub` must match the verified ID token's `sub` — a forgery/tampering signal, not a replacement for step 4.
7. Resolve the stable provider identity (§6 below — corrected for Microsoft).
8. Clear the pre-auth cookie (already done in step 1 — single-use regardless of outcome).
9. **Login intent**: `completeLogin` (§6, §14) atomically creates the user/account if needed, issues a session, and writes the success audit event(s) — all in one database transaction. **Link intent**: `completeLink` (§6, §14) atomically inserts the account and writes `oauth_account_linked`. Neither path lets the route handler create a session or write an audit event separately — the atomic functions own that entirely.
10. On a conflict result: no session, no row created or modified, `oauth_link_conflict` audited, generic conflict redirect (no provider revealed).

**Microsoft-specific note (unchanged)**: `MICROSOFT_OAUTH_TENANT_ID=organizations` — any Entra ID work/school account, across tenants, never personal Microsoft accounts. See §6 for the corrected treatment of Microsoft's email/identity claims.

---

## 6. Account-linking policy (Microsoft identity corrected)

Governing rule (unchanged): **never automatically link two provider accounts solely because they return the same email address unless the provider has verified that email and the currently authenticated user explicitly approves the link.**

### Stable provider identifiers (correction pass §3)

- **Google**: the validated `sub` claim, directly. Google's own stable, immutable per-application account identifier. Never the email.
- **Microsoft**: **`{tid}.{oid}`** — tenant ID plus object ID, both taken only from the cryptographically validated ID token. Documented exact format: the literal string `` `${tid}.${oid}` ``, e.g. `9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d.abc12345-0000-1111-2222-333344445555`. Neither `email`, `preferred_username`, nor UPN is ever used as identity — `oid` is immutable within a tenant, and qualifying it with `tid` guards against the (rare) cross-tenant-guest scenario where an `oid` alone could be ambiguous. A token missing either claim is rejected (`ProviderResponseMismatchError`) rather than falling back to anything email-shaped.

### Microsoft issuer-to-tenant binding audit (Gate 1, this pass)

Reviewed and hardened: the original implementation validated Microsoft's issuer with a general regex confirming it was *shaped* like `https://login.microsoftonline.com/<GUID>/v2.0`. That alone is insufficient — it doesn't confirm the GUID embedded in `iss` is the *same* tenant the token's own `tid` claim names. This is now corrected in `providers.ts`'s `assertMicrosoftTenantBinding`, run immediately after `jose` has already cryptographically verified the signature, algorithm, audience, and expiry:

- `tid` must be present and a well-formed GUID.
- `oid` must be present and a well-formed GUID.
- `iss` must **exactly equal** `` `https://login.microsoftonline.com/${tid}/v2.0` `` — constructed from the token's own validated `tid` claim, then compared with `===`. A well-formed, GUID-shaped issuer naming a *different* tenant than the token's own `tid` is rejected, even though a general pattern match would have accepted it.
- `providerAccountId` is `` `${tid}.${oid}` ``, exactly, built only from these two now-bound-and-validated claims.
- `tid` and `oid` are read only from the cryptographically verified JWT Claims Set (`payload`) — never from any query parameter, cookie, the userinfo response, or `MICROSOFT_OAUTH_TENANT_ID` (which only ever configures *which* tenants may attempt to authenticate at the authorization endpoint, never anything used for post-hoc identity verification).

Microsoft's `organizations`/`common` discovery document literally returning `"issuer": "https://login.microsoftonline.com/{tenantid}/v2.0"` (confirmed live) is **documented Microsoft Entra ID behavior for multi-tenant applications, not a defect** — Microsoft's own guidance requires exactly this application-level substitute-and-compare step. This section documents that requirement as implemented, not as a workaround for a platform bug.

### Email verification assurance (correction pass §3)

- **Google**: `emailVerified` is `true` **only** when the validated ID token's own `email_verified` claim is explicitly `true` — never assumed from any other signal.
- **Microsoft**: `emailVerified` is **always `false`**. Standard Microsoft Entra ID v2.0 ID tokens carry no claim equivalent to Google's `email_verified` — `email`/`preferred_username`/UPN are organizationally assigned but not a cryptographic verification assertion, and the previous design's "treat as pre-verified because the tenant is restricted to organizations" reasoning is corrected here: tenant restriction says something about *who can sign in*, not about *whether this specific email claim carries a verification assurance*. This one signal is also what makes "never automatically link a Microsoft identity to an existing LYNQ user based only on matching email" true by construction — the account-linking policy below never even looks up an existing user by email when `emailVerified` is `false`, so a Microsoft login can never resolve via email-matching at all; it can only ever be linked through the explicit, authenticated `/api/auth/link/[provider]` path. Microsoft's `email` (or `preferred_username` as a fallback) is still stored as contact/profile information — just never as an identity or matching signal.

### The policy itself (unchanged in structure from the original design; §14 below adds the transaction boundary)

1. **Exact match on `(provider, providerAccountId)`** → returning user; resolve directly.
2. **No exact match, `emailVerified !== true`** → never looked up against existing users; always a fresh signup.
3. **No exact match, `emailVerified === true`, no existing user matches** → fresh signup.
4. **No exact match, `emailVerified === true`, exactly one existing user matches**:
   - Authenticated, matching `linkUserId` (via `/api/auth/link/[provider]`) → linking authorized.
   - Any unauthenticated request → hard stop, `IdentityConflictError`, `oauth_link_conflict` audited, never auto-linked or auto-logged-in.

### Protection against account-linking attacks (unchanged, plus one addition)

Unverified-email takeover, cross-provider silent merge, forged linking-intent requests, and ID-token/userinfo mismatch protections are all unchanged from the original design (§6 there). **Added by this pass**: the ID token is now cryptographically verified before any of these checks run at all — a forged or tampered ID token is rejected at the signature-verification stage, before it can even reach the account-linking decision.

---

## 7. OAuth state, nonce, and PKCE storage strategy (nonce added)

Unchanged mechanism: cookies, not the database — single-use, short-lived (10 minutes), `HttpOnly`/`Secure`/`SameSite=Lax`/`Path=/api/auth`, HMAC-SHA256-signed with `AUTH_SECRET`.

**Added (correction pass §2)**: the payload now includes `nonce`, generated fresh per attempt alongside `state` and the PKCE verifier: `{ provider, state, codeVerifier, nonce, intent, linkUserId?, redirectTo, expiresAt }`. `nonce` serves a distinct purpose from `state` — `state` binds the callback to this browser (CSRF), PKCE binds the code exchange to this client, and `nonce` binds the *ID token itself* to this specific authorization request, preventing a captured or replayed ID token from a different flow being accepted. All three are cleared from the cookie the moment the callback consumes it, whether the flow succeeds or fails.

---

## 8. Database-backed session primitives (expiration model corrected)

### Corrected expiration model (correction pass §4)

The original design's "30 days absolute, sliding on activity, no separate idle timeout" is **superseded**:

- **Idle lifetime**: 7 days.
- **Absolute lifetime**: 30 days from `sessions.created_at` — never extendable past this.
- **Renewal write threshold**: 1 hour (unchanged) — a database write on every request is still avoided.
- **On valid activity**: `newExpiresAt = min(now + 7 days, created_at + 30 days)` — implemented as `computeExpiresAt(createdAt, now)`, a pure function, unit-tested directly.
- **At creation**: `createdAt === now`, so the initial `expiresAt` is `now + 7 days` (the idle bound, since it's always smaller than `createdAt + 30 days` at issuance).
- **A renewal-eligible request arriving after the absolute cap has already passed** does not "renew" to an already-past timestamp — `validateSessionToken` explicitly checks `newExpiresAt > now` before applying it, returning the session as absent (null) otherwise. This was a genuine bug caught during integration testing (a session 31 days old, with a stale-looking but not-yet-expired `expires_at`, would otherwise have been silently "renewed" to a timestamp already in the past) — fixed before this pass shipped.

### Session-token hashing (correction pass §6 — decision recorded, not changed)

**Decision: keep plain (unsalted, unkeyed) SHA-256.** Documented justification: this is safe specifically because the hashed input is 32 bytes (256 bits) of CSPRNG output, not a low-entropy human-chosen secret. SHA-256's speed is a liability for password hashing (a small, guessable search space can be brute-forced at billions of guesses/second) but irrelevant here — inverting a random 256-bit value requires searching essentially the full 2^256 space regardless of hash speed, which is infeasible with any hash function. A slow KDF would add real request latency for no corresponding security benefit against this specific threat model.

**HMAC-SHA256 with a dedicated `SESSION_TOKEN_SECRET` was considered and explicitly not chosen** — not for cosmetic reasons, but because it would introduce a new secret with a real rotation cost (rotating it invalidates every active session at once unless a dual-secret verification window is built) for a benefit that doesn't materialize against a 256-bit-entropy input. Documented as the correct future choice specifically if token-generation entropy is ever reduced — not before. `AUTH_SECRET` is never reused for this or any other unrelated cryptographic purpose (it signs only the pre-auth cookie, §7).

### Everything else (unchanged from the original design)

Token generation (`randomBytes(32)`, base64url), `__Host-lynq_session` cookie (`Secure`/`HttpOnly`/`SameSite=Lax`/`Path=/`), `revokeSession`/`revokeAllSessionsForUser` (immediate), a brand-new session always issued on successful callback, never promoted from pre-auth state.

---

## 9. Neon Auth isolation — the required static check

Unchanged from the original design, implemented at `src/static-checks/no-neon-auth-usage.test.ts` (moved from the originally-proposed `test/static/` path to match this codebase's actual convention of colocating tests under `src/`): checks `package.json` for forbidden dependencies (`better-auth`, `@neondatabase/auth`, `@neondatabase/neon-js`, `@neondatabase/auth-ui`) and recursively scans `src/` for the literal strings `NEON_AUTH_BASE_URL`, `VITE_NEON_AUTH_URL`, `neon_auth.`.

---

## 10. Required environment variables (names only, unchanged)

| Name | Purpose |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth credentials |
| `MICROSOFT_OAUTH_CLIENT_ID` / `MICROSOFT_OAUTH_CLIENT_SECRET` | Microsoft Entra ID app credentials |
| `MICROSOFT_OAUTH_TENANT_ID` | Recommended value `organizations` (§6) |
| `AUTH_SECRET` | HMAC key signing the pre-auth cookie only (§7, §8) |
| `AUTH_BASE_URL` | Exact, pre-registered OAuth redirect base URL |

No new environment variable was needed for the `jose`-based verification correction — JWKS URIs are fixed, published, per-provider constants in `providers.ts`, not configuration. None overlap with `NEON_AUTH_BASE_URL`/`VITE_NEON_AUTH_URL`.

---

## 11. Provider-agnostic rate limiting (unchanged design; cleanup added)

§11 of the master doc's interface and Postgres implementation are unchanged. **Added by this pass (§7 of the correction)**: `deleteStaleRateLimitCounters`, the operational-cleanup query — see §15 below.

---

## 12. Audit-event taxonomy (reconciled — correction pass §8)

| Event | Meaning |
|---|---|
| `sign_up` | A brand-new `users` row was created via OAuth. |
| `oauth_login_success` | A session was issued (new or existing user). |
| `oauth_login_failure` | An actively invalid or suspicious request: bad `state`/`nonce`, forged/invalid ID token signature, rejected authorization code, wrong issuer/audience. |
| `oauth_link_conflict` | A verified (or attempted) email match against an existing user was stopped for human-safe resolution rather than auto-linked. |
| `oauth_account_linked` | An authenticated user explicitly linked a new provider identity to their account. |
| **`oauth_provider_unavailable`** *(new)* | The provider itself could not be reached, or returned a 5xx — a network/availability failure, deliberately distinguishable from `oauth_login_failure` so provider outages are separately queryable from suspected abuse or invalid requests. |
| `logout` | A session was explicitly revoked via sign-out. |
| `session_revoked` | Reserved for a future forced/administrative revocation path — not yet triggered anywhere in this step. |

This table supersedes the event list in the master doc's §10 for the auth/session domain; the master doc itself is updated to match (§10, §2's "Account-linking confusion" threat-model row flipped from "Deferred by design" to "Active").

---

## 13. Nonce protection — summary (correction pass §2)

A fresh `randomBytes(32)` nonce is generated per authorization attempt, stored in the signed pre-auth cookie alongside `state`/`codeVerifier`, sent as the `nonce` authorization-request parameter, and required to appear unmodified in the cryptographically-verified ID token's own `nonce` claim. Compared via `crypto.timingSafeEqual`. A missing or mismatched nonce is rejected — via `NonceMismatchError` — before any user or account is created or linked, and before the pre-auth cookie's clearing step (already unconditional). Audited as `oauth_login_failure` with `reason: "nonce_mismatch"` — the nonce value itself never appears in the error message, audit metadata, or any log line (verified directly — §9 of this pass's test plan).

---

## 14. Transaction boundaries (correction pass §5)

**New login** (`completeLogin` in `account-linking.ts`): user creation (if needed), provider-account creation (if needed), session issuance, and the success audit event(s) are one atomic `rawSql.transaction([...])` batch. If the audit-log insert fails for any reason, the entire transaction rolls back — **the documented default is to roll back rather than produce an unlogged successful identity mutation**; there is no path in this codebase where a session or account can exist without its corresponding audit event, because they are never committed separately.

**Explicit linking** (`completeLink`): the authenticated user is verified first (a plain read, outside the write transaction — verifying who's asking isn't itself a mutation), then the provider-account insert and the `oauth_account_linked` audit event are one atomic transaction.

**Racing/duplicate callbacks, handled deterministically**: Postgres's own unique constraints (`accounts_provider_account_unique`, `users_email_lower_unique`) are the final concurrency guard, exactly as instructed. When two concurrent requests attempt to create the same brand-new identity, one transaction commits and the other's `INSERT` raises a unique-violation (`23505`), causing its entire transaction — user, account, session, and audit rows alike — to roll back atomically, leaving **no orphaned row of any kind**. The losing request's error is caught, never surfaced as a raw database error: it re-queries for the (provider, providerAccountId) that now exists, confirms a genuine race (not an unrelated email collision against a different existing user, which still correctly raises `IdentityConflictError`), and issues a **fresh session** for the winning identity in a second, small atomic transaction. The identical pattern applies to `completeLink`, resolving a racing duplicate link request to `already-linked` rather than an error. **Verified directly**: real concurrent integration tests (`Promise.all` of two genuinely simultaneous `completeLogin`/`completeLink` calls against the live non-production database) confirm exactly one user/account is created, both callers receive a valid session, and no duplicate or orphaned row remains in any of `users`, `accounts`, `sessions`, or `audit_logs`.

---

## 15. Operational cleanup (correction pass §7 — documented; scheduling deferred)

| Job | Query | Cadence | Retention | Ownership | Failure handling |
|---|---|---|---|---|---|
| Expired sessions | `deleteExpiredSessions(db)` — `DELETE FROM sessions WHERE expires_at < now()`, returns the deleted count | Daily | N/A (deletes anything past its own `expires_at`) | Whoever owns the future "operational jobs" step (not yet built) | Log the returned count; alert after repeated (e.g. 3 consecutive) failures. Never log a session's token hash or any raw token. |
| Stale rate-limit counters | `deleteStaleRateLimitCounters(db)` — `DELETE FROM rate_limit_counters WHERE window_start < now() - interval '7 days'`, returns the deleted count | Daily | 7 days past `window_start` — a deliberately generous margin, since every configured window in this codebase (§11's 900-second OAuth limit) ends in minutes, not days; the table doesn't persist which `windowSeconds` value produced a given row | Same as above | Same as above. Rate-limit keys can contain an email or IP — log only the deleted count, never the key values. |

Both query functions exist now and are integration-tested directly against the real database (proving they delete exactly the stale rows and nothing else). **Scheduling them (a cron job, a queue consumer, or similar) is explicitly deferred to the future operational-jobs step**, per the instruction that implementation may be deferred as long as the query, cadence, retention threshold, ownership, and failure-alert policy are documented now.

---

## 16. Real-provider and preview verification — status

**Not yet performed.** This requires the owner to create real Google and Microsoft OAuth applications and add their credentials to the isolated platform Vercel project — an owner action, not something performable from this environment. Per the explicit instruction: **Step 3 is classified as implemented and verified locally (full unit and integration test suites, real-database concurrency tests, real cryptographic JWT verification tests against generated key pairs) — pending live acceptance** against real Google and Microsoft accounts on a deployed preview. The checklist to run once credentials exist: one real Google login, one real Microsoft work/school login, logout + immediate revocation, a second login on the same provider not duplicating the user, explicit cross-provider linking from an authenticated session, exact callback-URL registration match, no secrets in Vercel logs, and `lynq.build` itself untouched.

---

## 17. Test plan (as actually implemented)

**Unit** (colocated `*.test.ts`, offline, `npm test`): every function in every file listed in §2, including — verified with real generated RSA key pairs and real `jose` verification, not mocked — a correctly-signed token accepted; a token signed by a key absent from the JWKS rejected (forged signature); wrong issuer rejected; wrong audience rejected; expired token rejected; Microsoft's tenant-pattern issuer accepted while a non-tenant-shaped issuer is rejected; nonce present/absent/mismatched cases; Google's `sub` used as identity; Microsoft's `tid.oid` used as identity, never email/UPN; `computeExpiresAt`'s idle/absolute-cap arithmetic directly.

**Integration** (colocated `*.integration.test.ts`, real non-production database, `npm run test:integration`): rate-limiter atomicity and cleanup; session idle expiration, renewal before/near the absolute cap, absolute expiration despite continued renewal activity, revocation; `completeLogin`/`completeLink`'s real atomic writes, real conflict detection, and **real concurrent races** (`Promise.all` of simultaneous calls) proving deterministic resolution with zero orphaned rows; audit-log persistence.

**Security-specific** (`no-secrets-in-logs.test.ts`): the real callback route, with real signing/verification (only the DB/provider network layer mocked), driven with distinctive secret-shaped fixture values for state/nonce/PKCE-verifier/session-token — asserts none appear in `console.error` calls, redirect Location headers, response bodies, or audit metadata, across state-mismatch, nonce-mismatch, and successful-login paths.

All test data is cleaned up afterward; every integration run ends with all relevant tables verified empty (including `audit_logs`, which is `ON DELETE SET NULL` from `users`, not cascaded — a real cleanup gap this pass found and fixed in the test fixtures themselves).

---

## 18. Rollback plan

Unchanged in kind: purely additive (`rate_limit_counters`, new application files under `src/lib/auth/`, `src/lib/rate-limit/`, `src/app/api/auth/`, `src/static-checks/`), plus one new dependency (`jose`). Nothing outside those paths is touched, and nothing yet depends on any of it (no UI, no middleware). Rollback is: revert the commit, `npm uninstall jose`, drop the migration/table.

---

## 19. Definition of Done

A real Google or Microsoft account can complete the OAuth flow end-to-end with full cryptographic ID-token verification, correct nonce/state/PKCE handling, the corrected stable-identity resolution per provider, and either (a) produce a correctly-shaped new `users`/`accounts` row, (b) resolve to an existing one under the linking policy, or (c) correctly stop at a human-safe conflict state — receiving a valid, revocable, database-backed session (idle 7 days / absolute 30 days) in cases (a)/(b), with every write atomic and every race resolved deterministically. The full §17 test plan passes; the rate limiter enforces its configured limits and fails closed; the full §12 audit taxonomy fires correctly; the Neon Auth static check passes; operational cleanup queries exist and are documented; and no organization, workspace, invitation, UI, or middleware code exists yet. **Locally complete; live-provider acceptance (§16) remains pending and is required before Step 3 is fully closed.**
