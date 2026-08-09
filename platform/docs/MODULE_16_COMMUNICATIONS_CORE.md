# Module 16 — LYNQ Communications & Integrations Core

The shared, provider-neutral communications layer CRM Core, Sales OS, and Marketing OS build on for real email/SMS/WhatsApp — one canonical conversation/message model, narrow real provider adapters, and a bounded outbound-approval-send pipeline that can scale to more providers later without a schema change. Not a deep integration with every provider yet — a canonical architecture with one real provider path (Resend for email, fully implemented) and truthful development providers for SMS/WhatsApp. Built directly on CRM Core, Sales OS, Marketing OS, the Workflow Engine, Agent Registry/Runtime, Module 14's generic agent task handler contract, Tool Runtime, Runtime workers/reconciliation, approvals, artifacts, Projects Core, Brain, the audit system, and the premium dashboard/UI shell.

## Contradiction reconciliation (pre-implementation review)

No genuine architectural contradiction was found. CRM Core's activity model, Sales OS's sequence-step action types, Marketing OS's content-approval flow, the Workflow Engine's already-generic `tool_invocation` node (no engine change needed — see "Workflow/Tool integration" below), Module 14's task handler registry, and Runtime's approval/artifact primitives all composed cleanly with Communications OS's own additions.

One deliberate, disclosed adaptation beyond the spec's own literal suggestions:

