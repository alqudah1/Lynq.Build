# Module 19 — Social Command Center

The place from which LYNQ runs a company's social presence: AI social media
manager + content studio + publishing + advertising command center +
analytics. Built as a native module (`src/lib/social-os/`, pages under
`/app/[organizationSlug]/social/*`, API under
`/api/organizations/[organizationId]/social/*`) on top of what Modules
15–18 already provide. Nothing here is a second brand model, approval
system, scheduler, credential store or CRM.

## 1. Gap analysis (what the audit found)

| Concern | Verdict | Decision |
|---|---|---|
| Auth, tenancy, org-slug pages, `handleRouteError`, zod route pattern | EXISTS — REUSABLE | Used unchanged. |
| Marketing roles / capabilities (`marketing_role_assignments`, `authz.ts`) | EXISTS — NEEDS EXTENSION | Added capabilities `marketing_manage_brands`, `marketing_manage_connections`, `marketing_generate_content`, `marketing_publish`, `marketing_manage_engagement`, `marketing_manage_ads`, `marketing_approve_ad_changes`, `marketing_manage_automation`. Contributors can draft and generate; only managers/admins can publish, reply publicly or touch ads. |
| Brands (`marketing_brand_profiles`) | EXISTS — NEEDS EXTENSION | Added persistent context columns (company info, story, writing style, visual identity, websites, competitors, pillars, platforms, prohibited language, never-claim, market, objectives, archived). Brand create/update/archive services added — previously brands were seed-only. |
| Content items (`marketing_content_items`) | EXISTS — REUSABLE | Added `brand_profile_id` and a shared `brief` jsonb. Existing lifecycle kept; a Social "always-on" campaign per brand satisfies the NOT NULL campaign FK. |
| Per-platform variants | MISSING | New `social_content_variants` — the publishable unit. |
| Assets | EXISTS BUT INCOMPLETE (jsonb inside studio drafts, no uploads) | New `social_assets` (metadata only; bytes in private Vercel Blob or an external URL). |
| Calendar | EXISTS — NEEDS EXTENSION (derived list, no grid) | Derived from variants' `scheduled_for`/`published_at`; day/week/month grid UI, reschedule, gap detection. |
| Approvals | EXISTS — REUSABLE | `agent_approval_requests` via `marketing_approval_links` (new linked-entity types `content_variant`, `ad_change_request`). Founder Approval Center sees them automatically. |
| Publish jobs | MISSING | New `social_publish_jobs` + runtime job type `social_publish` (same queue/worker, `availableAt` = scheduled time). |
| Metrics | EXISTS — NEEDS EXTENSION | `marketing_content_performance_snapshots` gains `content_variant_id`, `external_post_id`, `extra_metrics`; new `social_account_metric_snapshots` for account-level insights. `source = synced:<provider>` vs `manual`. |
| Engagement inbox | MISSING (comms inbox is email/SMS/WhatsApp 1:1 threads) | New `social_engagement_items`; high-intent items link to CRM leads/contacts (existing CRM, not a new one). |
| Ads | MISSING (paid channel rows only) | New `social_ad_campaign_snapshots` (read) and `social_ad_change_requests` (recommendation → approval → execution). |
| AI generations | MISSING (history lived only in studio drafts) | New `social_ai_generations` with provider/model/type/config/cost/dedupe fingerprint. |
| AI provider layer | EXISTS BUT COUPLED (`ai` gateway + Runway inline) | New `src/lib/social-os/providers/ai/*` abstraction: text (Anthropic, OpenAI, gateway), image (OpenAI, Runway), video (Runway, Higgsfield). Availability is derived from env — never assumed. |
| OAuth for third-party connections | MISSING (sign-in OAuth is OIDC-bound, cookie path `/api/auth`) | New `src/lib/social-os/oauth/*`: signed state cookie scoped to `/api/social/oauth`, provider configs for Meta / LinkedIn / Google Ads, generic code exchange + refresh. |
| Token storage | EXISTS — REUSABLE | `integration_connections` (+ providers `meta`, `linkedin`, `google_ads`; integration types `social`, `ads`) and `integration_credentials` AES-256-GCM. The encrypted secret is a JSON token bundle (`{accessToken, refreshToken?, expiresAt?, scopes, assets:{[externalId]: {accessToken}}}`). |
| Webhooks | EXISTS — NEEDS EXTENSION | Provider-level routes `/api/social/webhooks/meta` (GET handshake + `X-Hub-Signature-256`) dedupe through `communication_provider_events`. |
| Jobs / cron | EXISTS — NEEDS EXTENSION | 7 new `runtime_job_type` values dispatched from the existing worker switch; the cron route additionally enqueues due `social_automation_rules`. |
| Daily brief / attention | EXISTS — NEEDS EXTENSION | `attention-engine.ts` gains a `social` domain rule set; the Social overview renders its own daily manager from live data. |
| Blob storage | EXISTS — REUSABLE | `@vercel/blob` private `put`/`get` pattern from media-production. `BLOB_READ_WRITE_TOKEN` documented. |
| Tests | EXISTS — REUSABLE | Integration tests run against a real Postgres through the test-helpers; unit tests mock `@/db/client`. |
| EXTERNAL CONFIGURATION REQUIRED | — | Meta app (Business type, products, review, verification), LinkedIn app (Community Management + Advertising API access), Google Cloud project (Ads API access level, OAuth consent in production), Runway / Higgsfield / OpenAI / Anthropic keys, `BLOB_READ_WRITE_TOKEN`. See §7. |

