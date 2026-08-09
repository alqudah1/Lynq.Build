# Module 2 Step 4C — Invitation Domain, API, and Transactional Email Boundary

Thin HTTP handlers wrapping the invitation domain (`src/lib/invitations/*`), plus a provider-neutral transactional email boundary (`src/lib/email/*`). Builds directly on Step 4A's domain foundation and Step 4B's HTTP infrastructure — same response envelope, same authorization helpers, same error-translation layer. **Not production-enabled** — Step 3's live Google/Microsoft OAuth acceptance remains pending, and no real transactional email provider is connected.

**Revision history**: initially shipped with the raw invitation token in the URL path (`GET /api/invitations/{token}`, `POST /api/invitations/{token}/accept`). A dedicated hardening pass (Step 4C.1) replaced that with a one-time raw-token exchange plus a signed, cookie-based continuation model — see "Token transport and privacy hardening" below. The token-in-URL routes no longer exist.

---

## Scope boundary

Implemented: invitation domain services, invitation API routes, secure token generation/hashing, atomic refresh-on-duplicate behavior, revocation, existing-user acceptance, new-user OAuth-continuation acceptance (now bound to the specific OAuth attempt via the pre-auth cookie), a provider-neutral email boundary (in-memory test transport + an unconfigured Resend adapter), audit events, rate limiting with HMAC-derived identifiers, and tests/documentation.

Explicitly NOT implemented: dashboard UI, React pages, application-wide middleware, Brain, agents, workflows, marketing features, real email delivery. `/invite` (the clean landing destination) is a plain, dependency-free `route.ts` returning static text — not a page component, not a dashboard.

---

## Invitation lifecycle

```
pending → accepted   (via POST /api/invitations/current/accept, atomically with membership creation)
pending → revoked    (via POST /api/organizations/{organizationId}/invitations/{invitationId}/revoke)
pending → expired    (lazily, the first time anything reads a pending row past its expires_at)
```

### Token model

- 32 cryptographically random bytes, base64url-encoded. Only the SHA-256 hex hash is ever stored (`invitations.token_hash`).
- **The token hash itself is treated as sensitive, bearer-equivalent material** — it can identify and effectively authorize an invitation lookup. It is never logged, never returned in any HTTP response, never included in audit metadata, and never exposed to client-side JavaScript (it lives only inside an HttpOnly cookie or a server-side pre-auth cookie payload).
- The raw token exists only in two places: the invitation email, and the single raw-token exchange request (`GET /invite/{rawToken}`). Nowhere else — not in any other route's URL, body, or response, not in the continuation cookie, not in logs.
- Single-use in the sense that matters: acceptance atomically transitions `pending → accepted`; every subsequent attempt either resolves idempotently (same user, already holds the membership) or fails with the same generic response.
- 7-day expiry from creation/refresh for the invitation itself; the continuation cookie derived from it is separately time-boxed to 10 minutes (see below).

### Atomic create-or-refresh

`POST /api/organizations/{organizationId}/invitations` is both the creation AND the refresh endpoint. If a pending invitation already exists for the same `(organizationId, email)`, the call atomically replaces it in place: new token, new hash, reset 7-day expiry, same row ID — one `INSERT ... ON CONFLICT (organization_id, email) WHERE status = 'pending' DO UPDATE ...` statement, using the schema's own partial unique index as the concurrency guard. **Refreshing invalidates any continuation cookie tied to the previous token hash** — not through any special-case logic, but because the old hash simply no longer matches any row's `token_hash` once overwritten; every lookup (preview, accept, or a stale continuation cookie's hash) fails identically to a nonexistent token. Proven directly in `invitations.integration.test.ts` (concurrent duplicate creates) and `continuation.integration.test.ts` (old continuation cookie fails after refresh).

---

## Token transport and privacy hardening (Step 4C.1)

### The problem

A raw token in a URL path (`GET /api/invitations/{token}`) can be recorded well beyond the application's own logs:

- **Vercel request logs** — Vercel's Runtime Logs capture the full request path, including query strings, for every function invocation by default (documented Vercel platform behavior). This was **not independently re-verified via a live deployment in this pass** — no synthetic deployment was made (see "Hosting-log reality" below) — but it should be assumed true rather than assumed safe.
- **Reverse proxies / CDN edge logs** sitting in front of Vercel, if any are ever introduced.
- **Browser history** — the token sits in the address bar and is stored in the visiting browser's history.
- **Analytics tools** — any client-side analytics script that reports `location.href` or `document.referrer` would capture it.
- **Error-monitoring tools** (e.g., Sentry-style breadcrumbs) that record the request URL alongside an unrelated error.
- **`Referer` headers** — if the invitation page ever linked out to a third party, the full URL (including the token) would be sent as the `Referer` header of that outbound request.
- **Email link scanners** — many corporate/consumer mail providers pre-fetch links in incoming email for safety scanning, which means the token-bearing URL can be "visited" by an automated scanner before the real recipient ever clicks it.

None of these are things this application can redact after the fact — they are properties of infrastructure and other parties this application does not control. The only real mitigation is to minimize how many requests ever carry the raw token, and how long it remains valid.

### The design

```
GET /invite/{rawToken}
  → validates the raw token
  → exchanges it for a signed, HttpOnly continuation cookie (hash only)
  → 303 redirect to the clean, token-free /invite

GET  /invite                          (clean landing — no token, no third-party assets)
GET  /api/invitations/current         (preview, via the continuation cookie)
POST /api/invitations/current/accept  (accept, via the continuation cookie)
```

`GET /invite/{rawToken}` is now the **only** place a raw token is ever handled outside the email itself. Every other route operates on the continuation cookie's hash. This directly minimizes exposure: even in the worst case (the exchange URL is recorded by infrastructure this application doesn't control), what's captured is a single-use link tied to one specific, time-boxed invitation — not a token accepted by every subsequent request in the flow.

