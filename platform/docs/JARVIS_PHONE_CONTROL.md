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
Jarvis asks for the eight-digit code shown in the Jarvis Command Center
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
is a **rotating eight-digit code** derived by HMAC-SHA256 from a server-only
secret and the current five-minute time step.

Eight digits, not six, and the arithmetic is the reason. One step of skew is
accepted on either side, so three codes are live at once and a single guess
wins with probability 3/10^digits. The budgets an attacker faces below allow
roughly 1.6 x 10^5 guesses a year from a spoofed line; at six digits that is
about a two-in-five chance of a hit within a year, and at eight it is under one
percent. Two extra digits cost a founder about a second of reading. Every
sentence in the product that mentions the length is generated from the
constant, so the copy and the code cannot drift apart.

The code is readable **only** from the Jarvis Command Center, which requires a
validated database session, an owner/admin organization membership, **and**
that the signed-in account is the one named by `JARVIS_PHONE_FOUNDER_USER_ID`.
A successful verification therefore proves possession of **both** the enrolled
phone **and** a live authenticated session belonging to the founder.

The founder-only floor is deliberately tighter than owner/admin. The code is
scoped by time, not by user, so any account that can mint it holds the second
factor for a first factor this document already calls spoofable — an admin
could then act as the founder from any phone. The configuration names exactly
one founder account, so the narrower rule costs nothing. Everyone else, including
other owners, is told plainly that the code is not theirs; the panel is hidden
for them rather than offering a button that would be refused.

Details that matter:

- One step of skew on either side is accepted, so a code read just before a
  rollover still works.
- Comparison is constant-time; a spoken code is normalized first, so a code
  read as words, as digits, or with hyphens all resolve identically.
- The number is a **precondition, and it must be positively met**. A refusal
  needs evidence of a *wrong* number, not merely the absence of a right one, so
  a delivery carrying no `customer` object is not recorded as a mismatch — but
  it is not clearance either, and the difference between those two is where
  this went wrong twice. Treating absence as a mismatch refused calls that had
  already verified and, on a first delivery, stamped a session unmatched for
  good; treating "not refused" as "cleared" then handed a caller who simply
  withholds caller ID the full system prompt, all three tool declarations and
  ten minutes of model time.

  So there are three states, not two. A number that matched: the working
  assistant. A number that was supplied and did not match: refused, with the
  closed twenty-second assistant. A number never supplied: **not** refused, no
  audit finding, and the same closed assistant — no tools are declared and no
  tool call is answered — until a later delivery carries the founder's number,
  which promotes the session and lets the call proceed normally.
- Three attempts per call, enforced in the `UPDATE` statement itself rather
  than against a count read earlier in the request, so concurrent deliveries
  cannot jointly exceed it. A verified session is never walked back to
  unverified by a late failing attempt.
- A **cross-call** ceiling on top of that: a redial resets the per-call
  counter, so a limit keyed on a one-way identifier derived from the caller's
  number (never the number itself) caps attempts across calls. It fails closed
  — if the rate-limit backend is unreachable, verification is refused.