Bugs found in existing Marketing OS and fixed in this module's path:
`scheduleContent` ignored the planned date (variants own `scheduled_for`);
rejected content had no way back to draft (variants: `rejected → draft`);
brand profiles could not be edited.

## 2. Domain model

```
marketing_brand_profiles ──< marketing_channel_accounts ──> integration_connections ──< integration_credentials
        │                           │   (status: manual|connected|authorization_required|token_expired|…)
        │                           ├──< social_account_metric_snapshots
        │                           ├──< social_engagement_items ──> crm_leads / crm_contacts
        │                           ├──< social_ad_campaign_snapshots
        │                           └──< social_ad_change_requests ──> agent_approval_requests
        │
        └──< marketing_content_items (brief) ──< social_content_variants ──< social_publish_jobs ──> runtime_jobs
                                                        │                        (one active job per variant)
                                                        ├──> agent_approval_requests (via marketing_approval_links)
                                                        ├──< marketing_content_performance_snapshots
                                                        └──< social_assets  <── social_ai_generations
social_automation_rules ──< social_automation_runs      social_manager_threads ──< social_manager_messages
```

### Variant lifecycle

```
draft → generating → draft
draft → ready_for_review → approved | changes_requested | rejected
changes_requested → draft ; rejected → draft
approved → scheduled (scheduled_for set, publish job queued)
approved → publishing (publish now)
scheduled → publishing (worker picks job) | approved (unscheduled)
publishing → published (provider confirmed) | failed
failed → approved (retry, new job) ; any non-published → archived
```

The content item's own status mirrors its variants: `review` while any
variant awaits review, `approved`/`scheduled` when all are, `published` when
every non-archived variant is published.

### Publish job invariants

* `social_publish_jobs_variant_active_unique`: at most one queued /
  processing / retrying job per variant.
* The runtime job's idempotency key equals the publish job's
  (`social_publish:<publishJobId>`); the queue's own partial unique index
  prevents a second active runtime job.
* The worker re-reads the publish job and variant inside the lease, claims
  `queued → processing` with a revision CAS, and stores provider container
  ids in `provider_state` so a retry resumes (Instagram `creation_id`) instead
  of creating a duplicate.
* `published` is written only after the provider returned an id.

### Approval boundary

