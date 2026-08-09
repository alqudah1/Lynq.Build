# Module 2 Step 3 — Owner Provider Setup Checklist (Gate 3)

For the owner to complete before Gate 4 (live acceptance testing) can run. No credentials are requested here, and none should ever be pasted into chat, committed to Git, or written into any documentation file — only variable **names** appear below, never values.

---

## 1. Exact callback URLs

Each provider requires an exact, pre-registered redirect URI list — OAuth providers reject any redirect URI not registered exactly (including scheme, host, port, path, and trailing-slash differences).

| Environment | Base URL | Google callback | Microsoft callback |
|---|---|---|---|
| Local development | `http://localhost:3000` | `http://localhost:3000/api/auth/google/callback` | `http://localhost:3000/api/auth/microsoft/callback` |
| Isolated Vercel preview (current stable alias for the `platform` project — confirmed via `vercel project ls`) | `https://platform-mu-five-83.vercel.app` | `https://platform-mu-five-83.vercel.app/api/auth/google/callback` | `https://platform-mu-five-83.vercel.app/api/auth/microsoft/callback` |
| `app.lynq.build` (later — **not yet configured** as an alias for this project; the `lynq.build` domain itself is owned and on Vercel, but this subdomain must be added to the `platform` project in Vercel's domain settings before this row is real) | `https://app.lynq.build` | `https://app.lynq.build/api/auth/google/callback` | `https://app.lynq.build/api/auth/microsoft/callback` |

**Important**: the `platform` Vercel project has no connected Git repository, so a plain `vercel deploy` (no `--prod`) produces a *new*, different, one-off preview URL every time — that can't be pre-registered with a provider. Register the **stable alias** above (or `app.lynq.build` once configured) with each provider, and after every deploy intended for OAuth testing, re-run `vercel alias set <new-deployment-url> platform-mu-five-83.vercel.app` (mirroring the pattern already used for `lynq.build` itself) so the registered callback URL keeps resolving to the latest deployment.

---

## 2. Required scopes

Both providers: **`openid`, `email`, `profile`** — exactly what's already configured in `src/lib/auth/providers.ts`. No additional Google API needs enabling for these; no additional Microsoft Graph permission needs explicit consent beyond these three standard OIDC scopes.

---

## 3. Microsoft Entra ID — supported account types

Set the app registration's **"Supported account types"** to:

> **Accounts in any organizational directory (Any Microsoft Entra ID tenant — Multitenant)**

**Not** "Accounts in this organizational directory only" (would only work for LYNQ's own tenant, breaking sign-in for any future external company) and **not** "...and personal Microsoft accounts" (our code specifically authorizes against the `/organizations/` endpoint, which already excludes personal accounts at the routing level — but the app registration's own setting should match that intent so the consent screen and app metadata stay consistent with what the code actually does).

**Leave "Implicit grant and hybrid flows" (ID tokens / access tokens checkboxes) unchecked.** This app uses the Authorization Code flow with a confidential client secret and PKCE — not the implicit or hybrid flow — so those checkboxes should stay off; enabling them doesn't help this design and adds an unused, weaker token-issuance path.

---

## 4. Required environment variables

| Name | Secret? | Where it's configured |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | No | `.env.local` (local); Vercel project env vars, Preview + Production scope |
| `GOOGLE_OAUTH_CLIENT_SECRET` | **Yes** | `.env.local` (local, gitignored); Vercel **Sensitive** env var, Preview + Production scope |
| `MICROSOFT_OAUTH_CLIENT_ID` | No | Same as Google's client ID |
| `MICROSOFT_OAUTH_CLIENT_SECRET` | **Yes** | Same as Google's client secret — Vercel **Sensitive** |
| `MICROSOFT_OAUTH_TENANT_ID` | No | Value: the literal string `organizations` — same locations |
| `AUTH_SECRET` | **Yes** | Generate once with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`; Vercel **Sensitive**, same value can differ per environment (rotating it invalidates all active pre-auth cookie attempts in flight, not sessions — a very low-cost rotation, see Step 3 doc §8) |
| `AUTH_BASE_URL` | No | The exact base URL for that environment — see the table in §1 above; set per Vercel environment scope (Development/Preview/Production), since it differs at each layer |

**Three secrets total**: `GOOGLE_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_CLIENT_SECRET`, `AUTH_SECRET`. Everything else is a non-secret identifier or URL, safe to appear in `.env.example`-style documentation (names only, never real values) but still kept out of version control in `.env.local`.

---

## 5. Avoiding credential exposure

- Add real values only to `.env.local` locally (already gitignored — confirmed by this project's `.env.example` header) or via `vercel env add <NAME> --sensitive` for deployed environments — never to `.env.example`, any `docs/*.md` file, a commit message, a PR description, or this chat.
- Before committing, run `git status` and check the diff of anything touching `.env*` — if a real secret ever ends up in a tracked file, treat it as compromised and rotate it (regenerate the client secret in the provider console, regenerate `AUTH_SECRET`) rather than just removing it from the file, since Git history retains it.
- Never paste a client secret, `AUTH_SECRET`, or any token into this chat, even to "double check" it — there is no legitimate reason for this session to see a real secret value at any point in Step 3 or its verification.
- The codebase already enforces (via `src/app/api/auth/[provider]/callback/no-secrets-in-logs.test.ts`) that no secret-shaped value reaches `console.error`, a redirect, or audit metadata — Gate 4's manual log inspection (§6 below) is a second, real-world check on top of that automated one, not a replacement for it.

---

## 6. Provider-console settings to verify before testing

**Google Cloud Console** (APIs & Services → Credentials → your OAuth 2.0 Client ID, type "Web application"):
- [ ] Authorized redirect URIs list contains the exact URL(s) from §1 for whichever environment you're about to test — no trailing slash, correct scheme (`http` only for `localhost`, `https` everywhere else).
- [ ] OAuth consent screen is configured with a publishing status of either **Internal** (if LYNQ's team is on a Google Workspace domain — simplest, no verification needed) or **External** + **Testing** (if not, or to allow non-Workspace test accounts) with the specific Google accounts you'll test with added as test users.
- [ ] Scopes `openid`, `email`, `profile` are present on the consent screen configuration.

**Microsoft Entra admin center** (App registrations → your app → Authentication / Certificates & secrets):
- [ ] Redirect URIs (Web platform) list contains the exact URL(s) from §1.
- [ ] Supported account types = multitenant, organizations-only (§3).
- [ ] Implicit grant checkboxes are unchecked (§3).
- [ ] A client secret exists, is not expired, and its expiration date is noted somewhere the owner will actually see before it lapses (Entra secrets expire; there's no automatic renewal).
- [ ] `openid`, `email`, `profile` delegated permissions show under API permissions (these are standard OIDC scopes, typically present by default — confirm rather than assume).

Once both checklists are satisfied and the three secret env vars are set in the target environment (never in this chat), Gate 4 can proceed.