- A **call** ceiling as well, and it is deliberately two ceilings rather than
  one. A call asserting the founder's exact number spends a **founder-line**
  budget of six an hour. Every other call spends a separate **refused-call**
  budget of twenty an hour. Without either, everything before verification was
  free — a spoofed line matching the founder's number was not refused, and each
  redial opened a session row, wrote a start audit entry, was handed a
  ten-minute assistant, and could write unbounded transcript turns that the
  Jarvis screen renders as the founder's own words. The passcode budget bounded
  none of it, because an attacker who never guesses never spends a passcode
  attempt.

  The split is the correction to a first version that keyed one budget on the
  caller's last four digits and charged it *before* the caller-number
  precondition ran. It was wrong in both directions at once: six calls from an
  unrelated line sharing those four digits exhausted the founder's allowance —
  and the founder, dialling from the real phone, was then refused with "I'll
  only work with the founder's registered line, and this isn't it", from a
  branch that had never looked at their number — while an attacker rotating the
  asserted suffix simply got a fresh bucket per suffix and was bounded by
  nothing. The founder-line budget is now keyed on the tenant and spent only on
  an exact match, so only the founder can spend it; the refused-call budget is
  keyed on the tenant alone, which is the one thing in the request a caller
  cannot vary. A caller who hits the founder-line ceiling is told so honestly,
  in its own words, and never with the wrong-number refusal.

  A caller who has not verified may also write at most 25 transcript turns; the
  call keeps running and verification still works, but nothing further is
  stored. Both budgets are charged **once per call**, by exactly one
  delivery, and the admission answer is that delivery's own atomic increment.
  Getting this right took five attempts, and each failure is worth recording
  because each looked reasonable:

  - charging on a particular event KIND meant any other inbound-typed delivery
    landing first created the session unconditionally, after which the budget
    was never entered again and the whole call, and every redial, was free;
  - deciding from a read — check, then charge — made it two statements with no
    transaction, so forty simultaneous calls all read the same count, all
    passed, and all were admitted against a cap of twenty: the cap failing in
    exactly the concurrent case a flood arrives in;
  - letting a NON-paying delivery consult a budget of its own broke it a third
    way, because which bucket a delivery picks depends on whether *that
    delivery* carried the caller's number and not every delivery does — so one
    call could pay into the wrong-number bucket and then be admitted against a
    founder-line bucket it had never incremented.

  - and reading the session row instead answered the wrong question, because
    "no session yet" means either "the payer was refused" or "the payer was
    admitted and its insert has not landed" — so a founder whose
    assistant-request was merely retried was told the line was busy,
    permanently, since that event keeps its idempotency claim and every retry
    repeats the answer.

  The through-line is that each version tried to re-derive a decision that had
  already been made. So the decision is now RECORDED where it is made: the
  paying delivery increments the real budget and, if refused, claims a refusal
  marker for that call. Every other delivery reads the marker. No marker means
  the call was admitted — or is still being decided, and both of those are
  admitted, which is the safe direction and bounded by the provider's delivery
  concurrency.
- **The founder-line budgets are refunded the moment a caller verifies**, and
  all three are visible and clearable from the Jarvis screen — the refused-call
  budget included, because a founder call the provider sent no number for lands
  in that one, and leaving it out of the lockout state and the clear was the
  same invisible wall moved to a different bucket. The screen reports the two as
  different things, because they are: "Jarvis is turning down calls from your
  number" is the founder's own budget, while a filled refused-call budget is
  other people's calls, does not stop the founder's, and says so — folding it
  into one "locked" flag made the screen blame the founder for a flood they had
  no part in, and offer to clear a cost control that was not theirs.

  This matters more than it looks: the keys are derived from the number a caller *asserts*, so anyone who
  can spoof the founder's line can spend both and hold them at zero — and the
  founder, calling from the real phone, is then refused before their correct
  code is ever checked. A rate limit an attacker can hold down is a
  denial-of-service primitive aimed at the person it protects. The refund means
  any window in which the founder gets through resets both; the screen shows
  the lockout in plain language with the time it clears; and "Let me call in
  again" clears it immediately. Clearing grants nothing — the code, the
  three-try cap and the number check all still apply — and it is audited as
  `jarvis_phone_verification_lockout_cleared`.
- The code is redacted out of the transcript before anything is stored, and is
  never written to a log or an audit row. Redaction and verification share one
  digit vocabulary and one scanner, so "what verification accepts, redaction
  removes" is structural rather than two lists that have to be kept in step.
  They were once separate implementations that disagreed, and the disagreement
  meant the live code sat in plaintext in a transcript any organization member
  can read.
- The Command Center's code response carries `Cache-Control: no-store` and
  `Referrer-Policy: no-referrer`, and issuance is rate limited so an automated
  client cannot drown the `jarvis_phone_passcode_issued` audit trail.

No new provider, no new stored credential, no new third party.

---

## 3. What may and may not start from a phone call