* Public publishing requires `marketing_publish` AND an approved variant.
  Submitting for review creates an `agent_approval_requests` row (execution
  owned by the submitter, agent = "Social Media Manager"), linked through
  `marketing_approval_links` (`content_variant`). Approve/reject calls
  `approveRequest`/`rejectRequest` — the same runtime approval model.
* Ad changes (`social_ad_change_requests`) require `marketing_approve_ad_changes`
  on top of a recorded approval; execution happens only in the
  `social_ad_change_execute` job and only for `approved` requests.
* Automation rules only produce drafts, snapshots and attention items.

## 3. Connection Center states

| State | Meaning | How it is derived |
|---|---|---|
| `connected` | Verified within the last sync and credential decrypts | provider `verify` succeeded, `tokenExpiresAt` in the future |
| `authorization_required` | No grant yet, or grant revoked | no active credential / provider returned auth error |
| `token_expired` | Grant exists but expired | `tokenExpiresAt < now()` or provider 190/401 |
| `missing_configuration` | Server lacks the provider's client id/secret | env check |
| `error` | Last provider call failed for another reason | `lastErrorCode` set |
| `not_supported` | Platform without an implemented adapter (TikTok, YouTube, X) | static |
| `manual` | Tracked by hand (pre-Module-19 default) | default |

## 4. AI provider layer

`src/lib/social-os/providers/ai/` exposes `TextProvider`, `ImageProvider`,
`VideoProvider` interfaces and a registry that reports each provider's
availability from env (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`RUNWAYML_API_SECRET`, `HIGGSFIELD_API_KEY`/`HIGGSFIELD_API_SECRET`, and the
existing Vercel AI Gateway path). Every call writes a `social_ai_generations`
row first (fingerprint dedupe), then runs; cost/usage is recorded where the
provider returns it. Media outputs land in `social_assets`. When no text
provider is configured, generation returns an honest "not configured" state —
the rest of the module keeps working.

## 5. Security

* Tokens only ever live encrypted in `integration_credentials`; log lines and
  API responses carry connection ids and statuses, never secrets.
* OAuth state is an HMAC-signed, single-use, 10-minute cookie bound to
  organization + actor; callbacks verify state before touching the DB.
* Webhook routes verify provider signatures over the raw body and dedupe on
  external event ids; unverifiable requests are rejected, not processed.
* Every service resolves `MarketingAuthContext` and checks a specific
  capability; every query is tenant-scoped; cross-org ids 404.
* Publishing and ad execution run in the worker with the stored actor's
  authority re-validated (membership + capability) at execution time.

## 6. Jobs and automation

| Job type | Key | Trigger |
|---|---|---|
| `social_publish` | `social_publish:<publishJobId>` | approve+schedule / publish now |
| `social_metrics_sync` | `social_metrics_sync:<channelAccountId>` | automation `metrics_sync`, manual "Sync now" |
| `social_engagement_sync` | `social_engagement_sync:<channelAccountId>` | automation `engagement_sync`, webhook nudge, manual |
| `social_token_watch` | `social_token_watch:<organizationId>` | automation `token_watch` |
| `social_automation_run` | `social_automation_run:<ruleId>:<runStamp>` | cron scheduler when `next_run_at <= now()` |
| `social_ad_change_execute` | `social_ad_change_execute:<changeRequestId>` | approval decision |
| `social_generation_run` | `social_generation_run:<generationId>` | long-running image/video generation |

## 7. Owner actions (external configuration)

See the final build report and `.env.example`. In short: create the Meta
Business app (+ Facebook Login for Business, Instagram API, Webhooks,
Marketing API; redirect URI `${AUTH_BASE_URL}/api/social/oauth/meta/callback`),
the LinkedIn app (Community Management API, Advertising API; redirect
`${AUTH_BASE_URL}/api/social/oauth/linkedin/callback`), the Google Cloud
project with the Google Ads API enabled and an OAuth web client (redirect
`${AUTH_BASE_URL}/api/social/oauth/google_ads/callback`), and set the keys
listed in `.env.example` under "Module 19".

