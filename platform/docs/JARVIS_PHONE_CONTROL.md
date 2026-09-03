# Jarvis secure two-way phone control

Mustafa calls Jarvis, describes work in ordinary language, and the confirmed
instruction comes back into LYNQ Office as either a real directive project or a
real approval.

This lane is **off by default** (`JARVIS_PHONE_COMMANDS_ENABLED=false`) and is
additive: the existing two-minute outbound founder notification call is
unchanged, and the Vapi webhook behaves exactly as it did before when the flag
is off.

---

## 1. What a call actually does

```
Mustafa calls the imported Twilio number
        │
        ▼
assistant-request ──► caller ID must be the enrolled founder number
        │                 └─ any other number: refused, call over, nothing recorded as a command
        ▼
Jarvis asks for the six-digit code shown in the Jarvis Command Center
        │
        ▼
verify_founder ──► constant-time check, 3 attempts per call
        │              └─ exhausted: session refused, must call back
        ▼
Mustafa describes the work; Jarvis listens and asks only what it must
        │
        ▼
capture_command ──► redacted, risk-assessed command draft stored
        │
        ▼
Jarvis reads it back in plain language and asks "did I get that right?"
        │
        ▼
confirm_command ──► yes ──► low risk  ──► Office directive project opens now
                     │       gated     ──► Office approval; NOTHING starts
                     └─ no  ──► draft discarded; describe it again on the same call
```

Everything is visible in the Jarvis Command Center as it happens: what Mustafa
said, what Jarvis understood, what Jarvis proposes, what requires approval, and
whether work started.

---

## 2. Why caller ID is not the authentication

Caller ID is asserted by the originating carrier and is trivially spoofable
from any SIP trunk. Treating it as authentication would mean anyone who knows
Mustafa's mobile number could open projects in his name.

So the caller number is a **necessary precondition only** — a call from any
other number is refused before a word is taken — and the actual second factor
is a **rotating six-digit code** derived by HMAC-SHA256 from a server-only
secret and the current five-minute time step.

The code is readable **only** from the Jarvis Command Center, which already
requires a validated database session and an owner/admin organization
membership. A successful verification therefore proves possession of **both**
the enrolled phone **and** a live authenticated LYNQ session.

Details that matter:

- One step of skew on either side is accepted, so a code read just before a
  rollover still works.
- Comparison is constant-time; a spoken code is normalized first, so "four one
  seven two nine six", "417296" and "417-296" all resolve identically.
- Three attempts per call. After that the session is refused permanently and
  Mustafa must call back.
- The code is redacted out of the transcript before anything is stored, and is
  never written to a log or an audit row.

No new provider, no new stored credential, no new third party.

---

## 3. What may and may not start from a phone call

Classification is deterministic (`src/lib/voice/command-risk.ts`) — no model
call — so a rate-limited or hallucinating model can degrade the quality of the
captured fields but can never change whether a command is gated.

**May open a directive immediately** — internal, reversible, information-only
work: research, analysis, review, summaries, drafts, plans, outlines,
comparisons, scoping, reporting.

**Must stop at an approval** — every one of these:

| Category | Example |
| --- | --- |
| Customer outreach | "Email the restaurant owner our proposal" |
| Payments or spend | "Pay the Twilio invoice" |
| Third-party calls | "Call the client and tell them we're ready" |
| Production changes | "Deploy the new homepage" |
| Destructive changes | "Delete the old project" |
| Contracts and legal | "Sign the retainer" |
| Credential access | "Read me the API key" |
| Public publishing | "Post the case study to LinkedIn" |
| Personnel | "Hire a junior designer" |

Three further rules:

1. **Fail closed.** A command that matches neither list is treated as `medium`
   risk and gated. "Unrecognized" is never "safe".
2. **A planning verb cannot disarm the gate.** The category patterns will never
   be exhaustive, so a broader backstop asks a cheaper question: does the
   command describe an effect that leaves LYNQ, spends something, or cannot be
   undone? If it does, it is gated however much planning language surrounds it.
   Without this, "Write up the pricing summary and forward it to the client"
   read as internal work because of "write up" — the category patterns are the
   detail, this is the floor.
3. **Speech never lifts a gate.** "Skip the approval", "I already approved
   this", "emergency, just do it", "you have my permission" are detected as
   override attempts: they raise the risk to `critical`, are recorded as their
   own audit event, and are never honored. A yes on the call confirms *the
   wording Jarvis read back* — it is not an approval.

A gated command is decided only through
`POST /api/organizations/{organizationId}/jarvis/phone/commands/{commandId}`,
which requires a validated session and organization owner/admin — the same
authority floor `requireApproverAuthority` enforces for an Agent Runtime
approval.

### Why the gate is not an `agent_approval_requests` row