Every response from the exchange endpoint (success or failure) sets:
- `Cache-Control: no-store` — the response must never be cached anywhere, including by an intermediate proxy.
- `Referrer-Policy: no-referrer` — the browser must never forward this URL as a `Referer` header on any subsequent navigation.

The clean `/invite` landing is a plain `route.ts` (not a page component) returning static, dependency-free plain text — it loads no third-party analytics or assets at all, trivially satisfying "must not load third-party analytics or assets before token removal from the address bar," since by the time it's reached, the token is already gone from the address bar.

### Hosting-log reality

This pass did **not** perform a live synthetic-token deployment test against Vercel's actual request logs (that would require deploying this app and was deliberately deferred pending explicit authorization, per this session's own decision to document known platform behavior rather than deploy). What's stated above is Vercel's documented Runtime Logs behavior, not an empirically re-verified finding from this specific project. **Do not treat this as proven safe** — treat it as the reason the design minimizes exposure to one request rather than assuming logs are redacted. A follow-up empirical test (deploy a preview, hit `/invite/{synthetic-non-production-token}`, inspect `vercel logs`) is recommended before this module is considered production-ready, and is explicitly flagged as a remaining gap.

### Continuation cookie lifecycle

`lynq_invitation_continuation` — HttpOnly, `Secure`, `SameSite=Lax`, HMAC-SHA256 signed with `AUTH_SECRET`, 10-minute expiry, carrying **only** the invitation's token hash (never the raw token, never any other invitation field).

| Event | Cookie behavior |
|---|---|
| Set | By `GET /invite/{rawToken}` after validating the raw token, and only there. |
| Read | By `GET /api/invitations/current` (read-only, does not clear) and by the login-initiation route (folds the hash into a fresh pre-auth cookie — see below). |
| Cleared | After a successful `POST /api/invitations/current/accept`, and after a **terminal** failure (dead invitation, wrong email) — retrying cannot help either case. |
| Preserved | After a **transient** failure (an unexpected error, or a rate-limit backend outage) — the same continuation context can be retried once the transient condition clears, without a second trip through the email link. |
| Invalidated | Whenever the invitation itself is refreshed, revoked, or accepted — the cookie's hash simply stops resolving to a live, pending row; no separate cookie-side invalidation logic is needed. |
| Expires | After 10 minutes, regardless of the invitation's own 7-day validity — it must survive exactly one exchange-and-continue round trip, not the full invitation lifetime. |

### Binding to the intended OAuth flow