## 8. Verification record (2026-10-01)

- `npm run typecheck` 0 errors · `npm run lint` 0 problems · `npm run build` passes.
- Unit: 1,335 tests (1,166 pre-existing, all intact). Integration against a real Postgres: 1,279 tests (1,208 pre-existing, all intact).
- Browser (headless Chromium, 1440×900 and 390×844, HTTPS dev server): overview, brand switching, create → drafts, variant edit/stale-save/hashtags, submit refused on an unconnected account, mobile approvals (sticky bar, request changes → draft → resubmit → approve & schedule → cancel → publish now → honest retrying state after the worker ran), calendar day/week/month + drag/move + gaps, inbox draft/send/status/lead/assign, analytics null-vs-zero, advertising propose → submit → approve → honest execution failure, brand section edit, Connection Center states, automation run, settings, AI manager setup state, Founder approvals/attention, no-access and cross-org 404/403.
- Independent audit: 4 HIGH findings fixed with regression tests (duplicate post on lease loss, retry of an ambiguous final create call, stale approval in the Founder Approval Center, double reply), plus open-redirect, SSRF, Communications isolation, cancel/claim races, env blanks, atomic daily media budget.

### Live-documentation re-check (2026-10-02)

- **Higgsfield** — re-read the published API reference (docs.higgsfield.ai, open.higgsfield.ai model pages). Host `api.higgsfield.ai`, `Authorization: Key ID:SECRET`, `GET /requests/{id}/status`, `POST /requests/{id}/cancel`, `Idempotency-Key`, statuses `queued | in_progress | completed | failed | nsfw | canceled`, `video.url` output — all matched the adapter. The default model id did not: the reference lists `bytedance/seedance-2.5/text-to-video` (`prompt`, `duration` 4–30, `resolution`, `aspect_ratio`) and `bytedance/seedance-2.5/image-to-video` (`image_url` required, no `aspect_ratio`). The adapter now defaults to those ids, sends `resolution: "1080p"`, and only sends `aspect_ratio` for text-to-video. Still unverified with a real key.
- **Runway** — base `https://api.dev.runwayml.com/v1`, `X-Runway-Version: 2024-11-06`, `gen4.5` (2–10 s), `promptImage` data URIs, task statuses `PENDING/RUNNING/SUCCEEDED/FAILED/CANCELLED` — unchanged; adapter matches. Changelog notes `gen3a_turbo` was deprecated on 2026-07-30 (the adapter never defaulted to it).

## 9. Known limitations (state reality)

- **Approver model.** `approveRequest` (Agent Runtime) only lets an org owner/admin or the submitting user decide. A `marketing_manager` who is a plain org member cannot approve another person's post or ad change (same limitation as Module 15). The founder (org owner) can. Changing this requires a runtime approver-rule change owned by the release lane.
- **`publish_outcome_unknown`.** If a worker dies after the platform accepted a post but before LYNQ recorded it, the job stops for a human instead of posting twice. The Publishing screen explains what to check.
- **DNS rebinding.** External asset URLs are checked against private ranges at create and on every redirect hop, but DNS is not pinned.
- **Unverified against live providers.** Every adapter is built from official documentation and unit-tested with recorded request/response shapes, but no real Meta/LinkedIn/Google/Runway/Higgsfield/OpenAI/Anthropic call was possible from this environment (no credentials, outbound network blocked). Status: IMPLEMENTED — EXTERNAL AUTHORIZATION REQUIRED.
- **Not supported through official APIs in this build:** TikTok, YouTube, X (tracking-only manual accounts); LinkedIn comment hiding; Instagram/Facebook DMs (comments and mentions only); LinkedIn member-profile insights.
- **Account reach** is summed across disjoint 28-day windows; unique reach is not additive across periods.
- A failed ad change or dead-lettered publish job appears twice in Founder attention (domain item + dead-letter item).