- **Webhook route path.** The spec suggested `/api/integrations/:provider/webhook`. A provider-only path cannot resolve which of potentially many organizations' connections a given webhook belongs to — a real multi-tenant ESP integration needs a unique URL per connection. The actual route is `/api/integrations/[provider]/[connectionId]/webhook`, shown on each connection's own detail page. A single, platform-wide `RESEND_WEBHOOK_SECRET` is assumed for v1 (one Resend account); a future module supporting one Resend account per organization would store a per-connection signing secret instead of a single env var.
- **Message content storage.** `createArtifact` (Runtime) is structurally scoped to an agent execution — forcing every plain human-composed message through a shell execution just to store its body would be exactly the "agent-owned conversation" anti-pattern the spec forbids. `communication_messages.bodyText` stores ordinary message bodies directly in a bounded column; `contentArtifactId` is populated only when the content genuinely flowed through an agent draft (mirroring Marketing OS's own content-artifact model).

No existing entity was duplicated: connections, conversations, messages, templates, provider events, delivery events, consent/suppression, and bulk batches are genuinely new concepts with no prior home in CRM/Sales/Marketing OS; everything else (contacts, leads, opportunities, CRM activities, campaigns, content, workflows, agent executions, tool invocations, artifacts, approvals) is referenced by id only.

## Sales approval-link hardening (pre-work, before this module's own build)

Module 15's final report flagged a pre-existing bug: `sales_approval_links.approvalRequestId`'s FK to `agent_approval_requests` had no `onDelete` behavior (defaulting to `RESTRICT`), the same pattern already found and fixed in `marketing_approval_links`. Fixed first, as explicitly requested: `onDelete: "cascade"` added via `drizzle/0032_sales_approval_links_cascade_fix.sql`, plus a new regression test (`sales-os/concurrency.integration.test.ts`, "deleting the linked approval request cascades to its sales_approval_links row, not a FK violation") proving the fix. No other change to Sales OS.

## Files created and modified

**Schema**: `src/db/schema.ts` (appended) — 18 new enums, 16 new tables, +2 `runtime_job_type` enum values (`communication_send`, `communication_reconcile`), +1 `sales_sequence_step_action_type` enum value (`communication_draft`) and +1 column on `sales_sequence_step_runs` (`communicationMessageId`) for the Sales OS integration point. Migrations: `drizzle/0033_communications_os_module16.sql` (initial schema), `drizzle/0034_sales_sequence_communication_draft.sql` (Sales OS integration), `drizzle/0035_communication_messages_agent_fk_fix.sql` (a bug found via testing — see "Bugs discovered").

**Services** (`src/lib/communications-os/`, 21 files + 6 under `providers/`): `validation.ts`, `errors.ts`, `secrets.ts`, `authz.ts`, `roles.ts`, `connections.ts`, `identity.ts`, `consent.ts`, `conversations.ts`, `templates.ts`, `messages.ts`, `webhooks.ts`, `attachments.ts`, `bulk.ts`, `rate-limits.ts`, `reconciliation.ts`, `agents.ts`, `tools-seed.ts`, `crm-integration.ts`, `sales-integration.ts`, `marketing-integration.ts`, `test-helpers.ts`; `providers/types.ts`, `providers/dev-email.ts`, `providers/dev-sms.ts`, `providers/dev-whatsapp.ts`, `providers/resend.ts`, `providers/registry.ts`.

**Modified existing modules**: `src/lib/audit.ts` (+24 `AuditEventType` values), `src/lib/dashboard/nav-items.ts` (+"Communications", +"Integrations" links), `src/lib/agent-runtime/task-types.ts` (+2 `AGENT_TASK_TYPES` values), `src/lib/runtime/worker.ts` (+2 job-type dispatch cases), `src/lib/runtime/validation.ts` (+2 `RUNTIME_JOB_TYPES` values), `src/lib/tools/implementations/registry.ts` (+4 tool implementations), `src/lib/sales-os/sequences.ts` (+1 `communication_draft` step action branch), `src/lib/env.ts` (+4 optional env vars). No CRM/Sales OS/Marketing OS/Workflow service function's existing behavior was changed — every integration point is additive.

**APIs**: 29 route files under `src/app/api/organizations/[organizationId]/communications/...` (connections, conversations, messages, templates, consent, suppressions, batches, seed, agents) + 1 dedicated webhook route at `src/app/api/integrations/[provider]/[connectionId]/webhook/route.ts`.

**Dashboard**: `src/lib/dashboard/actions/communications.ts` (~30 server actions); 9 pages under `src/app/app/[organizationSlug]/communications/...` and `.../integrations/...`.

**Tests**: 2 integration files under `src/lib/communications-os/` — `functional.integration.test.ts` (12 tests), `concurrency.integration.test.ts` (13 tests) — plus 1 regression test added to `sales-os/concurrency.integration.test.ts` — plus one manual end-to-end script, run and deleted per the established scratch-runner convention.

## Schema and migrations

16 new tables, every one tenant-scoped by a direct `organizationId` FK (`onDelete: cascade`) — verified directly by deleting a throwaway org and confirming zero orphaned rows across all 16 tables. No `crm_*`/`sales_*`/`marketing_*`/`workflow_*` table was touched, added to, or duplicated.

**Connections/credentials/roles**: `integration_connections` (org/workspace-scoped, provider + channel, status lifecycle, partial unique on active `(org, provider, externalAccountId)`), `integration_credentials` (rotation-friendly, one ACTIVE encrypted row per connection — mirrors `agent_credentials`' multi-row shape but holds a genuinely retrievable AES-256-GCM-encrypted secret, since a provider adapter must present it to send), `communication_role_assignments` (one active Communications OS role per user per org, entirely independent of CRM/Sales/Marketing/Brain roles).

**Conversations/messages**: `communication_conversations` (may exist with no resolved CRM contact; partial unique on `(org, connection, externalThreadId)` prevents duplicate threads), `communication_messages` (the canonical model for every channel/provider; unique idempotency key per org, unique `(org, provider, providerMessageId)` for inbound dedup).

**Templates**: `communication_message_templates` → `communication_template_versions` (draft → published → superseded, immutable once published — the same lifecycle every other versioned entity in this codebase uses).

**Provider events/delivery**: `communication_provider_events` (durable, deduplicated on exactly `(provider, connectionId, externalEventId)` — no raw payload persisted), `communication_delivery_events` (canonical delivery history; unique per `providerEventId` where set).

**Consent/suppression/identity**: `communication_consent_records` (current state per `(org, channel, identity)`, never assumes opt-in from CRM existence), `communication_suppressions` (a broader "never send" signal — bounce/complaint/manual/compliance — tracked separately from consent, partial unique on the ACTIVE row per identity+channel), `communication_external_identities` (an exact-match identity → CRM contact resolution cache, never auto-created/auto-merged).

**Attachments/bulk/approvals**: `communication_attachments` (metadata/reference only, never a raw binary in Postgres), `communication_bulk_batches` + `communication_bulk_recipients` (bounded, snapshot-based batches — never a live re-query at send time; unique recipient per batch), `communication_approval_links` (typed pointer to a real `agent_approval_requests` row, `onDelete: cascade` from day one — the exact hardening lesson Module 15/16's own Sales OS fix taught).

**Deliberately not tables**: rate limits (reuses the existing `rate_limit_counters` table Module 2/8 already built — the `"communication"` tool category was already present in the schema, unused until this module), the work queue/inbox filtering, campaign health-style derived views — all pure query functions.

Migrations were generated via `drizzle-kit generate` and applied via `neon()`'s HTTP client (split on `--> statement-breakpoint`), with a matching tracking row manually inserted into `drizzle."__drizzle_migrations"` — the same workaround established in Module 13. `npx drizzle-kit check` reports clean after all three migrations.

## Connection model

`connections.ts`. `provider` (vendor: `resend`/`dev_email`/`twilio`/`dev_sms`/`whatsapp_cloud_api`/`dev_whatsapp`) and `integrationType` (channel: `email`/`sms`/`whatsapp`) are separate fields — a future unified provider serving multiple channels needs no schema change. `verifyConnection` calls the real provider adapter's own `verifyConnection`; for a development provider this always succeeds (no real account exists to fail against), for Resend it makes a real, bounded API call. Never returns a secret through any API — `storeConnectionCredential`/credential rows are write-only from the caller's perspective.

## Provider adapter contract

`providers/types.ts` — a strict, bounded interface (`verifyConnection`, `sendMessage`, `fetchStatus?`, `normalizeInboundEvent`, `normalizeDeliveryEvent`, `validateRecipient`, `mapProviderError`, `capabilities`), mirroring Module 14's `AgentTaskHandler` contract discipline: a fixed, in-code, typed interface, never a data-driven dispatch. No arbitrary provider SDK response object ever leaks past `execute`/`normalize*` into domain logic — every method returns one of the closed shapes the contract defines. Full detail in `MODULE_16_INTEGRATION_ADAPTERS.md`.

## Providers implemented

**Resend (email)** — fully implemented (`providers/resend.ts`): real `POST /emails` send with an `Idempotency-Key` header, real webhook signature verification (Svix HMAC-SHA256), a canonical delivery-event mapping (`email.sent`/`.delivered`/`.bounced`/`.complained`/`.opened`). This environment has no `RESEND_API_KEY`, so this adapter is never exercised for real by any test or the manual E2E run — architected and code-complete, not verified against a live account.

**Development providers (email/SMS/WhatsApp)** — `dev_email`/`dev_sms`/`dev_whatsapp`: always "verify," log the send to the server console, and return a synthetic `providerMessageId` with `capabilities.supportsDeliveryEvents: false` — so a message sent through them can reach `"sent"` and no further; it is **never** marked `"delivered"`, since no real delivery evidence exists. `dev_email` additionally accepts a synthetic inbound-test payload shape, purely so the inbound pipeline is exercisable end-to-end without a real vendor.

**Twilio SMS / WhatsApp Cloud API** — architected for (the `integration_provider` enum has the values, `ProviderAdapter` is channel-agnostic) but not implemented — `resolveProviderAdapter` throws a clear `ProviderNotImplementedError` rather than silently falling back to a dev provider under a real-sounding name.

## Conversation model

`conversations.ts`. May exist with no resolved CRM contact — identity resolution is conservative and never auto-creates or auto-merges a contact (see "Contact/channel identity resolution" below). `findOrCreateConversation` is idempotent on `(org, connection, externalThreadId)`; `findOrCreateConversationUnauthorized` is the identical core with no human-authority check, used exclusively by inbound webhook ingestion, which has no live human caller to authorize against — webhook authenticity is established independently, by signature verification at the API route layer, before this is ever reached.

## Message lifecycle

`messages.ts`. Explicit transition map: `draft → pending_approval|approved|cancelled`; `pending_approval → approved|draft|cancelled`; `approved → queued|cancelled`; `queued → sending|cancelled`; `sending → sent|failed`; `sent → delivered|failed`; `delivered`/`failed`/`received`/`cancelled` are terminal. A draft is not a sent communication; **`"sent"` only ever comes from a real worker-driven provider dispatch** (`processSendJob`), never from any other code path setting status directly. Full detail (including the concurrency-hardened claim step) in `MODULE_16_COMMUNICATIONS_DELIVERY_AND_RECOVERY.md`.

## Outbound flow

1. `createDraftMessage` — canonical draft only, recipient validated against the channel via the provider adapter's own `validateRecipient`.
2. Approval: either `submitMessageForApproval` (creates a real Runtime approval via a fresh Communications Assistant execution — the default path, mandatory for any agent-authored draft) or `approveDraftDirectly` (a lighter, explicit "configurable" path for a purely human-written draft — still requires `communications_send` capability, structurally unavailable for an agent-authored draft).
3. `queueMessageForSend` — requires `status === "approved"`, live-rechecks suppression, enqueues the real durable `communication_send` Runtime job.
4. The worker (`worker.ts`'s new dispatch case) calls `processSendJob`, which atomically claims the message (`queued → sending`), re-validates connection usability, consent/suppression, and rate limits **live**, calls the real provider adapter, and applies the result.
5. On real provider acceptance: `"sent"`, a real CRM activity is created (never earlier).
6. Delivery/inbound events update status deterministically via `webhooks.ts`.

## Templates

`templates.ts`. Draft → published → superseded, immutable once published. `renderTemplate` is a fixed `{{variableName}}` substitution engine — every token must be declared on the version's `variableSchema`, every required variable must be supplied, values are inserted as plain text — never arbitrary JavaScript or code execution.

## Identity resolution

`identity.ts`, reusing CRM Core's own `normalizeEmail`/`normalizePhone` (`@/lib/crm/normalize`) directly — never reimplemented. An exact, unique match against `crmContacts.normalizedPrimaryEmail`/`normalizedPrimaryPhone` may resolve a contact; an ambiguous match (more than one active contact shares the identity) is left **unresolved**, never guessed at; no contact is ever created or merged by this module.

## Inbound processing and webhooks

Full detail in `MODULE_16_COMMUNICATIONS_DELIVERY_AND_RECOVERY.md`. Summary: `webhooks.ts`'s `processInboundProviderEvent` deduplicates first (the DB's own unique index on `(provider, connectionId, externalEventId)`), then normalizes → resolves connection → resolves conversation → resolves contact conservatively → persists the canonical message → creates a real CRM activity. No unauthenticated inbound endpoint exists — the dedicated webhook route verifies a provider-specific signature (or a dev-only shared secret) before ever reaching this function.

## Consent and suppression

`consent.ts`. Two distinct concepts: consent (`unknown`/`opted_in`/`opted_out`/`suppressed`, one current row per identity+channel) and suppression (a broader "never send" signal — bounce/complaint/manual/compliance-hold — tracked separately since it can originate outside any consent decision). Never assumes opt-in from CRM existence. Checked live at both queue time and again at actual send time.

## CRM/Sales/Marketing integration

Full detail in `MODULE_16_COMMUNICATIONS_DELIVERY_AND_RECOVERY.md`'s CRM section and the dedicated Sales/Marketing sections below. Summary: `crm-integration.ts`'s `recordCommunicationCrmActivity` is called exactly twice in this module (real outbound acceptance, real inbound receipt) — never at draft time. Sales OS gained one new sequence-step action type (`communication_draft`, via `sales-integration.ts`'s `createSequenceCommunicationDraft`) that creates a real draft — never sends. Marketing OS gained one bridge (`marketing-integration.ts`'s `createBulkBatchFromApprovedContent`) from an already-approved content item to a bounded bulk batch in `draft` status — nothing auto-sends.

## Workflow/Tool integration

No Workflow Engine code changed. Four new Tool Runtime tools (`communications.create_draft`, `communications.send`, `communications.get_status`, `communications.list_conversation`) are registered exactly like Module 8's original three — a workflow references them through the ALREADY-generic `tool_invocation` node type, which needed zero engine changes to support a new tool category. `communications.send` deliberately does not enable Tool Runtime's own `approvalRequired` flag — the domain-level approval gate (a message must already be `"approved"`) is the real gate, avoiding a second, redundant approval system for the same action.

## Agent-assisted drafting

Full detail in `MODULE_16_INTEGRATION_ADAPTERS.md`. One agent (Communications Assistant), two task types (`communications_draft_reply`, `communications_draft_follow_up`) via Module 14's generic contract. A draft's recipient is always derived from the conversation itself (the last inbound sender, or the counterpart of the most recent message) — never agent-supplied, satisfying "agents may not create arbitrary recipients."

## Rate limiting

`rate-limits.ts`. Multi-layer (organization/connection/channel/recipient/agent/workflow), reusing the existing `PostgresRateLimiter`/`rate_limit_counters` infrastructure — never a second rate-limit table. Recipients are SHA-256-hashed before ever becoming part of a rate-limit key — never raw PII in a key.

## Retry/reconciliation

Full detail in `MODULE_16_COMMUNICATIONS_DELIVERY_AND_RECOVERY.md`. Summary: a provider outcome of `"uncertain"` (timeout, ambiguous response) leaves the message at `"sending"` — never blindly resent. `reconcileCommunications` (a new `communication_reconcile` Runtime job type) sweeps messages stuck at `"sending"` past the same staleness threshold Module 9 already uses, marking them `"failed"` with `failureClass: "provider_timeout"` for human review — a fresh message (a new idempotency key) is the only way to retry, never this sweep's own authority.

## Credential security

`secrets.ts` — AES-256-GCM, a symmetric key from `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY` (optional; absent means storing a real credential fails closed with `IntegrationCredentialEncryptionUnavailableError`, never a plaintext fallback). Rotation-friendly (`integration_credentials`, one active row per connection, prior rows soft-revoked). No API ever returns a stored secret.

## Authorization and privacy

Full detail in `MODULE_16_COMMUNICATIONS_AUTHORIZATION_AND_PRIVACY.md`. Four-tier role model (`communications_admin`/`communications_manager`/`communications_agent`/`viewer`), independent from CRM/Sales/Marketing/Brain, with organization owner/admin bootstrap. Sales OS/Marketing OS permissions never automatically grant Communications sending ability — verified directly.

## APIs

Thin authenticated routes under `/api/organizations/{organizationId}/communications/...`, identical shape to every other module's own routes. The one exception is the dedicated webhook route (`/api/integrations/{provider}/{connectionId}/webhook`), which deliberately never uses `getAuthenticatedUser` — a real provider callback has no human session.

## UI

9 pages under `/app/[organizationSlug]/communications/...` and `.../integrations/...` — dashboard, inbox, conversation detail (timeline, compose, agent-draft actions, approval/send controls), templates, batches, consent/suppression, settings (seeding + role grants), integrations list, connection detail (verify/credential/disable). Every page reuses the shared premium UI primitives (`Card`, `Badge`, `PageHeader`, `EmptyState`, `FormField`/`SelectField`/`SubmitButton`, `ActionForm`) — no parallel UI system. No drag-and-drop. One known UI gap: the templates page supports creation but not publishing a version from the UI (publishing is fully implemented at the service/API layer, exercised directly by tests and the manual E2E script) — see "Remaining blockers" in the final report.

## Audit events

24 new event types added to `src/lib/audit.ts`'s `AuditEventType` union, under a dedicated "Communications & Integrations Core — Module 16" comment block: `integration_connection_created`/`_verified`/`_disabled`, `integration_credential_rotated`, `communication_permission_granted`/`_revoked`, `communication_send_permission_denied`, `communication_conversation_created`, `communication_message_draft_created`/`_approved`/`_queued`/`_sent`/`_delivered`/`_failed`/`_received`, `communication_provider_event_received`/`_deduplicated`, `communication_template_created`/`_version_published`, `communication_consent_updated`, `communication_suppressed`, `communication_bulk_created`/`_cancelled`, `communication_agent_draft_created`. Metadata is always ids/enums/counts — never a message body, full recipient identity, or provider secret.

## Concurrency results

13 tests in `src/lib/communications-os/concurrency.integration.test.ts`, all passing: duplicate idempotency key rejected, two racing send-job claims (exactly one wins), delivery events idempotent, out-of-order delivery events never regress status, duplicate webhook processed once, racing queue-for-send (revision-guarded, one wins), approval revoked before send blocks, consent/suppression added after queueing blocks the actual send, a disabled connection blocks the actual send, a provider-timeout-simulated message is never blindly resent (reconciliation marks it failed for human review), duplicate external thread reuses the existing conversation, duplicate external identity mapping controlled, duplicate bulk recipient prevented.

## Manual end-to-end result

See the final report for the full connection → contact → conversation → draft → agent-draft → approval → queue → real-worker-driven send → CRM activity → delivery event → inbound reply walkthrough, executed against the real database and the real Runtime job queue/worker (`pollAndProcess`), since this environment has no browser automation available and no real Resend credential to exercise a genuine external send.

## Deferred (explicitly, per spec)

Twilio SMS and WhatsApp Cloud API production implementations, full bulk-campaign-blast orchestration beyond bounded/small batches, a per-organization Resend account model (a single platform-wide webhook secret is assumed for v1), jurisdiction-specific legal automation beyond storing/enforcing configured consent state, Slack/Teams/calendar/social/ads/storage integrations, Analytics OS, Founder Workspace, Kids Coding, Home Renovation Rebates.

## Update (LYNQ Analytics OS, Module 17, now complete)

Analytics OS reads this module's own canonical message/conversation tables through 6 read-only metrics (`communications_messages_sent`, `communications_messages_delivered`, `communications_messages_failed`, `communications_inbound_messages`, `communications_delivery_rate`, `communications_conversations_active`) — every one independently re-checking this module's own unmodified `requireCommunicationsViewAuthority`. `communications_messages_delivered`'s own description states explicitly that development providers never produce a real delivery event, so it is always 0 for an org using only dev providers — verified directly by a functional test that sends a message through a dev provider and confirms `sent = 1, delivered = 0`. Message bodies never surface through any Analytics endpoint: a functional test seeds a message with a distinctive secret body string and asserts the full analytics query response never contains it, while confirming via a direct database read that the string really was stored. This module's own service functions, schema, and authorization are entirely unchanged. See `MODULE_17_ANALYTICS_OS.md` and `MODULE_17_ANALYTICS_AUTHORIZATION_AND_PRIVACY.md`.

## Update (LYNQ Founder Workspace / Executive OS, Module 18, now complete)

The executive attention engine's own `high_message_failure_rate`/`disabled_integration_required_by_active_workflow` rules read this module's own canonical `communication_messages`/`communication_conversations`/`integration_connections` tables directly. Approvals originating from this module (via `communication_approval_links`) are surfaced in the Founder Approval Center with `requestingSystem: "communications"` — decided through this module's own real, unmodified Agent Runtime approval functions, never a second approval path. This module's own service functions, schema, and authorization are entirely unchanged. See `MODULE_18_FOUNDER_WORKSPACE.md`.