> **By default, nothing starts from a phone call on its own.**
>
> `JARVIS_PHONE_AUTO_DISPATCH_ENABLED` is off, and while it is off every
> confirmed command — including one the risk classifier judges low-risk —
> stops at an approval in LYNQ Office. The classifier still runs: it sets the
> risk level, the gated categories and the plain-language reasons the approval
> screen shows. What it does not do is decide whether work starts.
>
> This is not caution for its own sake. `assessCommandRisk` is a deterministic
> lexical classifier over speech-to-text. It has been designed five times and
> adversarially reviewed ten, and the tenth review measured the fifth design at
> **139 of 315 deliberately dangerous phrasings cleared** — DNS cutovers,
> privilege grants, CRM deletion, publishing to the live site, a salary change
> — while gating **38 of 40 ordinary internal requests** written by someone who
> had not seen its vocabulary.
>
> Both numbers come from one property, and it is worth stating plainly because
> it will recur: every round of tuning was measured against corpora written
> alongside the vocabulary. The gate looked accurate on the sentences it had
> been fitted to, and was neither safe nor usable on the ones it had not. Each
> round's specific holes are closed and each is a regression test, but the
> reason to expect an eleventh round to find more is that ten rounds did.
>
> A one-tap approval on a screen the founder is already looking at — it is
> where the verification code is displayed — is a cheap control. Turning
> auto-dispatch on trades that tap for the classifier's judgment. Make that
> trade deliberately, after reading §3 and the residual risks at the end, not
> because the flag was there.

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

A provider webhook may be delivered any number of times, and two people can
act on the same command at once. Four independent layers make that safe:

1. **Event claim.** Every event is claimed once against
   `jarvis_voice_webhook_events_dedup_unique`. Because Vapi does not send a
   unique id on every message type, the id is *derived* — a content hash of the
   call id, event type, and whatever makes the occurrence distinct (tool call
   id, transcript text and finality, status value). Two genuine deliveries hash
   identically; two different events never collide.

   The claim stops the *side effects* happening twice. It is not an answer, and
   for two event kinds Vapi is waiting on one: a tool result lives in `results`
   and an assistant config lives in `assistant`, and a bare `{received:true}`
   carries neither. So a redelivered **tool call** is answered with the same
   sentence the first delivery produced, replayed from `response_text` on the
   event row — and when that column is still empty, meaning the first delivery
   has not finished, with an honest "still working on that one" rather than an
   invented outcome. A redelivered **assistant request** is rebuilt rather than
   replayed: its handler is read-only apart from `ensureCallSession`, which is
   idempotent and audits only a genuine creation, and the config depends on
   live state. Without this, a `confirm_command` that outran the provider's
   timeout — the normal case, since creating a directive means an LLM plan and
   a chain of writes — left the assistant with no result at all while a real
   project was being created behind it, and one transient failure on an
   `assistant-request` permanently bricked the call it belonged to.
2. **Session and command uniqueness.** `(provider, provider_call_id)` resolves
   one call session; a concurrent first event loses the race at the database
   and re-reads the winner's row. A confirmed command's `idempotency_key` is
   derived from the call plus the confirmed content, so a redelivered
   confirmation is refused by a unique constraint rather than opening a second
   project.
3. **Revision guards.** Every state transition is guarded by the revision the
   row was read at. A second confirmation finds the row moved on and reports the
   *existing* outcome instead of acting again.
   A draft waiting for a confirmation is reaped on the same principle. Its only
   normal writer is `finalizeCall`, on the provider's end-of-call delivery — and
   a state whose only exit depends on one event arriving is a state that
   eventually wedges: lose that delivery to a database blip, a provider that
   stops retrying, or a payload the classifier could not place, and the founder
   is looking at "Waiting for you to confirm on the call" on a call that ended,
   permanently, with no button. `reapAbandonedDraft` expires a draft whose call
   is no longer active, or has been silent for longer than any call can last, on
   the read path.

   That silence clock is `jarvis_call_sessions.last_event_at`, and it is written
   by every provider delivery the lane ACCEPTS. Both halves of that sentence
   were once wrong. It was driven only by transcripts and status updates, so on
   a deployment whose provider subscription omits transcripts a live call looked
   silent within minutes and a member loading the screen could cancel a draft
   out from under a founder still describing it. Then it was written for every
   delivery including the refused ones, which let a caller whose number was
   never established keep an unusable session looking alive for ever — the
   screen saying "On the call" and the session reaper never firing because its
   clock kept moving.

   The session is reaped the same way and for the same reason. An ambiguous
   event lost during a database blip is acknowledged rather than retried, so
   `completeCallSession` can simply never run, and the row then stays `active`
   for good. `reapUnfinishedCallSession` ends such a call with
   `failure_code = call_end_not_received`, which says what actually happened:
   not that the call failed, but that nobody reported it ending. The guard
   against a tool call arriving after a call has ended no longer waits for
   that — it refuses a tool call on a session OLDER than `MAX_CALL_AGE_MS`, so a
   reordered, replayed or forged delivery cannot open a project after a call is
   over even if nobody has loaded the screen. Age since the call began,
   deliberately, and not time since its last event: a tool call is one of the
   deliveries that marks a call alive, so a guard reading that clock would be
   reset by the very deliveries it exists to refuse. And a separate, generous
   bound rather than the silence window, because on a deployment with a
   statically assigned assistant the call's real ceiling lives in the provider's
   dashboard rather than in this code — a twenty-minute cap here would tell a
   founder twenty-one minutes into a working call, having just heard the
   read-back, that the call had already ended.

   Removing the wedge as a class is also what lets the webhook go on
   acknowledging an ambiguous event exactly as it did before phone control
   existed, rather than answering 5xx on an endpoint the outbound notification
   lane shares.