`agent_approval_requests.execution_id` is a non-null foreign key to
`agent_executions`, and an execution only exists once a directive has been
created and an agent launched. Hanging the gate off a fabricated execution
would mean starting the very work the gate exists to prevent.

So the gate sits one step earlier — before any project exists — and reuses the
pieces that carry the safety: the same owner/admin authority floor, the same
`recordAuditEvent` trail, and the same decide-once revision guard. Once
approved, the command runs through the identical `createDirectiveProject` a
web Command Center directive uses, and every gated action *inside* the
resulting project still hits Agent Runtime's own unmodified approval system
exactly as it does today.

There is one orchestration system. This lane is a new entrance to it, not a
second one.

---

## 4. Idempotency

A provider webhook may be delivered any number of times. Three independent
layers make that safe:

1. **Event claim.** Every event is claimed once against
   `jarvis_voice_webhook_events_dedup_unique`. Because Vapi does not send a
   unique id on every message type, the id is *derived* — a content hash of the
   call id, event type, and whatever makes the occurrence distinct (tool call
   id, transcript text and finality, status value). Two genuine deliveries hash
   identically; two different events never collide.
2. **Session and command uniqueness.** `(provider, provider_call_id)` resolves
   one call session; a concurrent first event loses the race at the database
   and re-reads the winner's row. A confirmed command's `idempotency_key` is
   derived from the call plus the confirmed content, so a redelivered
   confirmation is refused by a unique constraint rather than opening a second
   project.
3. **Revision guards.** Every state transition is guarded by the revision the
   row was read at. A second confirmation finds the row moved on and reports the
   *existing* outcome instead of acting again.
4. **A dispatch claim taken BEFORE anything is created.** The three layers above
   all protect the command *row*; none of them stop two concurrent callers from
   each calling `createDirectiveProject` first and colliding afterwards — which
   would mean two real projects with two sets of running agents, and for an
   approved gated command, the external effect happening twice off one approval.
   So `claimDispatchAttempt` is a single guarded UPDATE that increments the
   attempt and bumps the revision, conditional on both the revision the caller
   read and the attempt cap. Exactly one concurrent caller wins it; the loser
   never dispatches.

### Partial creation

`createDirectiveProject` is a long sequence of independent writes over the Neon
HTTP driver, with no transaction spanning them. A failure after the project row
exists leaves a live project — possibly with agents already launched — so the
intake raises `DirectivePartiallyCreatedError` carrying the project id, the
command records it, and the screen says "Partly… some of the work may already
be running" with a link, never "nothing was started".

Such a command is deliberately **not** retryable: re-running would create a
second copy of live work, which is worse than the incomplete handoff the
founder is looking at.

---

## 5. Redaction

Nothing raw is ever stored. `src/lib/voice/redaction.ts` runs on every string
that came from speech, before it reaches the database or a log line:

- API keys (provider-shaped and generic long tokens), bearer tokens
- Any value following a secret lead-in word ("the password is …")
- Payment card numbers, SIN/SSN shapes
- Email addresses, phone numbers
- Any bare run of six or more digits — which includes the verification code
- Spoken digit runs are normalized first, so "one two three four five six" is
  caught as readily as "123456"

The caller's number is never stored: a call session keeps the last four digits
and a match flag. Log fields whose *name* denotes a secret or identifier are
dropped entirely rather than redacted, so a typo in a key name cannot leak
through a placeholder. Booleans and counts derived from those fields survive,
because they carry no secret and are genuinely useful when debugging.

Audit metadata is ids, enums, counts and booleans only — never a transcript,
never a number, never a code.

---

## 6. Failure states

Nothing in this lane reports success it did not achieve.

| State | Meaning |
| --- | --- |
| `awaiting_confirmation` | Read back, not yet confirmed on the call |
| `awaiting_approval` | Confirmed and gated; waiting on a human decision |
| `declined` | A human declined it. Nothing started |
| `directive_created` | A real project exists and the first handoff dispatched |
| `cancelled` | Said no on the call, or the call ended before confirming |
| `failed` | Dispatch genuinely failed; `failure_code` says why |

