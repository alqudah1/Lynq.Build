# Module 2 — Authentication & Tenancy Design (Revised)

Design only. No migrations, no packages installed, no runtime code changed. This revision supersedes the previous version in full — every section below reflects the requested re-evaluation, not just the sections that changed most. Implementation begins only after sign-off, following the sequence in §15.

---

# 1. Authentication option comparison

Four launch strategies compared, including OAuth (Google, Microsoft, GitHub) as a first-class option per your instruction.

| | Credentials only | OAuth only (Google, Microsoft, GitHub) | OAuth + credentials | Managed provider |
|---|---|---|---|---|
| **Security** | Entirely our responsibility — correct only if hashing, rate limiting, and reset/verification tokens are all done right (§4). | Delegates password security to providers with far more security investment than we can match — eliminates credential stuffing, brute force, and reset abuse *as threat categories*, not just as mitigated risks. Introduces a different, real risk class instead: redirect-URI validation, OAuth `state`-parameter CSRF, and account-linking confusion (see §2). | The **union** of both risk surfaces — everything credentials requires, plus everything OAuth requires, plus a new problem neither has alone: what happens when the same email arrives via both paths (see analysis below). | Strongest default — dedicated security teams and audits — but trust shifts entirely to a third party's posture and incident history. |
| **User experience** | Familiar, but real friction: an account to create, a password to remember, forgot-password flows. | Excellent when the user already has one of the three accounts — one click, nothing to remember. Excludes anyone unwilling or unable to use one of them (a real, if smaller, gap). | Best raw choice-availability for users, but the most complex login screen and the most decision points for someone signing up. | Often excellent — polished flows, frequently bundles social login *and* credentials *and* SSO. |
| **Implementation complexity** | Highest of the two "build it ourselves" options — hashing, verification, reset, lockout. | Moderate — no password logic at all, but three provider integrations (state/PKCE handling, callback validation, token exchange) done correctly. | Highest of all four, categorically — full credentials build *plus* full OAuth build *plus* account-linking-confusion handling neither needs alone. | Lowest — SDK integration, most flows handled for us. |
| **Account recovery** | We build password-reset ourselves. | Recovery *is* the provider's problem — if a user can log into Google, they can log into us. Real downside: zero fallback if a user's provider account itself becomes inaccessible. | Two entirely separate recovery stories to build, test, and support. | Handled by the provider. |
| **Session revocation** | Our own session table governs access regardless (§5) — unaffected by the choice of login method. | Same — revoking our session blocks access immediately even if the OAuth grant at the provider is untouched. | Same as both individually; no compounding effect here specifically. | Provider-managed; decent providers expose a revocation API. |
| **Transactional email dependency** | High — required for the *core* verification and reset flows, not just notifications. | Low — OAuth providers already verify email ownership before issuing an identity; email is only needed for invitations and notifications. | High — still carries the full credentials-side email dependency. | None — handled by the provider. |
| **Vendor lock-in** | None. | Real, but distributed across three independent large providers rather than concentrated in one — some natural mitigation, though a user whose *only* identity is one provider is still tied to it. | Lowest lock-in of the three vendor-touching options — credentials remains a true fallback if we ever needed to drop a provider. | Highest — a genuine, hard dependency on one company's uptime for a critical path, and the most difficult of all four to migrate away from later. |
| **Multi-tenant SaaS suitability** | Fine, but SSO-per-organization (a routine enterprise ask) is harder to retrofit. | Very good — Google Workspace and Microsoft 365 cover the large majority of real company email domains, meaning most prospective external customers already have a usable identity on day one. | Excellent on paper, at the cost of the complexity above. | Purpose-built for this — several providers market directly at B2B multi-tenant SaaS with org/SSO support included. |
| **Future enterprise SSO** | Must be retrofitted; SAML/OIDC integration is nontrivial. | **Shortest realistic path of any self-built option** — Microsoft OAuth sits one short step from full Microsoft Entra ID (Azure AD) enterprise SSO, and Google OAuth similarly connects toward Google Workspace SSO, since they're the same underlying identity ecosystems. | Same benefit as OAuth-only, inherited. | Strongest — enterprise SSO is often a paid add-on tier with minimal extra engineering, frequently the deciding reason companies choose a managed provider at all. |
| **Cost at current stage** | $0 direct; highest engineering-time cost. | $0 direct; moderate engineering-time cost. | $0 direct; **highest** engineering-time cost of all four. | Real, ongoing cost, typically per-MAU — a genuine long-term line item regardless of current user count. |
| **Migration difficulty later** | Low to add OAuth afterward — the `accounts` table (§6) already models multiple providers per user; this is additive, not a rewrite. | Low to add credentials afterward, for the same schema reason, in reverse. | N/A — already the most complete state. | **Highest of all four** — leaving a managed provider later means re-establishing (or forcing a reset of) every user's credential, one at a time, while the business depends on it working. |

### Does OAuth + credentials create unnecessary scope for Module 2? Yes.

Building both simultaneously means correctly securing two entirely separate authentication paths *and* the interaction between them, in the same module that also has to prove out tenancy, authorization, sessions, invitations, and audit logging for the first time. The specific new problem this combination introduces — **account-linking confusion** — deserves naming directly: if someone signs up with credentials using `alice@example.com`, and later a different person controls `alice@example.com` on Google and clicks "Sign in with Google," does that silently take over the existing account? Answering this safely requires its own careful design (typically: require the existing account's password to *link* an OAuth identity to it, never link silently on email match alone) — real, non-trivial work that buys nothing yet, since Module 2 has exactly one real population of users (LYNQ's own team) and zero external customers today.

### Recommendation: OAuth only (Google + Microsoft) for Module 2's launch

This is not a cost-minimizing choice — it is recommended because it removes entire categories of the threat model in §2 for free (no credential stuffing, no brute force, no password-reset abuse, no compromised-password checks, no password-hashing-parameter risk), which is a genuine security improvement, not a shortcut. Specifically:

- **GitHub is deliberately deferred**, narrowing your three-provider list to two. GitHub is a *developer*-identity provider; LYNQ's Company OS envisions this platform serving Marketing, Sales, Finance, and Client Success as much as Engineering — those users are far less likely to have or want a GitHub identity for a business operations tool. Google and Microsoft alone already cover the realistic range of both LYNQ's own team today and prospective external companies later (Google Workspace and Microsoft 365 are the two dominant business-email ecosystems). GitHub can be added later with no schema change if a genuine developer-audience need appears.
- **Credentials are deferred to a distinct, later module**, not dropped permanently. The `accounts` table design (§6) already makes adding it additive rather than a rewrite. It should return once there's real external-customer demand — specifically, a prospective customer whose IT policy prohibits linking a personal or work Google/Microsoft account to third-party tools, which does happen in some enterprise contexts.
- **A managed provider remains the right call later, not now** — specifically once external SaaS customers exist and enterprise SSO becomes a live sales conversation (Company OS's Future SaaS Vision, Roadmap Phase 10), not before that pressure is real. This is a values-based tradeoff (near-term control and no recurring vendor dependency, versus long-term convenience), not a cost-avoidance one — worth stating plainly since a managed provider was explicitly not to be ruled out on cost alone.

**This recommendation is not authorized for implementation until explicitly approved.**

---

# 2. Threat model

Threats specific to password-based credentials are retained below but marked **deferred** — designed now so nothing needs to be redesigned when credentials ships as its own later module, not mitigated in Module 2's actual launch surface.

| Threat | Mitigation | Status for Module 2 |
|---|---|---|
| Credential stuffing | Per-account and per-IP rate limiting; compromised-password check (§4). | Deferred — not applicable without a password. |
| Brute-force login attempts | Rate limiting, progressive delay (§4). | Deferred. |
| Account enumeration | Identical response wording/timing regardless of account existence. | Still applies to OAuth-adjacent flows (invitation acceptance, e.g.) — retained. |
| Session theft | `httpOnly` + `Secure` + `SameSite=Lax`, short-lived DB-backed sessions (§5), hashed token at rest. | Active — applies regardless of login method. |
| Session fixation | A new session is always issued after a successful OAuth callback — never promoted from a pre-auth state. | Active. |
| CSRF | `SameSite=Lax` plus explicit Origin/Referer verification on state-changing requests. | Active. |
| Open redirects | Post-login redirect targets checked against an allow-list of internal relative paths only. | Active — and doubly relevant for OAuth, since the callback URL itself is a classic open-redirect target if mishandled (see below). |
| Password-reset abuse | Rate-limited, generic response, single-use hashed tokens (§4). | Deferred. |
| Email-verification abuse | Rate-limited resend, single-use tokens. | Deferred — OAuth providers verify email ownership before issuing identity, removing the need for our own verification email at launch. |
| **OAuth redirect-URI / callback tampering** | The callback URL is validated against an exact, pre-registered allow-list on both our side and the provider's side — never dynamically constructed from request input. | **Active, new for this revision.** |
| **OAuth `state` parameter CSRF** | A cryptographically random `state` value is generated per authorization attempt, stored server-side (or in a short-lived signed cookie) tied to the initiating session, and verified on callback before any token exchange proceeds. | **Active, new for this revision.** |
| **Account-linking confusion** | Module 2 launches with two live OAuth providers at once (§1), so this is a real, present threat, not a future one. Mitigated by the account-linking policy implemented in Step 3 (see MODULE_2_STEP_3_OAUTH_SESSION_DESIGN.md §6): an unverified provider email is never used to match an existing user; a verified-email match from an unauthenticated request always stops at a conflict rather than auto-linking; linking only ever happens from an already-authenticated session via an explicit `/api/auth/link/[provider]` action, re-verified against the current session's own user. | **Active — implemented in Step 3, corrected further during Step 3's security-correction pass (Microsoft's email is never treated as verified, closing a gap in the original reasoning).** |
| **OAuth provider outage** | If Google or Microsoft's own auth service is down, sign-in for accounts on that provider is unavailable — no workaround exists without a second login method. Accepted as a real, disclosed tradeoff of the OAuth-only launch strategy, not silently ignored. | **Active — accepted risk, not a gap.** |
| Unauthorized organization access | Server-verified organization membership on every operation, never a client-supplied ID alone (§8). | Active. |
| Unauthorized workspace access | Explicit `workspace_memberships` check, independent of organization role (§6, §7). | Active. |
| Role escalation | Role changes are themselves authorized; no self-role-change; admins can never act on an owner (§7). | Active. |
| IDOR | Every tenant-scoped query filtered by an already-verified organization/workspace ID (§8). | Active. |
| Invitation abuse | Single-use hashed tokens, expiration, per-organization rate limiting, revocation (§9, §11). | Active. |
| Stale or revoked access | Sessions checked live against the database on every request (§5). | Active. |
| Cross-tenant data exposure | No endpoint trusts a bare tenant ID; every query derives its scope from the caller's verified memberships (§8). | Active. |

---

# 3. Authentication lifecycle

Revised for the OAuth-only launch. The credentials-specific lifecycle from the prior revision (password reset, email-address change via password flow, etc.) is retained in full in §4 as a specified-but-deferred reference for the later credentials module, not repeated here.

- **Sign-up (first sign-in)** — the user clicks "Continue with Google" or "Continue with Microsoft"; on a successful OAuth callback, if no `accounts` row exists for that `(provider, provider_account_id)`, a new `users` row and matching `accounts` row are created in one operation, using the verified email and name the provider supplies. There is no separate "create an account" step distinct from the first login.
- **Email verification** — not a separate step. The identity provider has already verified the email before ever returning it to us; `users.email_verified_at` is set directly from the successful OAuth callback.
- **Sign-in** — the OAuth callback is validated (state parameter, token exchange, provider signature) before anything else happens; on success, a brand-new session is issued (never reused from a pre-auth state) and an audit event is recorded.
- **Sign-out** — the current session's database row is deleted immediately; clearing the cookie client-side alone is insufficient, since a copied cookie would otherwise remain valid.
- **Session renewal** — sliding: activity extends the session, up to an absolute maximum regardless of activity (recommended: 30 days — see §7 for the reasoning).
- **Session expiration** — enforced by comparing `expires_at` on every lookup; an expired row is treated as absent.
- **Session revocation** — explicit sign-out, or a forced revocation, deletes the row immediately. "Sign out everywhere" deletes every session row for that `user_id`.
- **Forgot password** — not applicable; there is no password to forget in the OAuth-only launch.
- **Email-address change** — not a self-service flow in Module 2. A user's email is whatever their OAuth provider reports; changing it means changing it at the provider (e.g., in Google's own account settings), which naturally flows through on next sign-in. A dedicated in-app email-change flow becomes relevant once credentials exist.
- **Account deletion** — soft delete: login is blocked and all sessions revoked immediately; personal data hard-purged after the grace period in §13.
- **Recovery when email/provider access is lost** — deliberately manual and human-in-the-loop (Founder's Office), for the same reason given previously: automating identity recovery without a human check is how a recovery feature becomes a takeover feature. This is now *more* important, not less, under OAuth-only, since there is no password-reset fallback at all if the actual concern is provider-account access, not a forgotten password.

---

# 4. Password security (specified now, deferred until credentials ships)

Retained in full from the prior revision, unchanged, since §1 recommends deferring credentials as a *launch* method, not abandoning the design. Implementing this section is explicitly **out of scope for Module 2** and becomes the first step of the future credentials module.

- **Hashing algorithm**: Argon2id.
- **Exact parameters** (to be benchmarked against Vercel's serverless constraints when this module actually begins — not before): memory cost 19 MiB (`m=19456`), time cost `t=2`, parallelism `p=1`.
- **Password requirements**: 12-character minimum, 128-character maximum, no forced complexity rules.
- **Compromised-password checks**: Have I Been Pwned Pwned Passwords API, k-anonymity range query.
- **Rate limits**: 5 sign-in attempts per 15 minutes, keyed by account and IP.
- **Lockout strategy**: progressive delay, not hard lockout (avoids the griefing/DoS failure mode of hard lockout).
- **Reset-token generation and storage**: 32-byte CSPRNG value; only its SHA-256 hash persisted.
- **Token expiration and one-time use**: 1 hour for password reset; consumed atomically.
- **Password-change session revocation**: every session for that user revoked the moment a password change succeeds.

**Never**: plaintext or reversible passwords, or raw (unhashed) tokens, stored anywhere — this rule applies from the moment credentials is built, with no grace period.

Per §6's revised table-justification review, `accounts.password_hash` is **not** part of Module 2's schema — adding one nullable column to a still-small table is a trivial, low-risk change whenever this module actually begins, and carrying an always-null column until then was speculative, not justified.

---

# 5. Session architecture

**Session expiration model corrected during Step 3's security-correction pass** — see below; everything else is unchanged from the prior revision.

### Database sessions vs. JWT — recommendation: database-backed sessions

A JWT can't be revoked before its own expiry without a separate revocation-list mechanism, which ends up requiring a database lookup anyway. Since Module 1 already provisioned a real Postgres database, the "DB sessions don't scale" argument doesn't apply, and the benefit is direct: a revoked session takes effect on the *very next request*.

- **Cookie name**: `__Host-lynq_session` — enforces `Secure`, `Path=/`, no `Domain` attribute.
- **Secure**: always true.
- **HttpOnly**: always true.
- **SameSite**: `Lax`.
- **Expiration**: **idle lifetime 7 days, absolute lifetime 30 days from `sessions.created_at`, corrected from this section's original "30 days absolute" wording** (§17 item 4 updated to match). On valid activity, `newExpiresAt = min(now + 7 days, created_at + 30 days)` — never extended past the absolute cap, no matter how much activity occurs. See MODULE_2_STEP_3_OAUTH_SESSION_DESIGN.md §8 for the exact implementation, including a real bug this correction pass found and fixed (a renewal computed after the absolute cap had already passed was silently applying an already-expired timestamp instead of correctly treating the session as dead).
- **Rotation**: a new session is issued on every successful OAuth callback.
- **Revocation**: deleting the database row is immediate and total.
- **Concurrent-device sessions**: allowed by default — independently trackable and revocable per device.
- **"Sign out all devices"**: deletes every session row for the `user_id`.
- **How sessions are audited**: creation and revocation are audit events (§10); device/IP/user-agent captured at creation only.

---

# 6. Tenant model

No migrations are generated from this section. Every table below is justified against a real Module 2 need, not against "what an auth library's adapter schema normally includes" — see the note at the end of this section on what was deliberately cut for exactly that reason.

### `users`
- **Why it exists**: LYNQ needs to identify the same person consistently across sessions, organizations, and audit history, independent of which OAuth provider they happened to sign in with today. This is the one identity every other table hangs off of.
- **Primary relationships**: none outbound. It is the root of the tree — `accounts`, `sessions`, memberships, and `audit_logs` all point *to* `users`, never the reverse.
- **Unique constraints**: `email` (case-insensitive). Justification: an email address is the one piece of identity both Google and Microsoft agree on and both have already verified before we see it — using it as the de-duplication key is what lets the same person be recognized as the same `users` row whether they sign in with Google today and Microsoft tomorrow (a real, present Module 2 scenario — see `accounts` below). Enforced at the database level by `users_email_lower_unique`, a functional unique index on `lower(email)` (not a plain unique constraint on the raw column) — added in the Module 2 schema-hardening pass; see §19. Application-level normalization on input remains as defense-in-depth, not the sole guarantee.
- **Indexes**: the unique index on `lower(email)` already serves the one real lookup this table needs (matching an incoming OAuth email to an existing user, and enforcing the invitation-acceptance match in §9). No additional index is justified at Module 2's scale — a handful to low hundreds of rows.
- **Expected query patterns**: point lookup by `id` (every authenticated request) and by `email` (OAuth callback, invitation acceptance). No range scans, no listing-all-users query exists yet in Module 2's actual feature set.
- **Future scalability**: this table grows linearly with headcount, not with activity — even a large customer base is a small table by database standards. No partitioning or archival strategy is warranted; the only real future concern is the soft-delete/purge cycle in §14, which is a retention-policy question, not a scale question.

### `accounts`
- **Why it exists**: Module 2 launches with **two** live OAuth providers at once (§1). A real person can plausibly sign up with Google, then later sign in with Microsoft using the same work email, and both should resolve to the same `users` row rather than silently creating a duplicate account. That requires a login method to be its own row, separate from the person — this is a genuine, present-day Module 2 requirement, not a speculative one bought for a future credentials method that doesn't exist yet.
- **Primary relationships**: `user_id` → `users.id`. Justification: an account row is meaningless without the person it authenticates — deleting the user must take its accounts with it.
- **Unique constraints**: composite `(provider, provider_account_id)` — the same Google account must never be linkable to two different LYNQ users, which would silently merge two people's data. Composite `(user_id, provider)` — a person should not accidentally end up with two separate Google links racing each other; one provider per user is the intended shape today.
- **Indexes**: both unique constraints above are backed by indexes as a side effect of being unique constraints; `(user_id, provider)` has `user_id` as its leading column, so it also efficiently serves "list every login method linked to this user" (a real, near-term settings-page need) without a separate index.
- **Expected query patterns**: point lookup by `(provider, provider_account_id)` on every OAuth callback (the highest-frequency query this table sees); occasional lookup by `user_id` to render "connected accounts."
- **Future scalability**: grows in step with `users`, at most 1–2 rows per person today. No concern at any realistic scale.

### `sessions`
- **Why it exists**: §5's whole recommendation — instant, database-verified revocation instead of trusting an unrevokable token — only works if a session is a real, queryable row. This table *is* that mechanism, not incidental to it.
- **Primary relationships**: `user_id` → `users.id`, cascading on user deletion (a deleted user's sessions have no reason to persist).
- **Unique constraints**: `token_hash` — this is the only thing a request presents; it must resolve to exactly one session or the whole model breaks.
- **Indexes**: unique index on `token_hash` (validates a session on literally every authenticated request — the single hottest query in the entire schema). A **separate** index on `user_id` is justified independently: "sign out everywhere" (§5) deletes every row for a `user_id`, and without this index that operation would require a full table scan as the table grows. A **separate** index on `expires_at` is justified for the cleanup job that removes expired rows — without it, finding "everything past expiry" degrades as the table grows, since expiry, not user, is that query's filter.
- **Expected query patterns**: point lookup by `token_hash` (every request); bulk delete by `user_id` (sign-out-everywhere, and cascade on user deletion); range scan on `expires_at` (periodic cleanup).
- **Future scalability**: this is the fastest-growing table of the human-identity group — every login adds a row. Its size is self-limiting *only if* the expiry-cleanup job actually runs on schedule; if that job is ever skipped or fails silently, this table accumulates dead rows indefinitely. Worth flagging as an operational dependency to monitor, not a schema problem.

### `organizations`
- **Why it exists**: the tenant boundary everything else scopes against — even LYNQ itself, as the first real organization, needs this row to exist before a single workspace can be created.
- **Primary relationships**: none outbound; every tenant-scoped table below points to it.
- **Unique constraints**: `slug` — needed the moment a URL or subdomain needs to identify an organization unambiguously; also the natural place to prevent two organizations from colliding on a human-chosen identifier.
- **Indexes**: the unique index on `slug` is sufficient. No secondary index is justified — Module 2 has no "list all organizations" query in its own feature set (a platform-wide admin console is a later concern, not built here).
- **Expected query patterns**: point lookup by `id` (near-universal — organization ID accompanies almost every tenant-scoped request) and by `slug` (routing).
- **Future scalability**: low cardinality even under real growth (companies, not users) — never a scale concern on its own.

### `organization_memberships`
- **Why it exists**: this is the table §8's authorization chain actually reads on every protected request — "does this authenticated user belong to this organization, and with what role" is not answerable from `users` or `organizations` alone.
- **Primary relationships**: `organization_id` → `organizations.id`, `user_id` → `users.id`, both cascading — a membership has no meaning once either side is gone.
- **Unique constraints**: composite `(organization_id, user_id)` — one role per person per organization; a second row for the same pairing would create an ambiguous "which role applies" question that has no correct answer.
- **Indexes**: the composite unique, with `organization_id` leading, serves both the highest-frequency query (the per-request authorization check, which always has both IDs in hand) and "list every member of organization X" (an admin member-list view) without needing a second index. A **separate** index on `user_id` alone is justified for the reverse direction — "list every organization this user belongs to," needed to render an organization switcher at login — which the composite index (leading with `organization_id`) cannot serve efficiently on its own.
- **Expected query patterns**: point lookup by `(organization_id, user_id)` on nearly every request; range scan by `organization_id` (member list); range scan by `user_id` (org switcher, once per session).
- **Future scalability**: grows with (organizations × average team size) — real but bounded growth, no different in character from `users` itself.

### `workspaces`
- **Why it exists**: the Company OS's department/client-workspace model (Marketing, a specific client engagement) needs a real row to attach content and membership to — this is a near-term, not speculative, need given Module 2 exists specifically to make department-level workspaces real.
- **Primary relationships**: `organization_id` → `organizations.id`, cascading with the parent organization's own deletion timeline.
- **Unique constraints**: composite `(organization_id, slug)` — a workspace identifier only needs to be unique *within* its organization, not globally, since two unrelated organizations having their own "marketing" workspace is expected and harmless. A second composite unique constraint, `workspaces_id_org_unique UNIQUE(id, organization_id)`, was added in the schema-hardening pass — not a business uniqueness rule (a row's own `id` is already globally unique on its own), but a structural requirement: Postgres requires a unique constraint on any column set a composite foreign key references, and `invitations` now references exactly this pair (see `invitations` below and §19).
- **Indexes**: the composite unique, with `organization_id` leading, also serves "list every workspace in organization X" (a workspace-switcher/sidebar view) directly — no additional index justified at Module 2's scale.
- **Expected query patterns**: point lookup by `(organization_id, id)`; range scan by `organization_id` (workspace switcher).
- **Future scalability**: bounded by (organizations × departments/clients per organization) — a small multiple of the `organizations` table's own growth, not an independent scaling concern.

### `workspace_memberships`
- **Why it exists**: the explicit, non-inherited access grant that is the entire point of the "organization membership does not imply workspace access" decision already approved — without this table as a real, queryable row, that design principle would just be a sentence in a document with nothing enforcing it.
- **Primary relationships**: `workspace_id` → `workspaces.id`, `user_id` → `users.id`, both cascading.
- **Unique constraints**: composite `(workspace_id, user_id)` — one role per person per workspace, same reasoning as `organization_memberships`.
- **Indexes**: the composite unique (leading with `workspace_id`) serves both the per-request authorization check and "list members of this workspace." A **separate** index on `user_id` serves "list every workspace this user can access," needed for a workspace switcher — the same reasoning as `organization_memberships`'s reverse-lookup index, applied one level down.
- **Expected query patterns**: identical shape to `organization_memberships`, one level down the tenancy tree.
- **Future scalability**: bounded by (workspaces × average workspace team size) — smaller in practice than `organization_memberships`, since not every org member gets access to every workspace by design.

### `invitations`
- **Why it exists**: LYNQ has more people to onboard than a single founder can manually provision accounts for — this is a real, immediate operational need (getting a second department lead or teammate into the platform at all), not a nice-to-have.
- **Primary relationships**: `organization_id` → `organizations.id`; `invited_by_user_id` → `users.id`, so an invitation's origin is always traceable. `workspace_id` is **not** a plain single-column foreign key to `workspaces.id` — it is nullable (an invitation may be organization-only) and enforced by the composite foreign key `invitations_workspace_org_fk FOREIGN KEY (workspace_id, organization_id) REFERENCES workspaces(id, organization_id)`, added in the schema-hardening pass. This is what actually prevents an invitation from naming a workspace that belongs to a *different* organization than the one in the same row's `organization_id` — a gap the original single-column FK did not close (§19). Postgres's `MATCH SIMPLE` semantics correctly skip the check when `workspace_id IS NULL`. Uses `ON DELETE CASCADE`, not the original `SET NULL`, because a composite FK's delete action applies to every column in its local list and `organization_id` is `NOT NULL` — `SET NULL` on this composite FK would fail at delete time (§19).
- **Unique constraints**: `token_hash` — the only thing an acceptance request presents. Partial unique `(organization_id, email)` **where `status = 'pending'`** — this is what actually prevents duplicate simultaneous invitations (§9); it is intentionally *not* a plain unique constraint, since a person can legitimately be invited, decline or let it expire, and be invited again later.
- **Indexes**: `token_hash`'s unique index serves acceptance (highest-frequency query on this table). The partial unique index, leading with `organization_id`, also serves "list pending invitations for organization X" (an admin's outstanding-invites view) directly.
- **Expected query patterns**: point lookup by `token_hash` (acceptance); range scan by `organization_id` filtered to pending (admin view).
- **Future scalability**: naturally small and self-limiting — invitations become `accepted`/`revoked`/`expired` and are purged per §14; this table is never expected to hold more than a small multiple of the organizations that use it at any given time.

### `audit_logs`
- **Why it exists**: §2's threat model and §10's event list are not real protections unless every one of those events actually produces a durable, queryable record — this table *is* the record, required from the very first `oauth_login_success` on day one of Module 2, not a later addition.
- **Primary relationships**: `organization_id` → `organizations.id` (nullable — some events, like a failed OAuth callback for an unrecognized email, precede any organization context), `SET NULL` on delete, not cascade, so the historical record outlives an organization that's later removed. `actor_user_id` → `users.id`, same `SET NULL` reasoning — the log must outlive the person it describes.
- **Unique constraints**: none — an append-only log has no natural uniqueness beyond its own `id`.
- **Indexes**: a composite index on `(organization_id, created_at)` is justified by the single most likely real query — "show recent activity for this organization," which needs both the tenant filter and chronological ordering to be efficient together, not served well by either column indexed alone. A separate index on `actor_user_id` is justified for "show everything this specific person did," a real security-investigation query distinct from the organization-scoped one.
- **Expected query patterns**: append-only writes (the dominant operation by volume); range scan by `(organization_id, created_at DESC)` for activity views; range scan by `actor_user_id` for incident investigation.
- **Future scalability**: by a wide margin, the fastest-growing table in this schema — it is the one place explicitly designed to accumulate indefinitely (§14's retention policy is deliberately long). This is the table most likely to eventually need a real scalability plan of its own — most naturally, partitioning by `created_at` (e.g., monthly partitions) once volume justifies it, which is an additive operational change consistent with this platform's "evolution, not rewrite" discipline, not a schema redesign.

### What was deliberately not created, and why

Two items from the prior revision do not survive the "real business justification, not library convenience" test and are cut from Module 2's actual migration:

- **`verification_tokens`** — this table exists in essentially every auth-library adapter schema, but nothing in Module 2's OAuth-only launch reads or writes it: OAuth providers verify email ownership themselves, and there is no password to reset. Creating it now would be exactly the pattern flagged — a table justified by "the library supports it," not by a present LYNQ need. It is not created. When the credentials module actually begins, adding it is a single new, unrelated table with no backfill required — a normal, low-risk additive migration at that time, not something worth paying for today.
- **`accounts.password_hash`** — the previous revision added this nullable column "to avoid a later `ALTER TABLE`." That reasoning doesn't hold up under scrutiny: adding one nullable column to a table that will still be small when credentials actually ships is a trivial, safe, additive change whenever it happens. Carrying an always-null column for a feature that doesn't exist yet is speculative, not justified. It is not created now.
- **`audit_logs.actor_type`** — added in the prior revision "for future non-human identities" (§13), but no event Module 2 actually produces is ever anything other than a real, logged-in human — there is no present case to distinguish. Adding a defaulted enum column later, when a non-human identity genuinely exists for the first time, is an equally trivial additive migration. It is not created now. §13's discussion of how this *would* be added later stands unchanged as a design note — only the premature schema addition is removed.
- **`feature_flags`** — never part of this design's scope in the first place, and re-confirmed as deferred in the schema-hardening pass (§19): it is not part of authentication or tenancy, and nothing in Module 2's actual feature set depends on it. Adding it later, when a real need exists, is a normal additive migration, not a decision that needs to be made now.

This leaves **nine** tables in Module 2 Step 2's actual migration: `users`, `accounts`, `sessions`, `organizations`, `organization_memberships`, `workspaces`, `workspace_memberships`, `invitations`, `audit_logs`. **A tenth, `rate_limit_counters`, was added in Step 3** to back the provider-agnostic rate-limiter interface (§11) — see §19 and MODULE_2_STEP_3_OAUTH_SESSION_DESIGN.md §1 for the full justification. The application schema now totals **ten** tables.

---

# 7. Role and permission model

### Organization roles — unchanged

`owner`, `admin`, `member`, `viewer`, as originally specified.

### Workspace roles — simplified

Three options were compared:

- **Option A** — `workspace_admin` / `workspace_member` / `workspace_viewer`: functionally a direct reuse of the org-level naming at workspace scope.
- **Option B** — `manager` / `member` / `viewer`: the same three-tier shape, deliberately fresh terminology at the top tier.
- **Option C** — access-only, with permissions inherited entirely from the organization role once a `workspace_membership` grants access at all.

**Option C is rejected**: it cannot express a real, already-anticipated use case — the Company OS explicitly describes department leads who run one specific workspace day-to-day while holding an ordinary `member` role at the organization level overall. Under Option C, that person's authority in their own department would be capped by their general org role, with no way to grant them elevated authority *scoped to just their workspace*. Losing that expressiveness to save one enum value is the wrong trade.

**Option A is rejected in favor of Option B**: reusing the word "admin" at both organization and workspace scope invites a real, security-relevant misunderstanding — a reader (or a future engineer wiring up a check) could reasonably assume a `workspace_admin` carries the same authority as an organization `admin`, when it categorically does not (it governs exactly one workspace). Distinct terminology makes the scope boundary visible at a glance rather than requiring the reader to remember which "admin" is which.

**Recommendation: `manager` / `member` / `viewer`** — the smallest model that still supports the real department-lead use case, with no `owner` tier at the workspace level at all. A workspace doesn't need its own ownership-transfer or billing-adjacent concept the way an organization does; ultimate authority over a workspace's existence stays with organization-level `owner`/`admin` via the admin-override pattern below, so a workspace `manager` role covers "runs this workspace day to day" without redundantly duplicating org-level ownership.

This still fully preserves every required property:
- **Explicit workspace membership** — unchanged; a `workspace_memberships` row is still the only path to access.
- **No automatic workspace access from organization membership** — unchanged.
- **Organization owners/admins may administer workspace membership without automatically seeing content** — unchanged; the admin-override pattern below is independent of which role set the workspace itself uses.
- **Least privilege** — improved, if anything: dropping a workspace-level `owner` removes one more tier of standing authority that was never actually needed.
- **A clean migration path to finer permissions later** — unchanged: this is a plain enum column on `workspace_memberships`; replacing or supplementing it with a fuller per-action permission system later is additive, not a restructuring of the entity relationships themselves.

### Revised permission matrix

| Action | Org Owner | Org Admin | Org Member | Org Viewer |
|---|---|---|---|---|
| View organization | ✅ | ✅ | ✅ | ✅ |
| Update organization | ✅ | ✅ | ❌ | ❌ |
| Delete organization | ✅ | ❌ | ❌ | ❌ |
| Manage billing | ✅ | ❌* | ❌ | ❌ |
| Invite members | ✅ | ✅ | ❌ | ❌ |
| Remove members | ✅ | ✅† | ❌ | ❌ |
| Change roles | ✅ | ✅† | ❌ | ❌ |
| Create workspaces | ✅ | ✅ | ❌ | ❌ |
| Delete workspaces | ✅ | ✅ (override) | ❌ | ❌ |

| Action | Workspace Manager | Workspace Member | Workspace Viewer | Org Owner/Admin (no workspace membership) |
|---|---|---|---|---|
| View workspace | ✅ | ✅ | ✅ | ❌ — content access always requires an explicit workspace membership, with no exception |
| Contribute workspace content | ✅ | ✅ | ❌ | ❌ |
| Update workspace settings | ✅ | ❌ | ❌ | ✅ (override) |
| Manage workspace membership | ✅ | ❌ | ❌ | ✅ (override) |
| Delete the workspace | ❌ | ❌ | ❌ | ✅ (override only — no workspace role, including manager, can delete its own workspace) |

\* Owner-only, per §14's confirmed default.
† Subject to the edge cases below.

A workspace **cannot delete itself from within** at any role, including `manager` — that authority is reserved entirely for organization-level `owner`/`admin`, a deliberate additional safety rail: the person running a workspace day to day should never be one click away from destroying it without an organization-level check.

### Edge cases — unchanged

- There must always be at least one organization owner; removal/demotion is rejected if it would leave zero.
- An owner cannot remove the final owner, including themselves.
- No user may change their own role.
- An admin can never remove or demote an owner.
- Organization membership never implies workspace access.
- Workspace access is always an explicit grant.

---

# 8. Authorization architecture

Unchanged in substance from the prior revision — the chain, the helper contracts, and the IDOR/cross-tenant reasoning all remain exactly as designed, independent of authentication method or the workspace role rename. One addition: `requireRole` now accepts either the organization role enum or the workspace role enum depending on context, since the two are no longer the same set of values (§7) — callers must be explicit about which scope they're checking, which is itself a small additional safety property: it's no longer possible to accidentally compare an organization role against a workspace-scoped permission requirement, since the two enums are now typed differently.

---

# 9. Invitation flow

Unchanged in structure from the prior revision, with the acceptance step adapted to OAuth:

- **Existing-user acceptance** — the invited person signs in with Google/Microsoft as normal; if the resulting account's email matches the invitation, the membership rows are created directly.
- **New-user acceptance** — the invited person is prompted to continue with Google/Microsoft using the invited address; the first-sign-in flow (§3) and the membership creation happen together, atomically, exactly as the prior revision described for the credentials case.
- Token generation, hashing, expiration (7 days), single-use enforcement, revocation, duplicate-prevention, and role-assignment limits are all unchanged from the prior revision (§9 there).
- **Refreshing an expired-but-still-`pending` invitation** — the partial unique index `invitations_org_email_pending_unique` (`WHERE status = 'pending'`) only reads the `status` column; it cannot itself distinguish "genuinely still pending" from "expired but never transitioned to `expired`." Invitation creation must therefore check-and-refresh atomically, in one statement — `INSERT ... ON CONFLICT (organization_id, email) WHERE status = 'pending' DO UPDATE SET token_hash = ..., expires_at = ..., status = 'pending'` — never a separate read-then-write, which would race under concurrent requests. This is a schema-hardening-pass finding (§19); **implemented as Step 4C**, proven under real concurrent duplicate-creation requests — see MODULE_2_STEP_4C_INVITATIONS_API_REFERENCE.md.

---

# 10. Audit events

The original event list is retained in full, with OAuth-specific events added and the two credentials-only events explicitly marked deferred. **Updated during Step 3's implementation and its security-correction pass** to add three events the original list didn't anticipate: `oauth_link_conflict`, `oauth_account_linked` (both added once Step 3's account-linking policy was actually designed — §6's linking flow can't be honestly audited by `oauth_login_success`/`oauth_login_failure` alone), and `oauth_provider_unavailable` (added during the correction pass specifically so a provider outage — a network failure or 5xx reaching Google/Microsoft — is queryable separately from an actively invalid or suspicious request; see MODULE_2_STEP_3_OAUTH_SESSION_DESIGN.md §12 for the full reconciled table):

`sign_up` (first OAuth sign-in), `oauth_login_success`, `oauth_login_failure` *(an actively invalid/suspicious request — bad state/nonce, forged or invalid ID token, rejected code; never includes provider tokens, ID tokens, state, nonce, PKCE verifiers, or secrets)*, `oauth_link_conflict` *(a verified or attempted email match stopped for human-safe resolution rather than auto-linked)*, `oauth_account_linked` *(an authenticated, explicit provider-linking action succeeded)*, `oauth_provider_unavailable` *(the provider itself was unreachable or returned a server error — distinct from an invalid request)*, `logout`, `session_revoked`, `organization_created`, `organization_updated`, `organization_deleted`, `membership_added`, `membership_removed`, `role_changed`, `workspace_created`, `workspace_updated`, `workspace_deleted`, `workspace_access_added`, `workspace_access_removed`, `workspace_role_changed`, `authorization_denied` *(never includes session tokens, OAuth tokens, raw invitation tokens, secrets, or database connection details — only a machine-readable `action`/`reason` pair and the relevant IDs, per Step 4A's audit-metadata rule)*.

Deferred until the credentials module: `verification_sent`, `email_verified`, `login_failure` (password-specific), `password_reset_requested`, `password_changed`.

`authorization_denied` remains logged for every rejected authorization check, not just successes — unchanged reasoning from the prior revision.

---

# 11. Rate limiting

### Provider-agnostic interface

Authentication and invitation logic depend on this interface, never on a specific backend directly:

- **`checkLimit(key, config): Promise<{ allowed: boolean; remaining: number; resetAt: Date }>`** — a **read-only** check against the current count for `key`. Does not itself increment anything. Useful for surfacing "N attempts remaining" without consuming an attempt, but **must never be relied on as the sole gate before a sensitive action** — it is not atomic with the action itself, so a check-then-act pattern built on `checkLimit` alone would race under concurrent requests.
- **`recordAttempt(key, config): Promise<{ allowed: boolean; remaining: number; resetAt: Date }>`** — the actual enforcement point. Atomically increments the counter for `key` within its current window (creating the window if absent or expired) **in a single backend operation**, and returns whether this attempt is within limit. Callers make their real allow/deny decision from *this* return value, not from a prior `checkLimit` call.
- **`resetLimit(key): Promise<void>`** — clears a key's counter immediately, e.g. called after a successful sign-in to reset that account's failed-attempt counter so a later, unrelated failure doesn't inherit a stale count.

The initial backend is Postgres (reusing Module 1's provisioned database); authentication and invitation code call only these three functions and never touch a SQL statement or a Redis client directly, so a future move to Upstash Redis or another provider is a swap of the implementation behind this interface, not a change to any calling code.

- **Key structure**: `{scope}:{action}:{identifier}` — e.g. `oauth:signin:account:user@example.com`, `oauth:signin:ip:203.0.113.5`, `invitation:create:org:org_abc123`. A composite, string-based key lets the same three functions serve per-account, per-IP, and per-organization limits uniformly.
- **Atomicity requirements**: `recordAttempt`'s backend implementation must perform the increment-and-read as one atomic statement (e.g., Postgres `INSERT ... ON CONFLICT (key) DO UPDATE SET count = count + 1 ... RETURNING count`) — never a separate `SELECT` followed by an `UPDATE`, which races exactly as described above.
- **Expiration-window behavior**: fixed window (a `window_start` timestamp plus a count, reset once `now() > window_start + windowSeconds`), chosen for implementation simplicity. A sliding window or token-bucket algorithm is a valid future refinement if fixed-window's edge-burst behavior (up to roughly double the stated limit right at a window boundary) becomes a real problem in practice — not necessary to start.
- **Failure behavior when the backend is unavailable**: **fails closed for authentication endpoints** — if the rate-limit backend cannot be reached, sign-in and OAuth-callback handling reject the request with a generic "try again shortly" error rather than silently proceeding unprotected. This is a direct answer to your instruction: failing open here is precisely the "silently disabling protection" scenario to avoid, and an attacker who can degrade the rate-limit backend should not thereby gain an unprotected path to credential/OAuth abuse. For lower-stakes actions (e.g., invitation creation), a brief fail-open with alerting is a defensible exception if availability pressure justifies it later, decided case by case — but the *default* posture, everywhere, is fail-closed unless a specific endpoint earns an exception.

### Confirmed starting limits (tunable — see §14)

| Action | Limit | Key |
|---|---|---|
| OAuth sign-in attempt | 10 / 15 min | account **and** IP |
| Invitation creation | 20 / hour | organization |
| Invitation acceptance attempt | small fixed cap | IP |

(Sign-up, verification-resend, forgot-password, and password-reset limits from the prior revision are retained in §4 for the deferred credentials module.)

---

# 12. Knowledge ownership boundaries

How future Brain (LYNQ_BRAIN.md) knowledge is authorized *within* this tenancy model. **Not implemented in Module 2** — this section exists so the tenant and authorization model doesn't need to change shape when Brain-domain permissions are actually built.

Each Brain knowledge domain (Identity, Offerings, Market, Execution, Growth, Governance, Capability, Wisdom — per the Brain's own architecture) will require, per organization:

- **An owning department** — mirrors the Company OS's department structure. Note: "department" is not yet its own schema entity in Module 2; this is explicitly forward-looking, tying together three pieces (departments, Brain-domain grants, and this tenancy model) that don't all exist yet.
- **Allowed readers** — who can read that domain's Approved-tier content.
- **Allowed draft writers** — who can write Draft/Working-tier content (never directly to Approved, per the Brain's lifecycle — Brain §5).
- **Human approvers** — specific named individuals who can promote Draft to Approved for that domain, not a role, matching the Brain's stance that promotion always requires a human.
- **Archive authority** — who can archive an entry.
- **Delete/purge authority** — reserved for the strictest tier: Founder's Office plus Security & Trust jointly, exactly as the Brain already specifies (Brain §11).

### How organization and workspace access interact with Brain-domain permissions

A Brain-domain grant is a **fourth, independent gate**, layered on top of — never replacing — the existing chain from §8: to read or write a piece of Brain knowledge, a request must satisfy, in order: (1) authentication, (2) organization membership, (3) workspace membership where the domain is workspace-scoped, and (4) an explicit Brain-domain grant for that specific domain and access level. No user or agent ever gains broad Brain write access merely by belonging to an organization, or even by belonging to the relevant workspace — the Brain-domain grant is its own explicit, separately-authorized thing, following the exact same "explicit, never inherited" philosophy already established for `workspace_memberships`.

When this is actually built (a later module, not Module 2), the natural shape is a `brain_domain_grants` table (`organization_id`, `domain`, `user_id`, `access_level`) — purely additive to everything Module 2 creates; no existing table needs to change shape to support it.

---

# 13. Non-human identities

Extending the tenancy and authorization design to anticipate AI agents, workflows, service accounts, and API clients (Agent Framework §3, §5) — **not fully implemented in Module 2 unless a concrete need arises first.**

### How they differ from human users

- **No interactive login** — a service account or agent authenticates via a rotatable credential (an API key or similar secret), never via OAuth or a password. It should not be forced through the human-shaped `accounts`/`sessions` tables at all.
- **Scoped credentials** — a credential is tied to specific, narrow permissions from the moment it's created, never defaulting to broad access.
- **Explicit organization and workspace access** — the same explicit-grant philosophy as human `workspace_memberships`; no automatic inheritance for a non-human identity either.
- **Narrow permissions** — least-privilege by default, typically narrower than even the human `member` role — scoped to exactly the one task the identity exists for.
- **Rotation and revocation** — unlike a session, a service-account credential is long-lived and more prone to leaking (e.g., checked into a repository by mistake); it must be easy to rotate on a schedule and to revoke instantly.
- **Separate audit identity** — an agent or service account's actions must be clearly distinguishable in `audit_logs` from a human's — never disguised as "the user did X" when it was actually "the agent did X." This directly restates the Agent Framework's own requirement (Agent Framework §11 logging). Per §6's table-justification review, this is **not** pre-built into Module 2's schema — no non-human identity exists yet to distinguish, so an `actor_type` column has no present justification. Adding it (defaulted to `'user'`, existing rows requiring no real backfill) is a trivial additive migration whenever the first non-human identity is actually built.
- **Human owner** — every non-human identity has a named, accountable human, restating the Agent Framework's Anatomy field (Agent Framework §3), not a new idea — now given a concrete home in the tenancy model.
- **Expiration where appropriate** — a time-boxed integration or a temporary contractor's service account should support an optional expiry, similar in spirit to session/token expiration already designed elsewhere.

### Does the schema need a generic "principals" model now?

**No — deferred, by design, in favor of the simplest safe path.** A full generic `principals` abstraction (where `users` and future `service_accounts`/`agents` all implement one shared identity that `sessions`, memberships, and `audit_logs` reference generically) is real, correct long-term architecture — but building it now, before a single non-human identity exists that needs it, is exactly the kind of premature abstraction the rest of this platform's design has deliberately avoided.

What matters is confirming the *current* schema doesn't paint us into a corner. It doesn't: adding a `service_accounts` table later, plus a nullable `service_account_id` column alongside the existing `user_id` on `sessions` and the membership tables (with a check constraint ensuring exactly one of the two is set per row), plus an `actor_type` column on `audit_logs` defaulted to `'user'`, is a purely **additive** migration — no existing foreign key is renamed or retargeted, no existing data moves. None of this is pre-built into Module 2's actual schema (§6) — it's confirmed available *when needed*, not paid for speculatively now. The generic-principals abstraction remains available as a future refactor if and when the number of non-human identity types grows enough to justify it, but nothing in Module 2 requires committing to it now.

---

# 14. API Contract Principles

Standards for every protected route this platform builds from Module 2 onward — enough to prevent inconsistent patterns from taking hold, not a full standalone guide (a dedicated `API_GUIDELINES.md` remains a candidate for later, once there's enough real surface area to warrant its own document).

- **URL and route conventions**: resource-oriented, tenant scope explicit in the path — e.g. `/api/v1/organizations/{organizationId}/workspaces/{workspaceId}/...`. The ID appearing in the URL is a deliberate choice for clarity, not a trust decision: it is still only ever used as a lookup key for the §8 membership chain, never as authorization by itself.
- **Versioning strategy**: URL-path versioning (`/api/v1/...`) — simplest to reason about, easiest to run two versions side by side during a deprecation window.
- **Authentication**: every route requires a valid session except an explicitly, narrowly listed set of public routes (the OAuth callback itself, and nothing else in Module 2's scope); adding a new unauthenticated route is a decision that needs explicit review, never a default.
- **Tenant scoping**: every route under an organization/workspace path re-verifies membership per §8 on every request — restated here specifically for whoever builds the next route, so it isn't rediscovered independently each time.
- **Authorization**: every route calls the shared `requireXxx` helpers (§8); no route hand-rolls its own authorization check.
- **Request validation**: all input validated against a schema (zod, consistent with Module 1's environment-validation precedent) before any business logic runs; invalid input returns a structured 400 with field-level detail.
- **Consistent error envelope**: `{ "error": { "code": "machine_readable_code", "message": "safe to display", "requestId": "..." } }` for every error response, with no exceptions — never a stack trace, SQL fragment, or raw driver message in a response body, extending Module 1's health-check precedent to every future route.
- **HTTP status codes**: standard semantic usage, with one deliberate, security-relevant choice: a request for a resource **outside the caller's own tenant scope** returns **404**, not 403. Returning 403 confirms the resource exists but is forbidden — a mild information leak about another tenant's data. Returning 404 reveals nothing. (403 remains correct for "this is your own resource, but your role doesn't permit this action" — existence isn't in question there.)
- **Pagination**: cursor-based, never offset-based — offset pagination degrades and can skip or duplicate rows under concurrent writes. Requests accept `cursor` and `limit`; responses include `nextCursor`; a sane maximum `limit` is enforced server-side regardless of what's requested.
- **Sorting and filtering**: an explicit, per-endpoint allow-list of sortable/filterable fields — never an arbitrary client-supplied column name or fragment.
- **Idempotency for retried mutations**: state-changing requests that are safe to retry (e.g., invitation creation/acceptance) accept an optional `Idempotency-Key` header; the server records the key and its result for a bounded window and returns the same result on a repeat, rather than performing the action twice.
- **Request and correlation IDs**: every request gets a request ID (generated server-side if not supplied), included in the error envelope and in the corresponding `audit_logs` entry/server log line, so one failed request can be traced end-to-end.
- **Rate-limit headers**: every rate-limited response includes `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` (or the `X-RateLimit-*` equivalents), reflecting §11's `checkLimit`/`recordAttempt` results directly.
- **Audit logging**: every mutating call touching an entity from §10's event list produces its corresponding audit event — a route that mutates tenant data without one is an incomplete implementation, not a minor gap.
- **Sensitive-error redaction**: a blanket rule, not just a health-check convention — no connection strings, stack traces, internal file paths, or raw database error text ever reaches a response body, full detail server-side only, tagged with the request ID.
- **Deprecation policy**: a deprecated route or version is announced via a `Deprecation` response header with a sunset date, given a minimum notice period before removal, and removed only via the same "coexist, verify, cut over" discipline the rest of this platform's Future Architecture already follows.

---

# 15. Module 2 implementation sequence

Revised for the OAuth-only launch scope. Each step remains its own small, independently verifiable commit.

### 1. Approved schema
- **Files affected**: none — final sign-off on §6.
- **Definition of Done**: schema shape explicitly approved.

### 2. Migrations — **complete, independently verified**
- **Files affected**: `src/db/schema.ts` (the nine justified tables from §6 only — `verification_tokens` and the `password_hash`/`actor_type` columns are explicitly not created, per §6's justification review), migrations `drizzle/0000_dapper_steel_serpent.sql` (initial nine tables) and `drizzle/0001_tiresome_shatterstar.sql` (schema-hardening pass — §19).
- **Tests**: `npm run db:check` added to CI; both migrations additionally verified directly against Postgres's own catalogs (`pg_constraint`, `pg_indexes`), not just `drizzle-kit check`'s own report.
- **Risks**: schema mistakes are cheapest to fix now, before any real data exists.
- **Rollback**: rollback SQL for the hardening-pass migration is recorded in the schema-hardening-pass report; both migrations are reversible with the database still empty.
- **Definition of Done**: `db:generate` → manual review → applied to the non-production database → `db:check`, clean. **Done for both migrations** — the case-insensitive email constraint and the composite invitation/workspace tenancy constraint (§19) were each additionally proven directly against Postgres with real insert attempts, not assumed from the migration file alone.

### 3. OAuth and Session Foundation — **implemented locally; pending live-provider acceptance**
- **Files affected**: `src/lib/auth/` (providers, state/nonce/PKCE, callback validation with full cryptographic OIDC verification via `jose`, account-linking with atomic transaction boundaries, sessions, cookies, audit, errors, redirects), `src/lib/rate-limit/`, `src/app/api/auth/**/route.ts`, `src/static-checks/`, plus `rate_limit_counters` (schema+migration). Full detail, including a security-correction pass that replaced structural ID-token decoding with cryptographic JWKS-based verification, added nonce protection, corrected Microsoft's stable identity, corrected session expiration, and added real transaction boundaries: MODULE_2_STEP_3_OAUTH_SESSION_DESIGN.md.
- **Tests**: full unit suite (offline, mocked) plus integration suite (real non-production database) — including real generated-key-pair cryptographic JWT verification tests, real concurrent-race tests proving zero orphaned rows, and a dedicated no-secrets-in-logs test. All passing; see the Step 3 doc §17.
- **Risks**: incorrect redirect-URI or `state`/`nonce` handling is the highest-consequence mistake in this step (§2) — mitigated by testing the rejection paths as thoroughly as the success path, not just the happy path. **Not yet mitigated by real-world testing**: no live Google/Microsoft OAuth application exists yet, so nothing in this step has been exercised against a real provider — see the Step 3 doc §16.
- **Risks**: incorrect redirect-URI or `state` handling is the highest-consequence mistake in this step (§2) — mitigated by testing the rejection paths as thoroughly as the success path, not just the happy path.
- **Rollback**: no external callers yet — safe to revert entirely.
- **Definition of Done**: a real Google or Microsoft account can complete the OAuth flow, produce a correctly-shaped `users`/`accounts` row, and receive a valid, revocable database-backed session, in isolation, with no other module depending on it yet.

### 4. Organization model — **implemented as Step 4A ("Organization, Workspace, and Authorization Domain Foundation"); HTTP routes added in Step 4B; not production-enabled**
- **Files affected**: `src/lib/organizations/organizations.ts` (createOrganization, getOrganizationForUser, updateOrganization, softDeleteOrganization, listOrganizationsForUser), `src/lib/organizations/memberships.ts` (addOrganizationMember, removeOrganizationMember, changeOrganizationRole, listOrganizationMembers). HTTP routes: `src/app/api/organizations/**` (Step 4B).
- **Tests**: every §7 edge case as a direct integration test against the real non-production database, including a real *concurrent* race test (`Promise.allSettled` of simultaneous owner removal/demotion attempts) proving the last-owner invariant holds under genuine Postgres concurrency, not just a single-request check. Step 4B added integration tests driving the same logic through the real HTTP route handlers.
- **Definition of Done**: **complete** at both the domain-service layer (Step 4A) and the HTTP-route layer (Step 4B, thin handlers over the same services) — see the important caveats below this list.

### 5. Workspace model — **implemented as Step 4A; HTTP routes added in Step 4B; not production-enabled**
- **Files affected**: `src/lib/workspaces/workspaces.ts` (createWorkspace, getWorkspaceForUser, updateWorkspace, softDeleteWorkspace, listWorkspacesForUser, the `requireWorkspaceManagementAccess` manager-or-admin-override composition point), `src/lib/workspaces/memberships.ts` (addWorkspaceMember, removeWorkspaceMember, changeWorkspaceRole, listWorkspaceMembers). HTTP routes: `src/app/api/organizations/[organizationId]/workspaces/**` (Step 4B).
- **Tests**: the "no implicit inheritance" invariant, the admin-override pattern (verified to grant management access without granting content access), a workspace `manager` correctly unable to delete their own workspace, and the "workspace membership requires parent organization membership" rule (§7) — all additionally proven through the real HTTP routes in Step 4B.
- **Definition of Done**: **complete** — every §7 edge case, including the new role-set-specific ones, has a passing integration test against the real database, both at the domain layer and through the HTTP route layer.

### 6. Authorization helpers — **implemented as Step 4A; not production-enabled**
- **Files affected**: `src/lib/authz/helpers.ts` (`requireAuthenticatedUser`, `requireOrganizationMembership`, `requireWorkspaceMembership`, `requireOrganizationRole`, `requireWorkspaceRole`, `requireOrganizationAdminOverride`, `requireTenantScopedResource`) and `src/lib/authz/errors.ts` (the `TenantResourceNotFoundError`/404, `InsufficientRoleError`/403, `DomainRuleViolationError`/409 taxonomy). Type-distinguishes organization vs. workspace roles per this section's original note.
- **Important — how this was built and verified without live OAuth**: Step 3's live Google/Microsoft provider acceptance is still pending (§16 of the Step 3 design doc). Step 4A's tests obtain authenticated sessions by calling Step 3's own, unmodified `createSession`/`validateSessionToken` primitives directly against the real database — **no runtime bypass, no test-only authentication mode, and no weakened session validation were introduced anywhere in application code** to make this possible. `requireAuthenticatedUser` is the exact same function a real request would go through; only the *origin* of the session token differs between a test and a real OAuth login (one is created directly via `createSession`, the other via a real callback) — the validation path itself is identical and untouched. Step 4B's route-layer tests, Step 4C/4C.1's invitation tests, and Step 5A's dashboard-shell tests all follow the identical discipline — Step 5A's own `requireDashboardUser` guard (§9 above) is built directly on this same, unmodified `validateSessionToken`.
- **Consequence**: Steps 4A, 4B, 4C, 4C.1, and 5A are all **implemented and locally verified, but cannot be considered production-enabled until Step 3's live-provider acceptance succeeds** — there is currently no way for a real user to reach any of this code through an actual login, since that login flow itself is unverified against real providers.

### 7. Invitation flow — **implemented as Step 4C ("Invitation Domain, API, and Transactional Email Boundary"); hardened in Step 4C.1 ("Token Transport and Privacy Hardening"); not production-enabled**
- Adapted for OAuth-based acceptance (§9) as originally planned, including the atomic conflict-handling refresh behavior specified there (now implemented, not just specified).
- **Step 4C.1 revision**: the raw invitation token no longer appears in any URL except the email link itself. `GET /api/invitations/{token}` and `POST /api/invitations/{token}/accept` were **removed**. In their place: `GET /invite/{rawToken}` (the single raw-token exchange, validates the token and issues a signed HttpOnly continuation cookie carrying only its hash, then 303-redirects to the token-free `GET /invite`), `GET /api/invitations/current` (preview via the cookie), and `POST /api/invitations/current/accept` (accept via the cookie). The new-user OAuth-continuation path is now bound to the specific OAuth attempt: the login-initiation route folds the continuation cookie's hash into the same signed, state/nonce-protected pre-auth cookie already used for OAuth CSRF protection, rather than relying on a separately-plantable standalone cookie surviving into the callback alone. Full detail, including the hosting-log caveats and rate-limiting redesign: MODULE_2_STEP_4C_INVITATIONS_API_REFERENCE.md.
- **Files affected**: `src/lib/invitations/*` (tokens, invitations, acceptance, continuation, errors, rate-limits), `src/lib/email/*`, `src/app/api/organizations/[organizationId]/invitations/**`, `src/app/invite/[rawToken]/route.ts`, `src/app/invite/route.ts` (a plain, dependency-free landing stub — not a page, not a dashboard), `src/app/api/invitations/current/**`, and narrowly-scoped additions to the existing OAuth login-initiation route (`src/app/api/auth/[provider]/route.ts`) and callback route (`src/app/api/auth/[provider]/callback/route.ts`), plus one new optional field on the pre-auth cookie payload (`src/lib/auth/state.ts`).
- **New-user acceptance without live OAuth**: exercised via the callback route's mocked/provider-independent unit tests (covering successful acceptance, terminal failure, and transient failure — each verified to leave OAuth login itself unaffected) plus real-database integration tests of the cookie and acceptance mechanics.
- **Tests**: every rule in the approved invitation model, plus the Step 4C.1 hardening requirements — continuation-cookie invalidation on refresh/revocation/acceptance, replay safety for both the raw-token exchange and the cookie-based accept, HMAC-derived (never raw-token) rate-limit identifiers, and required response headers (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`) on the exchange endpoint.
- **Definition of Done**: complete for everything Step 4C and Step 4C.1 were scoped to cover. **No real email is sent**, **live OAuth acceptance remains pending**, and **Vercel's request-log behavior for the exchange endpoint was not empirically re-verified in this pass** (documented platform default only, per an explicit decision this session — see the API reference doc) — all explicitly out of scope, not gaps.

### 8. Audit events
- **Files affected**: `audit_logs` usage, retrofitted into steps 3–7, using the OAuth-specific event list from §10 (not the deferred credentials events), plus Step 4C's invitation event list (see MODULE_2_STEP_4C_INVITATIONS_API_REFERENCE.md's own audit-events section).

### 9. UI — **dashboard shell implemented as Step 5A ("Authenticated Dashboard Shell, Organization Switcher, and Workspace Switcher"); organization/workspace administration implemented as Step 5B ("Organization and Workspace Administration UI"); invitation management UI and safe email preview implemented as Step 5C ("Invitation Management UI and Safe Email Preview"); not production-enabled**
- **Files affected (Step 5A)**: `src/app/app/**` (the `/app`, `/app/{organizationSlug}`, `/app/{organizationSlug}/{workspaceSlug}` route tree), `src/app/sign-in-required/page.tsx`, `src/lib/dashboard/*` (session gate, nav config, client-safe view models), `src/components/dashboard/*` (sidebar, mobile nav, organization/workspace switchers, logout, invitation-status banner, module placeholder cards), plus two small additive domain functions (`getOrganizationBySlugForUser`, `getWorkspaceBySlugForUser`) and an extension of the existing Tailwind token mapping in `globals.css`. Full detail: MODULE_2_STEP_5A_DASHBOARD_SHELL.md.
- **Scope (Step 5A)**: an authenticated shell, organization/workspace switchers (slug-based, explicit-membership-only, no admin override for workspace content), an empty real dashboard home (greeting, current org/workspace, invitation-status display, navigation placeholders only — no fake data), responsive navigation (desktop sidebar + mobile drawer, 44px touch targets, `jest-axe`-verified), and account/session controls (logout only).
- **Session gate**: route/layout-level only, no application-wide middleware — every leaf route independently calls the reusable `requireDashboardUser` guard, which reads and validates the session through the existing, unmodified `getSessionCookie`/`validateSessionToken` primitives (the same ones Step 4A's tests already used) and redirects unauthenticated/revoked sessions to a validated, internal-relative-only return path — proven not to be an open-redirect vector.
- **Definition of Done for Step 5A specifically**: met — the shell, switchers, and gate are built and tested end-to-end against real database-backed sessions.
- **Files affected (Step 5B)**: `src/app/app/{organizationSlug}/{settings,members,workspaces/new}/page.tsx`, `src/app/app/{organizationSlug}/{workspaceSlug}/{settings,members}/page.tsx`, `src/app/app/new/page.tsx`, `src/lib/dashboard/actions/*` (organization/workspace server actions, reserved-slug guards, typed `ActionResult`/error translation), thirteen new `src/components/dashboard/*` admin UI components (forms, confirmation dialog, member rows), plus two small additive domain-layer changes: `SlugAlreadyTakenError` (+ unique-violation catching in `createOrganization`/`updateOrganization`/`createWorkspace`/`updateWorkspace`) and `getWorkspaceForAdministration` (manager-or-org-admin-override resolver, distinct from Step 5A's content-access resolver). Full detail: MODULE_2_STEP_5B_ADMIN_UI.md.
- **Scope (Step 5B)**: organization settings/members management, workspace settings/members management, create-organization and create-workspace flows, role-change/removal/deletion confirmation flows — all authorization delegated to the unmodified Step 4A domain services, never re-implemented in a server action or component. No invitations UI, no real email. Explicitly NOT started across both Step 5A and 5B: Brain, Agent Registry, Workflow Engine, Marketing, Sales, billing, analytics, connected-account management, profile editing, or OAuth-linking UI.
- **Definition of Done for Step 5B specifically**: met — every admin screen is built, authorization-tested (46 new integration tests against a real database), and accessibility-tested (18 new `jest-axe` tests); `npm run typecheck`/`lint`/`build` all clean.
- **Files affected (Step 5C)**: `src/app/app/{organizationSlug}/invitations/{page.tsx,preview/page.tsx}`, `src/app/invite/page.tsx` (replacing the prior plain-text `route.ts`), `src/lib/dashboard/actions/invitations.ts`, `src/components/dashboard/{CreateInvitationForm,InvitationRow}.tsx`, `src/components/invite/InvitationAcceptButton.tsx`, plus small additive domain-layer changes: `InvitationListItem` (`workspaceName`/`invitedByName` joins in `listOrganizationInvitations`), `listWorkspacesForOrganization` (`src/lib/workspaces/workspaces.ts`), and `src/lib/email/preview.ts` (the safe preview renderer + `isEmailPreviewEnabled` flag) alongside a restyle of the existing `render.ts` email template to the LYNQ visual direction. Full detail: MODULE_2_STEP_5C_INVITATION_UI.md.
- **Scope (Step 5C)**: organization invitation management (create/refresh, pending/expired/accepted/revoked list, revoke), an owner/admin-only environment-gated email preview using the real rendering function with no raw token or usable link ever generated, and the clean `/invite` acceptance landing (five states: outcome, exchange-failed, no-cookie, dead-invitation, live-invitation-with-sign-in-or-accept) — all authorization delegated to the unmodified Step 4C domain services, never re-implemented in an action or component. No real email delivery configured. Explicitly NOT started across Steps 5A–5C: Brain, Agent Registry, Workflow Engine, Marketing, Sales, billing, analytics, connected-account management, profile editing, or OAuth-linking UI.
- **Definition of Done for Step 5C specifically**: met — every screen is built, authorization-tested (20 new integration tests + 9 new unit tests against a real database and the email-preview module), and accessibility-tested (16 new `jest-axe` tests); `npm run typecheck`/`lint`/`build` all clean; manual verification against a real dev server exercised a genuine raw-token exchange through to a genuine acceptance, confirming no raw token or hash appeared anywhere throughout.
- **Not yet met for any of Steps 5A–5C's original "real person signs in with Google/Microsoft" criterion** — that remains blocked on Step 3's live-provider acceptance, unchanged by any of them. The OAuth callback's own invitation-continuation logic was not modified by Step 5C.

### 10. Tests
- Unchanged in role — consolidation pass against the full §16 list.

### 11. Independent preview verification
- Unchanged in substance — the full §16 suite run against the real, deployed preview and its real Neon database, with the same rigor Module 1's sign-off required.

---

# 16. Acceptance tests

Revised: credential-specific tests removed or marked deferred; OAuth-specific tests added.

- Unauthenticated requests to any protected route are rejected (401), with no partial data returned.
- A user in Organization A cannot read or act on any resource in Organization B, even by directly supplying B's ID.
- A user with no `workspace_membership` for a specific workspace cannot view or act on it, regardless of their organization role.
- A workspace `viewer` cannot perform any mutation.
- An organization `member` cannot add, remove, or change the role of any other member.
- An organization `admin` cannot remove or demote a user with the `owner` role.
- Removing or demoting the organization's last remaining `owner` is rejected, including when the actor is that owner.
- A role value supplied in a request body is never honored for authorization purposes.
- An invitation token fails after expiration and fails on a second use after acceptance.
- A revoked session is rejected on its very next use, with no grace window.
- **An OAuth callback with a missing or mismatched `state` parameter is rejected before any token exchange occurs.**
- **A tampered or unregistered redirect/callback URL is rejected.**
- **A successful OAuth callback for a brand-new email creates exactly one `users` row and one matching `accounts` row — never a duplicate on a retried or double-submitted callback.**
- Sign-up and invitation-acceptance responses are indistinguishable in content and timing whether or not the referenced account or invitation already exists, where enumeration is possible.
- No log entry or HTTP response, under any tested condition including error paths, contains an OAuth token, a session secret, or (once built) a password or raw password-reset token.
- *(Deferred to the credentials module)* A password-reset token fails after expiration and after a single use; sign-in/forgot-password responses are enumeration-safe for credentials specifically.

---

# 17. Open decisions — resolved

Recommendations below are the defaults to proceed with unless you flag a specific objection; each still constitutes a decision you're being asked to confirm, not one already made unilaterally.

1. **Authentication launch strategy** — **OAuth only, Google + Microsoft** (§1). GitHub and credentials deferred to later modules.
2. **Password policy** — 12–128 characters, specified now, implemented when credentials ships (§4).
3. **Argon2id benchmark process** — deferred until the credentials module begins; `m=19456, t=2, p=1` is the starting point to benchmark against real Vercel function constraints at that time, not before.
4. **Session lifetime** — **corrected during Step 3's security-correction pass: idle lifetime 7 days, absolute lifetime 30 days from `created_at`** (superseding this item's original "30 days absolute, sliding, no idle timeout"). `newExpiresAt = min(now + 7 days, created_at + 30 days)` on every renewal-eligible request, never extended past the absolute cap. Reasoning for reintroducing an idle bound: a session that goes genuinely untouched for a week is a meaningfully different risk than one in daily active use, and a 7-day idle window is still generous enough to add no real friction for a daily-use internal tool while closing the gap the original "no idle timeout" reasoning left open. The 30-day absolute cap remains the hard outer bound regardless of activity — see MODULE_2_STEP_3_OAUTH_SESSION_DESIGN.md §8 for the exact implementation and a real off-by-one-at-the-boundary bug this pass found and fixed.
5. **Billing permission** — **owner only**, confirmed as the default.
6. **Workspace role model** — **`manager` / `member` / `viewer`** (§7), resolved.
7. **Transactional email provider** — **Resend**, confirmed as the default, not yet connected (§12 of the prior revision; still not implemented in Module 2, since OAuth-only reduces the auth-critical email surface to invitations and notifications only).
8. **Initial rate limits** — confirmed starting values in §11's table; explicitly tunable without any change to calling code, since all callers depend only on the `checkLimit`/`recordAttempt`/`resetLimit` interface (§11).
9. **Retention periods** — unchanged from the prior revision's proposed defaults (30-day account/organization grace period, 1–2 year audit-log minimum, 7-day token purge, 90-day invitation purge) — confirmed as defaults.
10. **Duplicate-invitation behavior** — **extend and resend the existing pending invitation**, confirmed as the default, replacing the prior revision's "either/or" framing. Enforced atomically via the conflict-handling UPSERT specified in §9, targeting the existing partial unique index — never a separate read-then-write.
11. **Cookie name and `SameSite` policy** — **`__Host-lynq_session`, `Secure`, `HttpOnly`, `SameSite=Lax`**, confirmed.
12. **Lost-access recovery** — **manual, human-reviewed**, confirmed, with no automated component, per §3's reasoning (now covering lost provider access, not just a forgotten password).
13. **Neon Auth (managed Better Auth)** — **status: approved for disablement; pending manual completion by the owner through the Neon dashboard.** This is an intentionally owner-managed administrative task, not an engineering task blocked on tooling: this environment does not have, and will not be given, Neon management-API credentials — no Neon API key is to be requested, generated, stored, or used to perform this action programmatically. Neon's Vercel Marketplace integration auto-provisioned a separate `neon_auth` schema running Neon's own managed Better-Auth service; Module 2's approved architecture is the custom OAuth + database-session design already decided in §1 and §5, not a managed auth service, and nothing in this platform's code or schema references `neon_auth`. The intended action, whenever the owner completes it, is `delete_data=false` — service disabled, schema and data preserved for rollback. Full reasoning in §19, including why its continued unused presence does not block Module 2 implementation, and the enforced boundaries that keep it that way.

**Still genuinely open, not defaulted above:**
- Whether GitHub should be added as a third OAuth option at launch after all, versus strictly deferred (§1 recommends deferring it; this is the one part of §1's recommendation that's a closer call and worth your explicit read).
- The exact wording/UX of the "invitation extended and resent" notice (a product-copy decision, not an architectural one).

---

# 18. Final output

**Revised final recommendation**: OAuth-only launch (Google + Microsoft) for Module 2, with credentials and GitHub deferred to clearly-scoped later modules, and a managed provider deferred until real external-SaaS/enterprise-SSO pressure exists (Roadmap Phase 10). This trades a small amount of user-choice flexibility for removing entire categories of the threat model outright — a security-motivated choice, not a cost-motivated one.

**Revised tenant and role model**: `owner`/`admin`/`member`/`viewer` at the organization level, unchanged; `manager`/`member`/`viewer` at the workspace level (simplified from a four-tier reuse), with an org-level admin-override for workspace administration that never extends to workspace content access. Workspace access remains strictly explicit, never inherited, in every scenario considered.

**Revised schema implications**: **nine** tables at Step 2, each justified against a present Module 2 need (§6) — `verification_tokens` and the `accounts.password_hash`/`audit_logs.actor_type` columns were reconsidered against that same standard and cut, since none had a real justification beyond "an auth library would normally include it." **A tenth, `rate_limit_counters`, was added in Step 3** (§19) to back the provider-agnostic rate limiter — the application schema now totals ten tables. Every index proposed in §6 is likewise tied to a specific, named query pattern, not added by default. No entity relationship changes shape later for either the Brain-domain-permissions extension (§12) or the non-human-identity extension (§13) — both remain additive, confirmed without pre-building anything for them now.

**Decisions that still genuinely require your approval**: the twelve items in §17 (mostly resolved with a recommended default to confirm or reject), plus the one explicitly open question of whether GitHub belongs in the initial launch after all.

**Is Module 2 ready for implementation?** Yes, contingent on confirming §17's defaults (or flagging specific objections) and the GitHub question — no other open item blocks starting.

**Current status**: §15 step 1 (approved schema) and step 2 (migrations) are both **complete** — the original nine-table migration and the schema-hardening-pass corrective migration (§19) are applied and independently verified. §15 step 3, OAuth and Session Foundation, is **implemented locally and pending live-provider acceptance** — a tenth table (`rate_limit_counters`) and one new dependency (`jose`, for cryptographic JWKS-based ID-token verification) were added along the way, both documented in MODULE_2_STEP_3_OAUTH_SESSION_DESIGN.md. A dedicated security-correction pass on Step 3 replaced structural ID-token decoding with full cryptographic OIDC validation, added nonce protection, corrected Microsoft's stable provider identity (`tid.oid`, never email), corrected session expiration (idle 7 days / absolute 30 days), added real database transaction boundaries for login/linking with deterministic handling of racing callbacks, and reconciled the audit-event taxonomy (§10 above). Neon Auth is **approved for disablement, pending manual completion by the owner through the Neon dashboard** (§17 item 13, §19) — an owner-managed administrative action, not an engineering blocker; its unused presence does not block Module 2 implementation. No live Google/Microsoft OAuth application exists yet — real-provider and preview verification remain pending (Step 3 doc §16).

**Step 4A ("Organization, Workspace, and Authorization Domain Foundation") is implemented and locally verified** — organization/workspace domain services (§15 steps 4–5), the seven required authorization helpers (§15 step 6), and their full unit/integration/concurrency test coverage. Built entirely without live OAuth: its tests obtain valid sessions by calling Step 3's own unchanged `createSession`/`validateSessionToken` primitives directly, never through a modified or bypassed authentication path — **no runtime bypass or temporary authentication mode exists anywhere in application code**. Explicitly **not** built in Step 4A: invitation acceptance, authentication/onboarding/dashboard UI, application-wide middleware, or any HTTP route layer for organizations/workspaces (domain services only, called directly). **Step 4A cannot be considered production-enabled until Step 3's live-provider acceptance succeeds** — until a real login actually works, there is no real path by which a genuine user reaches this code at all. **Step 4B has not been started.**

---

*This document revision changes no runtime code. The migrations referenced above (the original nine-table migration and the schema-hardening-pass migration) were generated, reviewed, and applied to the non-production database as their own explicitly-approved actions — not as a side effect of writing this document. No OAuth, session, route, middleware, or UI runtime code exists yet.*

---

# 19. Schema Hardening Decisions

Findings and decisions from the Module 2 schema-hardening pass, conducted after Step 2's initial migration while the database still held zero application rows. Scope was strictly limited to schema, migrations, Neon Auth's control-plane state, and this document — no routes, OAuth, sessions, middleware, or UI were touched.

**1. Why plain email uniqueness was insufficient.** The original constraint, `users_email_unique`, was a plain unique index on the raw `email` column. Postgres string equality is case-sensitive by default, so `alice@example.com` and `Alice@Example.com` would be treated as two distinct values and both could be inserted — silently creating two `users` rows for the same real person, defeating the cross-provider account-matching design in §6.

**2. Why `lower(email)` uniqueness was selected.** A functional/expression unique index, `CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email))`, was chosen over Postgres's `citext` extension because Drizzle's pg-core has no first-class `citext()` column type, and the application layer already normalizes email casing on input — the functional index adds a real, independent database-level guarantee as defense-in-depth, rather than trusting app-layer normalization alone, without requiring an extension or a new column type. Verified directly: inserting `Hardening.Test@Example.com` then `hardening.test@example.com` succeeds on the first row and is rejected on the second with `duplicate key value violates unique constraint "users_email_lower_unique"`.

**3. Why the original invitation foreign key allowed a cross-tenant mismatch.** The original schema had two independent, unrelated columns on `invitations`: a plain `organization_id` and a plain `workspace_id → workspaces.id`. Nothing tied them together, so the database would accept a row naming Organization A in `organization_id` and a workspace that actually belongs to Organization B in `workspace_id` — a real tenant-boundary violation that only application code could have caught, and only if every code path remembered to check it.

**4. How the composite foreign key closes that gap.** `workspaces` gained a composite unique constraint, `workspaces_id_org_unique UNIQUE(id, organization_id)`, purely so a composite foreign key could target it. `invitations` gained `invitations_workspace_org_fk FOREIGN KEY (workspace_id, organization_id) REFERENCES workspaces(id, organization_id)`, replacing the old single-column FK. The database now rejects any row where the named workspace's actual organization doesn't match the invitation's own `organization_id`. Verified directly: an invitation for Org A referencing a workspace in Org A succeeds; the identical attempt substituting Org B for the same workspace fails with `violates foreign key constraint "invitations_workspace_org_fk"`. Postgres's default `MATCH SIMPLE` semantics correctly exempt `workspace_id IS NULL` rows (organization-only invitations) from the check. `ON DELETE CASCADE` replaced the original `SET NULL`, because a composite FK's delete action applies to every column in its own local list and `organization_id` is `NOT NULL` — `SET NULL` on this composite FK would fail at delete time; `CASCADE` is also arguably more correct on its own merits, since silently nulling only `workspace_id` would have misrepresented what was actually invited.

**5. Why expired pending invitations require atomic conflict handling.** The partial unique index `invitations_org_email_pending_unique` (`WHERE status = 'pending'`) only knows whether a row's `status` column currently says `'pending'`; it cannot tell "genuinely still pending and unexpired" from "expired but never transitioned to `'expired'`." A naive "check if expired, then insert or update" implementation would race under concurrent requests. Invitation creation must therefore use a single atomic `INSERT ... ON CONFLICT (organization_id, email) WHERE status = 'pending' DO UPDATE ...` statement targeting that same partial index, checking and refreshing expiry within the same statement. Documented here (§9) for whoever implements invitation creation; **not yet implemented**.

**6. Why Neon Auth is not part of the approved architecture.** Neon's Vercel Marketplace integration auto-provisions "Neon Auth" (Neon's managed Better Auth) into a separate `neon_auth` schema by default, alongside the actual application database. Module 2's approved architecture — custom OAuth (Google/Microsoft) plus database-backed sessions (§1, §5) — was decided on its own merits before this was discovered; Neon Auth is a parallel, unused authentication system that happened to already exist, not a considered alternative that was rejected. Investigation confirmed it holds real (if unused) Better-Auth configuration (a Google social provider, an organization plugin) but zero rows across all nine of its tables, and nothing in this platform's code or schema references it.

**Status**: approved for disablement (`delete_data=false` — service disabled, schema and data preserved for rollback), **pending manual completion by the owner through the Neon dashboard**. This is deliberately kept an owner-managed administrative action: this environment does not have Neon management-API credentials, and none are to be requested, generated, stored, or used to perform this action programmatically or on the owner's behalf.

**Why its continued unused presence does not block Module 2 Step 3 or later steps**: it is isolated from the `public` application schema (a separate Postgres schema entirely); its user-facing tables are empty; no runtime code imports or calls Neon Auth; and the custom OAuth/database-session system being built does not and will not use its endpoints or tables. To keep that true as implementation proceeds, the following boundaries are enforced for all Module 2 code from Step 3 onward:

- No import of a Neon Auth or Better Auth SDK — specifically `better-auth`, `@neondatabase/auth`, `@neondatabase/neon-js`, or `@neondatabase/auth-ui` must never appear in `package.json` or any import statement.
- No reference to the `NEON_AUTH_BASE_URL` or `VITE_NEON_AUTH_URL` environment variables anywhere in application code.
- No query or mutation against the `neon_auth` schema, in Drizzle or in raw SQL, anywhere in application code.
- No use of Neon Auth's configuration, sessions, accounts, organizations, or JWKS tables/endpoints for any purpose.
- Every custom authentication table (existing and new) stays schema-qualified to `public`, implicitly by never wrapping a table definition in `pgSchema("neon_auth")` or any non-`public` schema.
- A static check (specified in the Step 3 implementation design) runs in the same test suite as everything else, failing the build if any of the above is violated.

**7. Why `verification_tokens` and `feature_flags` are intentionally absent.** `verification_tokens` has nothing to store yet: Module 2 launches OAuth-only (§1), OAuth providers verify email ownership themselves, and there is no password to reset, so no code path would ever read or write this table. `feature_flags` was never part of this design in the first place — it is not part of authentication or tenancy, and nothing in Module 2's actual feature set depends on it. Both are confirmed intentional omissions, not oversights; adding either later, when a real need exists, is a normal, low-risk additive migration, exactly like `accounts.password_hash` and `audit_logs.actor_type` (§6).
