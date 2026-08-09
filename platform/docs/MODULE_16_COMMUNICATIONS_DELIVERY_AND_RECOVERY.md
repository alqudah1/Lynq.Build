# Module 16 — Communications Delivery & Recovery

Companion to `MODULE_16_COMMUNICATIONS_CORE.md`. Full detail on the outbound send claim/concurrency hardening, inbound webhook processing, delivery-event precedence, CRM activity integration, and reconciliation.

## The outbound claim — concurrency hardening

`messages.ts`'s `processSendJob` is the `communication_send` Runtime job's handler. The `queued → sending` transition is the atomic claim step, mirroring Module 14's `agent_execution` node claim discipline exactly:

```
1. resolveMessageById — if status !== "queued", return {outcome: "skipped_not_queued"} immediately.
2. transitionMessageStatus(queued -> sending) — the atomic claim.
3. Live-recheck: recipient present, suppression, connection usable, rate limits.
4. Call the real provider adapter.
5. Apply the outcome: sent / failed / uncertain (left at "sending").
```

**A concurrency bug found and fixed during this module's own testing** (see "Bugs discovered" in the final report): `transitionMessageStatus` originally re-read the message's current status fresh inside itself, then asserted the transition was valid, then performed a revision-guarded `UPDATE`. Under two callers racing the same claim, the LOSER's fresh re-read could observe the WINNER's already-updated status (`"sending"`) and fail `assertTransitionAllowed("sending", "sending")` with a confusing `InvalidMessageTransitionError` — instead of the intended `StaleCommunicationUpdateError`, which `processSendJob`'s own catch block is specifically written to treat as a safe no-op. The fix: `transitionMessageStatus` now takes the caller's own already-known `fromStatus` (never re-read), and the UPDATE's `WHERE` clause includes BOTH `status = fromStatus` AND `revision = expectedRevision` — making the whole claim genuinely atomic. A losing caller's `UPDATE` simply matches zero rows, regardless of what the winner changed the status to. Verified directly: `concurrency.integration.test.ts`'s "two workers cannot send the same message twice" test races two `processSendJob` calls and asserts exactly one reaches `"sent"`, the other `"skipped_not_queued"`.

## Live re-checks — "permissions must be revalidated before send"

Every precondition is re-checked at the moment of actual dispatch, never trusted from queue time:

- **Approval revoked**: `revokeMessageApproval` moves an `approved`/`queued` message to `cancelled`. There is no Runtime-level "revoke an approved approval" primitive (approvals are decided once); this is modeled entirely at the Communications OS layer. The claim step's own atomic `WHERE status = "queued"` naturally refuses a message that's been cancelled in the meantime.
- **Consent/suppression revoked**: `processSendJob` calls `getActiveSuppression` live, immediately before dispatch — a suppression added AFTER queueing (but before the worker runs) is caught here, not just at queue time.
- **Connection disabled**: `requireConnectionUsable` is re-checked live; a connection disabled after queueing fails the send with `failureClass: "connection_disabled"`.
- **Rate limits**: enforced live via `enforceSendRateLimits`, immediately before the provider call.

## Inbound webhook processing

`webhooks.ts`'s `processInboundProviderEvent`:

```
authenticate (API route layer, provider signature or dev shared secret)
→ deduplicate (unique index on provider + connectionId + externalEventId)
→ normalize (adapter.normalizeInboundEvent / normalizeDeliveryEvent)
→ resolve connection
→ resolve conversation (findOrCreateConversationUnauthorized)
→ resolve contact conservatively (resolveContactByIdentity)
→ persist canonical message (ingestInboundMessage)
→ real CRM activity
```

Deduplication is the FIRST move — the insert into `communication_provider_events` is the dedup gate itself (a unique-constraint violation means "already processed," recorded as `communication_provider_event_deduplicated` and returned as `"duplicate"`), so a genuinely duplicate webhook delivery (every real provider retries at-least-once) can never create a second message or a second CRM activity. Verified directly, including under real concurrency (`Promise.all` on two identical webhook calls).