4. **A dispatch claim taken BEFORE anything is created**, which also moves the
   row into `dispatching`. The three layers above all protect the command
   *row*; none of them stop two concurrent callers from
   each calling `createDirectiveProject` first and colliding afterwards — which
   would mean two real projects with two sets of running agents, and for an
   approved gated command, the external effect happening twice off one approval.
   So `claimDispatchAttempt` is a single guarded UPDATE that increments the
   attempt, bumps the revision, and moves the state, conditional on the revision
   the caller read, the attempt cap, *and* the state being left. The state
   change is the load-bearing half: a guarded increment alone only stops two
   callers holding the same revision, so a request arriving while the winner is
   still inside `createDirectiveProject` would re-read the bumped revision,
   find a still-dispatchable state, and claim again. Exactly one caller wins;
   the loser never dispatches, and is told work is under way rather than that
   nothing started.

   A claim that is never resolved — the process dies mid-dispatch — would wedge
   the command forever, so `dispatch_started_at` bounds it: after a ten-minute
   lease (longer than either dispatching route's own limit, five minutes for
   the decision route and two for the webhook) the claim may be taken over.

   While the lease is live the screen says "Starting now" and offers no retry,
   because neither "nothing started" nor "work started" would be true. Once it
   has expired the screen says the dispatch stopped part-way and offers
   **Try again**, which takes the claim over. Recovery has to be reachable from
   a real entry point to be worth anything: an earlier version had the lease in
   the SQL but every caller pre-gated on a state a `dispatching` row is not in,
   so the takeover branch could never fire and the command stayed stuck anyway.

### Partial creation

The project id is recorded **the moment the project row exists**, before any
task or agent execution. This is not tidiness: `DirectivePartiallyCreatedError`
only fires when the intake *throws*, and a serverless timeout throws nothing.
Without the early write, a killed dispatch left a live project with running
agents next to a command recording `projectId: null` — which the stale-lease
retry read as "nothing happened" and duplicated. A residual window remains
between the project row committing and that one-statement update committing;
it is sub-second, against minutes for the handoff it replaced.


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
| `dispatching` | A dispatch is in flight right now, claimed by exactly one caller. Past its lease it reads as "stopped part-way" and becomes retryable |
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

Retry cannot manufacture consent: a command only ever reaches `failed` or
`dispatching` from a dispatch that was **already** cleared to run — low risk and confirmed on the
call, or gated and since approved by a human. A command still sitting in
`awaiting_approval` has never been dispatched, so there is nothing to retry.
The endpoint accepts only `failed`, or `dispatching` past its lease. A successful retry clears the
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

**`VAPI_WEBHOOK_SECRET` must be at least 32 characters for phone control.**
The inbound lane collapses to this one string, so a short one is a deployment
error rather than a configuration choice.