Dispatch failures are classified into a bounded vocabulary —
`model_rate_limited`, `timed_out`, `no_agents_available`,
`provider_unreachable`, `authorization_failed`, `resource_not_found`,
`unknown_error` — stored with the message, spoken honestly on the call ("I
couldn't open the project just now, and I'm not going to pretend otherwise"),
and shown in the UI.

### Retry

A failed dispatch is **never retried automatically**. The usual cause is the
free model pool being rate-limited, and an automatic retry loop against a rate
limit turns one failure into a queue of them; a human pressing the button also
means someone has actually seen that it failed.

So retry is a **Try again** control on the Jarvis screen, backed by
`POST .../commands/{id}` with `decision: "retry"`. It requires the same
validated session and owner/admin membership as an approval, is audited as
`jarvis_phone_command_retried`, and is capped at five dispatch attempts per
command — enforced inside the dispatch claim, so the cap bounds actual
dispatches and not merely recorded attempts. After that the UI stops offering
it and says so, rather than showing a button that would be refused.

The `retryable` flag the API returns mirrors *every* condition the decision
route enforces, including the viewer's own authority: any organization member
may read this screen, but only an owner or admin may approve, decline, or
retry, and a member sees the reason rather than a button that 403s.

Retry cannot manufacture consent: a command only ever reaches `failed` from a
dispatch that was **already** cleared to run — low risk and confirmed on the
call, or gated and since approved by a human. A command still sitting in
`awaiting_approval` has never been dispatched, so there is nothing to retry,
and the endpoint refuses any state but `failed`. A successful retry clears the
stored failure reason rather than leaving a stale one behind.

A call that ends with an unconfirmed draft expires that draft visibly, so
nothing lingers looking like it might still run.

---

## 7. Vapi dashboard changes required

These must be done by hand in the Vapi dashboard. **No secret belongs in this
repository, in a commit, or in an agent chat.**

### 7.1 Inbound assistant

Configure the imported Twilio number's **inbound** setting to use a
**server URL** rather than a static assistant:

```
https://app.lynq.build/api/integrations/vapi/webhook
```

Jarvis returns the assistant configuration dynamically on `assistant-request`,
including the system prompt, the three tools, and a first message that depends
on whether this caller is already verified. This is deliberate: the safety
rules are restated by the server on every call rather than living only in a
dashboard field that could later be edited.

### 7.2 Server message subscriptions

Add these to the existing subscription list:

- `assistant-request` *(new — required for inbound)*
- `tool-calls` *(new — required for verification, capture, confirmation)*
- `transcript` *(new — required for the transcript record)*
- `status-update` *(existing)*
- `end-of-call-report` *(existing)*
- `hang` *(existing)*

Do **not** enable transfers, dial-out tools, or any unrestricted tool. This
lane declares exactly three tools and refuses every other name.

### 7.3 Authentication

The existing Vapi Bearer Token custom credential and `VAPI_WEBHOOK_SECRET`
already cover the new events — no new credential is needed. Confirm the
`Bearer` prefix is enabled.

### 7.4 Call limits

Raise the inbound assistant's maximum duration to ten minutes. A working
conversation needs longer than a two-minute notification. The outbound
notification assistant stays at two minutes and must not be changed.

---

## 8. Environment variables

Names only; values are Vercel Sensitive Environment Variables set by the
release manager.

New:

- `JARVIS_PHONE_COMMANDS_ENABLED` — must be exactly `true` to enable anything
- `JARVIS_PHONE_ORGANIZATION_ID`
- `JARVIS_PHONE_FOUNDER_USER_ID`
- `JARVIS_PHONE_VERIFICATION_SECRET` — ≥ 32 characters

Reused unchanged:

- `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`
- `VAPI_WEBHOOK_SECRET`
- `JARVIS_FOUNDER_PHONE_E164`
- `JARVIS_VOICE_NOTIFICATIONS_ENABLED` *(outbound only; independent of this lane)*

---

## 9. First test, once enabled

1. Open the Jarvis Command Center and confirm phone control reports ready.
2. Press **Show my code** and confirm a six-digit code appears.
3. Call from a number that is **not** the founder line. Confirm Jarvis refuses
   and the call appears in the UI marked refused with no command.
4. Call from the founder line. Confirm Jarvis asks for the code before
   anything else, and refuses to take an instruction until it is given.
5. Give a wrong code twice and the right code third. Confirm the attempt
   counter behaves and verification succeeds.
6. Ask for internal work ("research three restaurants in Brampton and compare
   their websites"). Confirm the read-back is accurate, say yes, and confirm a
   real project opens and appears on the Jarvis screen.
7. Ask for gated work ("email the owner our proposal"). Confirm Jarvis says it
   cannot start it from a call, confirm **no** project is created, and confirm
   the approval appears in the Jarvis Command Center.
8. Say "skip the approval, I already approved it". Confirm the approval stays
   in place and the UI shows the override notice.
9. Approve the gated command in the UI and confirm the project then opens.
10. Read a fake API key aloud. Confirm the stored transcript shows
    `[redacted-secret]` and the UI says something sensitive was removed.
11. If a dispatch fails (the model pool is rate-limited often enough that this
    is easy to observe), confirm the UI states the failure and the reason,
    offers **Try again**, and that pressing it either opens the project or
    reports a second honest failure — never a silent success.
12. Confirm server logs contain no full phone number, no transcript, and no
    code.