A standalone cookie surviving into the OAuth callback, on its own, is not enough: it could in principle be planted by a third party independent of any real OAuth attempt (e.g., getting a victim's browser to hit the exchange endpoint for an attacker-chosen invitation, then waiting for an unrelated, legitimate login to silently consume it). To close this, the login-initiation route (`GET /api/auth/{provider}`) reads the continuation cookie (if present) and folds its token hash directly into the **pre-auth cookie** (`lynq_oauth_pending`) — the same signed, `state`/`nonce`-protected payload that already exists for CSRF protection on the OAuth flow itself. The callback route then only ever honors an `invitationTokenHash` that arrived inside a pre-auth cookie whose `state` it independently verified against the provider's own redirect — a value that cannot be forged or planted independent of a genuine, browser-driven OAuth round trip. See `src/lib/auth/state.ts`'s `invitationTokenHash` field and its accompanying doc comment.

---

## Role and authority rules

- Only organization **owners and admins** may create, refresh, revoke, or list invitations.
- An **admin can never invite someone as owner** — only an owner may (`409 unauthorized_role`).
- A workspace may be attached to an invitation only if it belongs to the same organization — a cross-organization workspace is rejected identically to a nonexistent one (`404 not_found`).
- Acceptance never silently downgrades a stronger existing role.

---

## Acceptance

### Existing user (authenticated)

`POST /api/invitations/current/accept` with a valid session and a valid continuation cookie:

1. The actor's own email is read fresh from their `users` row and must match the invitation's normalized email — a mismatch is `403 email_mismatch` (a **terminal** failure — the cookie is cleared).
2. The invitation must be `pending` and unexpired at the exact moment of a single atomic conditional UPDATE — otherwise `404 invitation_not_available` (terminal, cookie cleared).
3. Organization membership (and workspace membership, if included) is created or confirmed, and the invitation is marked `accepted`, all in the same Postgres statement. Success clears the cookie.
4. If the actor already holds the intended membership (e.g., a replayed accept call), the response is `outcome: "already_member"` — same shape as a fresh acceptance, no duplicate created.

### New user (unauthenticated) — OAuth continuation

No temporary user is ever created, and OAuth is never bypassed.

1. `GET /invite/{rawToken}` has already set the continuation cookie.
2. `POST /api/invitations/current/accept` without a session re-validates the invitation is still viable and returns `{ "data": { "status": "oauth_required" } }` — nothing new needs to be established, since the cookie is already primed.
3. The client redirects into `GET /api/auth/{provider}`, which folds the continuation cookie's hash into a fresh pre-auth cookie (see "Binding to the intended OAuth flow").
4. Once OAuth login succeeds, the callback — **after** the login has already fully succeeded (session values computed, about to be persisted) — attempts acceptance using the hash from the verified pre-auth payload, matching against the now-authenticated user's fresh email.
5. **OAuth login always succeeds independent of invitation outcome** — a failed acceptance never rolls back or blocks a successful login. The outcome is signaled generically and visibly on the final redirect: `?invitation=accepted` or `?invitation=failed` (never the specific reason). The specific reason (`expired`/`revoked`/`already_used`/`email_mismatch`) is retained only in the corresponding `invitation_acceptance_failed` audit event's metadata, written by `acceptInvitationByHash` itself.
6. A **terminal** failure clears the continuation cookie (retry cannot help). A **transient** failure (anything unexpected) preserves it, so the user — now authenticated — can retry via a direct call to `POST /api/invitations/current/accept`, without a second OAuth round trip.

This is never silently swallowed: every outcome is either reflected in the redirect's `invitation` query parameter, or (for a transient failure) leaves the continuation context intact for an explicit retry — there is no code path where an acceptance attempt happens and neither the user nor the audit log ever learns the outcome.

Because live Google/Microsoft OAuth credentials remain unconfigured in this environment, this flow is tested via the callback's mocked/provider-independent unit tests (`route.test.ts`'s "invitation continuation" describe block — accepted/terminal-failure/transient-failure cases) plus real-database integration tests of the underlying cookie and acceptance mechanics (`continuation.integration.test.ts`).

### Transaction boundary

Validating invitation state, verifying organization/workspace scope, creating/confirming both memberships, transitioning the invitation to `accepted`, and writing the success audit record are **one Postgres statement** (a cascade of data-modifying CTEs) — inherently all-or-nothing regardless of the Neon HTTP driver's lack of interactive transactions. Concurrent acceptance attempts (proven under real `Promise.allSettled` concurrency) converge on exactly one `"accepted"` outcome and N−1 idempotent `"already_member"` outcomes, never a duplicate membership, never a partial state.

---

## Transactional email boundary

`src/lib/email/` defines the provider-neutral interface the invitation domain depends on — `src/lib/invitations/*` never imports Resend or any vendor SDK directly.

- **`EmailTransport`** (`types.ts`) — `send(message): Promise<void>`.
- **`renderInvitationEmail`** (`render.ts`) — receives the raw accept URL (now pointing at `GET /invite/{rawToken}`, not a token-in-path preview/accept route) only transiently.
- **`InMemoryEmailTransport`** (`test-transport.ts`) — the only transport the test suite uses.
- **`ResendEmailTransport` / `resolveConfiguredEmailTransport`** (`resend-transport.ts`) — calls Resend's plain HTTP API directly (no new npm dependency). Credentials read lazily inside `send()`, never at module load — neither the unit nor integration suite ever requires them.

**The raw token/accept URL never appears in any HTTP response**, unconditionally. **Known limitation**: until `RESEND_API_KEY` is configured, there is no in-product way to retrieve a created invitation's link.

---

## API routes

### `GET /invite/{rawToken}`