The floor gates the inbound lane, **not** the endpoint. That distinction is
load-bearing: this webhook is shared with the pre-existing outbound founder
notifications, and enforcing the length at the door — which is how the rule
was first written — 401s every request on any deployment whose secret predates
it, silently ending all Jarvis call-status logging on a lane this work is not
supposed to touch. So the door keeps the original rule (non-empty,
constant-time equal) and the floor is checked after the feature flag.

Below the floor: notifications keep working exactly as before, the webhook logs
`{"event":"config-incomplete","reason":"weak_webhook_secret"}` (naming the
variable, never its value), the inbound lane does not run, and the Jarvis
screen lists **Webhook secret** under "Still to set up". Rotate it in Vercel
and in the Vapi dashboard together before enabling phone control.

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
- `JARVIS_PHONE_AUTO_DISPATCH_ENABLED` — must be exactly `true` before a
  low-risk phone command may open a directive without a human decision.
  Separate from the flag above and **off by default even when phone control is
  on**; see §3 for why, and leave it off unless you have read the measured
  numbers there and accepted the residual risk
- `JARVIS_PHONE_ORGANIZATION_ID`
- `JARVIS_PHONE_FOUNDER_USER_ID`
- `JARVIS_PHONE_VERIFICATION_SECRET` — ≥ 32 characters

Reused unchanged:

- `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`
- `VAPI_WEBHOOK_SECRET` — **must be ≥ 32 characters for the INBOUND lane**
  (see §7.3). The length floor gates phone control only; it is deliberately not
  enforced at the door. Enforcing it there — the first version of the rule —
  turns every request into a 401 on any deployment whose secret predates it,
  and this endpoint is shared with the pre-existing outbound founder
  notifications, so the upgrade would have silently ended all Jarvis
  call-status logging on a lane this work does not touch. Below the floor the
  webhook logs `weak_webhook_secret`, skips the inbound lane, and the Jarvis
  screen reports **Webhook secret** as still to set up rather than claiming the
  feature is ready.
- `JARVIS_FOUNDER_PHONE_E164`
- `JARVIS_VOICE_NOTIFICATIONS_ENABLED` *(outbound only; independent of this lane)*

---

## 9. First test, once enabled

1. Open the Jarvis Command Center **as the account named by
   `JARVIS_PHONE_FOUNDER_USER_ID`** and confirm phone control reports ready.
   Opening it as any other owner or admin should show the phone screen without
   the code panel; opening it in any other organization should not show the
   phone surface at all.
2. Press **Show my code** and confirm an eight-digit code appears.
3. Call from a number that is **not** the founder line. Confirm Jarvis refuses
   and the call appears in the UI marked refused with no command.
4. Call from the founder line. Confirm Jarvis asks for the code before
   anything else, and refuses to take an instruction until it is given.
5. Give a wrong code twice and the right code third. Confirm the attempt
   counter behaves and verification succeeds.