## Delivery-event precedence — never regressing state

`recordDeliveryEvent` applies a fixed precedence rank (`accepted` < `sent` < `delivered`/`bounced`/`rejected`/`failed` < `read`) and only ever moves a message FORWARD:

```ts
const newRank = STATUS_PRECEDENCE[input.eventType];
if (newRank < currentRank) return; // Out-of-order — never regress.
if (message.status !== "sent" && message.status !== "sending") return; // Only in-flight messages move.
```

A late-arriving "sent" event after a "delivered" event has already been recorded is a safe no-op — the message stays `"delivered"`. Verified directly (`concurrency.integration.test.ts`'s "out-of-order delivery events never regress message status"). Delivery-event recording is itself idempotent — a duplicate `providerEventId` hits the table's own unique partial index and is caught, never creating a second delivery-event row or reapplying a status change twice.

## CRM activity integration — only for real events, with the right actor

`crm-integration.ts`'s `recordCommunicationCrmActivity` is called from exactly two places: `processSendJob` (after real provider acceptance — `"sent"`) and `ingestInboundMessage` (real receipt). Never at draft time.

**A real bug found and fixed during testing**: the initial implementation used `sent.createdByUserId ?? orgOwner` as the CRM activity's acting user — but a Communications-role-only sender (e.g. `communications_agent`) typically holds no CRM authority at all, since the two permission systems are deliberately independent (see `MODULE_16_COMMUNICATIONS_AUTHORIZATION_AND_PRIVACY.md`). Using the drafting human as the CRM-activity actor meant `createActivity`'s own `requireCrmManageAuthority` gate would silently fail for the common case, and the failure was swallowed by a defensive `.catch()` — so a real send would produce no CRM activity at all, with no visible error. Fixed: `resolveOrganizationOwnerUserId` (the org owner, who always holds CRM manage authority via the same bootstrap rule every module relies on) is now used unconditionally for this system-triggered write, mirroring Sales OS's own `systemActorUserId` pattern for its sequence-advancement sweep. Verified directly: `functional.integration.test.ts`'s "a draft does not create a CRM activity; a real send does" test creates the draft as a plain `communications_agent`-role user (never CRM-privileged) and asserts a real CRM activity still appears after send.

References only — `recordCommunicationCrmActivity`'s `summary` field never contains the message body, matching CRM Core's own "no full body duplication" rule for every activity type.

## Reconciliation — the uncertain-outcome sweep

`reconciliation.ts`'s `reconcileCommunications` (the `communication_reconcile` Runtime job) is the resolution path for exactly the state `processSendJob` leaves on purpose: a message stuck at `"sending"` past `RUNTIME_CONFIG.executionStuckThresholdSeconds` (the same threshold Module 9 already uses elsewhere) means the provider's own outcome for that specific attempt was never confirmed. The sweep does **not** blindly resend — it marks the message `"failed"` with `failureClass: "provider_timeout"`, a terminal, human-inspectable state. A human must explicitly create a FRESH message (a new idempotency key) to retry; this sweep never has the authority to do so itself, and no code path in this module auto-generates a retry message. Verified directly: a message is moved to a stale `"sending"` state, a concurrent `processSendJob` re-run on it is confirmed to be a safe no-op (`"skipped_not_queued"` — it's no longer `"queued"`), then `reconcileCommunications` is run and confirmed to mark exactly that one message `"failed"`.

## What reconciliation deliberately does not do

- Does not retry a `"failed"` message automatically, regardless of `failureClass`.
- Does not resolve a message stuck at `"queued"` (that state has no ambiguity — the worker simply hasn't picked it up yet; the existing `communication_send` job's own lease/retry mechanics, inherited unchanged from Module 9's queue, handle that).
- Does not touch provider events or delivery events — those are self-contained, idempotent by construction, and need no sweep.