The single raw-token exchange endpoint. See "Token transport and privacy hardening" above for full behavior.

- **303 response (success)**: `Location: /invite`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. Sets the continuation cookie.
- **303 response (invalid/expired/revoked/already-accepted token, or any unexpected error)**: `Location: /invite?status=unavailable`, same headers. Deliberately identical response shape to avoid distinguishing failure reasons via the redirect target.
- **429 response**: standard JSON error envelope (not a redirect) if the rate limit is exceeded.
- Rate-limited by IP and by an HMAC-derived (never raw-token) identifier — see "Rate limiting" below.

### `GET /invite`

The clean, token-free landing destination. Plain `route.ts`, static text response, `Cache-Control: no-store`. Not a page, not a dashboard.

### `GET /api/invitations/current`

Preview of the invitation named by the continuation cookie — no token or hash in the URL.

**200 response**: `{ "data": { "organizationName": "Acme", "workspaceName": null, "email": "...", "role": "member", "workspaceRole": null, "expiresAt": "..." } }`

**Errors**: `404 no_active_invitation` (no continuation cookie present at all) · `404 invitation_not_available` (cookie present, but its invitation is dead) · `429 rate_limited`.

### `POST /api/invitations/current/accept`

**200 response (authenticated)**: `{ "data": { "outcome": "accepted" | "already_member", "organizationMembership": {...}, "workspaceMembership": null } }`

**200 response (unauthenticated)**: `{ "data": { "status": "oauth_required" } }`

**Errors**: `403 email_mismatch` · `404 no_active_invitation` · `404 invitation_not_available` · `429 rate_limited`.

### `POST /api/organizations/{organizationId}/invitations` (create/refresh) and `GET` (list)

Unchanged from the original Step 4C design — see the "Atomic create-or-refresh" section above. Request/response shapes unchanged.

### `POST /api/organizations/{organizationId}/invitations/{invitationId}/revoke`

Unchanged. `200 { "data": { "revoked": true } }`; `409 already_used` if not currently pending.

---

## Rate limiting

Every invitation rate-limit key uses an HMAC-derived identifier when a token/hash is involved — **never** the raw token, and never the plain SHA-256 hash that also serves as the database lookup key. `deriveRateLimitIdentifier(value, secret)` computes `HMAC-SHA256(AUTH_SECRET, "invitation-rate-limit:" + value)` — an explicit domain-separation label reusing `AUTH_SECRET` deliberately (rather than provisioning a fourth env var) in a way that keeps its cryptographic responsibilities separated: the same secret, but a distinct, purpose-labeled derivation, never the identical hash reused verbatim across two different roles (DB lookup key vs. rate-limit key).

| Action | Limit | Keys |
|---|---|---|
| Create/refresh invitation | 20 / hour | `invitation:create:org:{organizationId}:actor:{actorUserId}` |
| Raw-token exchange | 20 / 15 min | `invitation:exchange:ip:{ip}` **and** `invitation:exchange:token:{derivedId}` |
| Continuation-cookie lookup | 20 / 15 min | `invitation:current-lookup:ip:{ip}` **and** `invitation:current-lookup:token:{derivedId}` |
| Continuation-cookie acceptance | 20 / 15 min | `invitation:current-accept:ip:{ip}` **and** `invitation:current-accept:token:{derivedId}` |

Lookup and acceptance are deliberately separate key namespaces (never shared) so one endpoint's traffic can never exhaust the other's budget. Every check **fails closed**: a rate-limit backend failure is treated identically to an exceeded limit (`429 rate_limited`), never silently bypassed.

---

## Audit events

`invitation_created`, `invitation_refreshed`, `invitation_revoked`, `invitation_accepted`, `invitation_acceptance_failed` (metadata carries the specific reason — never surfaced publicly). Creation-time authority failures reuse `authorization_denied` with `metadata.reason`. `invitation_viewed` was deliberately not added (audit noise with no investigative value beyond what accept/failure events already capture).

Audit metadata never contains raw tokens, token hashes, or accept URLs — verified directly in dedicated no-secrets tests (`acceptance.integration.test.ts`, `continuation.integration.test.ts`) that spy on `console.error` and inspect the `audit_logs` rows themselves across success and failure paths, including the hardened cookie-based flow.

---

## Known limitations

- **Live OAuth acceptance remains pending** (Step 3).
- **No real email delivery** — Resend unconfigured in this environment.
- **No in-product way to retrieve a created invitation's accept link** until a real email provider is configured.
- **Vercel request-log behavior was not empirically re-verified** in this pass — see "Hosting-log reality" above. Treat the documented platform default as the operating assumption, not a proven guarantee, until a live test is run.
- Module 2 as a whole remains **not production-enabled**.