6. Ask for internal work ("research three restaurants in Brampton and compare
   their websites"). Confirm the read-back is accurate and say yes. With
   `JARVIS_PHONE_AUTO_DISPATCH_ENABLED` off — the default — Jarvis should say
   it reads as ordinary internal work and is waiting for you to start it, and
   the Jarvis screen should show it badged **Waiting for you to start it**,
   in neutral rather than amber, with a **Start the work** button. Press it and
   confirm a real project opens. (With the flag on, the project should open
   from the call itself and the screen should show **Work started**.)
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
12. Read the code aloud as separated groups ("four one seven, two nine six")
    and confirm verification succeeds **and** the stored transcript shows
    `[redacted-number]` rather than the digits.
13. Confirm server logs contain no full phone number, no transcript, and no
    code.

### Known residual risks to weigh before enabling

- **The gate is a deterministic classifier over speech, and it is the most
  fragile thing in this lane.** Eight adversarial passes have been run over it,
  and the first three designs were each walked past within a day. All three
  were DENYLISTS — enumerate what is dangerous, clear everything else:

  - one internal verb anywhere in the string cleared it, so "Draft the plan and
    clear the production database tonight" opened a directive;
  - per-clause clearance plus masks that neutralized risky-sounding topics —
    and the masks deleted a window of following text before any rule ran, so
    "Draft a runbook for tomorrow delete the customer records" cleared;
  - a list of outward verbs that refused a clause outright, every test anchored
    at the start of the clause — so one filler word made a clause unexaminable
    and "Please cancel the Acme order" cleared, along with 37 of the 65 verbs
    on that list.

  The lesson is not that three attempts were careless. It is that the set of
  ways to say "do something irreversible" is not enumerable, and a miss fails
  silently. So the decision is now inverted: **a clause clears only when its
  head verb is on a short allowlist of research and authoring verbs.**
  Everything else gates — an unrecognized verb, an unusual phrasing, another
  language, a verb invented next year. The categories still run, but they only
  make the reason specific and the level honest; a gap in them costs a vaguer
  explanation, not a silent action.

  The cost is over-gating, and it is measured rather than assumed. TWO corpora
  of realistic internal instructions live in `command-risk.test.ts` and the
  gate must clear all of both. They are kept separate on purpose: the first was
  written alongside the allowlist and a reviewer rightly pointed out that it
  reads as fitted to the vocabulary, so the second was written independently.
  The numbers are the reason to keep both — the first version of the allowlist
  gated 13 of the 40 it was tuned against, and 22 of the 36 it was not. A gate
  that fires on a fifth to a third of ordinary requests is exactly how a
  founder learns to approve without reading. Both corpora now clear entirely.

  A ninth review found the largest hole in this design and it was in the
  plumbing rather than the vocabulary: the `constraints`, `target` and
  `missingInformation` fields were exempt from the clause rule altogether, so
  up to 3.6 KB of attacker-influenced text per command was still governed by
  the old denylist. They are examined now; the only remaining difference is
  that a sentence in a reference field must LOOK like a command before it is
  treated as one, which is what keeps "KidsCoding" and "Stay under a week" from
  having to prove they are research.

  **If you change this file:** nothing in it may rewrite or delete text
  (narrowings are zero-width lookarounds bound to the word they attach to), and
  every test that reads a clause must first strip what sits in front of the
  verb. Those two rules are what designs B and C got wrong, and both are
  enforced by tests. Run the adversarial probe suites — the must-gate lists are
  a record of phrasings that really did clear at some point — and if a change
  makes the forty-instruction corpus gate, the change is wrong even when it
  closes a hole.

- **The approval gate is a pre-directive gate, not an `agent_approval_requests`
  row** (§3). This is the design decision most worth a human's judgment before
  this ships; the reasoning is set out there.
- **The passcode's spoken forms are covered but not field-tested.** Redaction
  and verification share one scanner, with verification on a strict subset
  vocabulary, so what authenticates is always redacted. The subset boundary was
  itself a bug once: sharing the wide vocabulary made "the code is 014149 too"
  unreadable and burned an attempt. Watch the first few real calls for a
  correct code being rejected.
- **A caller who can spoof the founder's number still gets a phone call.** The
  number is a precondition, not the authentication, so a spoofed line is not
  refused outright — it reaches the passcode and no further. What it costs is
  now bounded (six calls an hour, twenty-five unverified transcript turns, an
  eight-digit code, three attempts a call, twelve an hour), and what it can
  take away from the founder is recoverable in one tap from the Jarvis screen.
  What is *not* bounded is the ten-minute assistant a first call is handed:
  the assistant duration is fixed at `assistant-request`, when every caller is
  unverified by definition, so it cannot be raised after verification and
  lowering it would cut real calls short. The call ceiling is what caps the
  telephony and model spend; watch it on the first bill.

- **A refused caller's speech is recorded, and that is deliberate.** A call
  from a number this lane will not work with is turned away in one sentence,
  but everything said on it is still written to the transcript — redacted like
  any other turn, capped like any other unverified call, and able to capture,
  confirm or dispatch nothing. The one call most worth having a record of is
  the one that was refused.

- **Nothing here has been exercised against the real Vapi.** Every behaviour
  above is proved by unit, integration, accessibility and concurrency tests
  against a real Postgres — including two suites that play COMPLETE calls
  delivery by delivery and assert on the rows left behind: one through the
  conversation itself, one through the approval that turns a gated command into
  a real project with real tasks and running agents. The risk gate, redaction,
  the idempotency replay, the caller budgets, and the approval gate itself all
  have mutation evidence. The provider itself has not been called once. Step 9
  is the first time this lane meets a real phone call.
