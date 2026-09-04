# Jarvis on Telegram

Talk to your company from your phone. Send Jarvis what you want done, and
it comes back to you in the same chat when it needs a decision.

This lane is deliberately the phone lane's twin: the same two-factor
shape, the same tenant-fixed-at-deploy-time posture, the same
"unconfigured means accept nothing" default. Read
`JARVIS_PHONE_CONTROL.md` first if you want the reasoning; this document
is the setup and the differences.

---

## What it does

**Inbound — you to Jarvis**

| You send | Jarvis does |
| --- | --- |
| `/start <code>` | Links this chat, once, using the rotating code from the Jarvis screen |
| Any ordinary message | Opens a directive, exactly as the Command Center would |
| `/status` | What is running, and what is waiting on you |
| `/help` | The list above |
| `/unlink` | Cuts this chat off immediately |
| A button on an approval | Decides it, through the real approval path |

**Outbound — Jarvis to you**

Approvals arrive with **Approve** and **Stop** buttons. A run report
arrives once, at the end. A stopped step arrives in plain language with
what to do about it. All three also go by email and, when the voice lane
is configured, by phone call — Telegram is an additional channel, never a
replacement.

**How autonomy reads.** What you type sets the policy for that directive:

- default — Jarvis researches, builds, deploys the preview and reviews it
  on its own, then asks before contacting anyone;
- *"and send the email yourself"* / *"don't ask me"* / *"run it end to
  end"* — it does the outreach too and reports back when it is done;
- *"check with me first"* — it stops at every gate, as it always did.

---

## Setting it up

### 1. Make the bot

In Telegram, message **@BotFather**, send `/newbot`, and follow it. You
get a token that looks like `1234567890:AAG...`. That token is a
credential — treat it like a password.

### 2. Add the environment variables

| Variable | Value |
| --- | --- |
| `JARVIS_TELEGRAM_ENABLED` | `true` |
| `TELEGRAM_BOT_TOKEN` | the token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | a random string, at least 24 characters |
| `JARVIS_TELEGRAM_ORGANIZATION_ID` | your organization's id |
| `JARVIS_TELEGRAM_FOUNDER_USER_ID` | your LYNQ user id |
| `JARVIS_TELEGRAM_LINK_SECRET` | a random string, at least 32 characters |

The last three fall back to the phone lane's
(`JARVIS_PHONE_ORGANIZATION_ID`, `JARVIS_PHONE_FOUNDER_USER_ID`,
`JARVIS_PHONE_VERIFICATION_SECRET`) when they are not set, because it is
the same founder either way. Naming them explicitly still wins.

Generate the two secrets with:

```bash
openssl rand -hex 24   # TELEGRAM_WEBHOOK_SECRET
openssl rand -hex 32   # JARVIS_TELEGRAM_LINK_SECRET
```

### 3. Run the migration

`0045_jarvis_telegram_control.sql` adds the link and event tables.

### 4. Point Telegram at the webhook

Once deployed:

```bash
curl -sS "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H 'content-type: application/json' \
  -d '{
        "url": "https://lynq.build/api/integrations/telegram/webhook",
        "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
        "allowed_updates": ["message", "edited_message", "callback_query"]
      }'
```

Check it with `getWebhookInfo`. `pending_update_count` climbing means the
webhook is refusing — almost always a mismatched secret.

### 5. Link your chat

Open **Jarvis** in LYNQ. The Telegram panel shows an eight-digit code that
rotates every five minutes. Message your bot `/start <code>`. That is the
only time the code is needed.

---

## The security model, briefly

A Telegram chat id is stable but not secret, so it authenticates nothing on
its own — anyone can message a bot. A chat becomes trusted by presenting a
code that only an authenticated LYNQ session displays, which means a
successful link proves both the Telegram account and a live founder
session. After that the stored link is the credential.

What that buys, and what it costs:

- **A link is not a role.** Every action re-proves that the linked account
  is still an owner or admin of the workspace. Removing someone in LYNQ
  removes their Telegram control in the same moment.
- **Revocation is one row.** `/unlink` in the chat, or *Unlink every chat*
  on the Jarvis screen.
- **Pairing is budgeted.** Five failed attempts from one chat in an hour
  and it is refused outright. Every attempt is recorded.
- **So is work.** One chat may start twelve directives an hour — far above
  ordinary use, far below a model bill worth noticing. `/status` and
  `/help` cost nothing.
- **A tap is not consent for everything.** A low-risk approval decides on
  one tap. A high-risk one — the outreach that reaches a real business —
  asks again in the chat and names what is about to happen. Stopping
  something never asks twice.
- **Every update is handled once.** Telegram redelivers until it gets a
  200; the unique constraint on `jarvis_telegram_events` is what makes
  "acted on once" a fact rather than an intention.
- **The log holds no content.** A pairing code is never recorded. A
  directive is recorded as its length, never its words.
- **The tenant is fixed at deploy time.** An unknown sender can fail to
  link against an organization that was already decided; it can never
  choose one.

Every decision made from Telegram goes through Agent Runtime's own
unmodified `approveRequest` / `rejectRequest`, with the founder permission
checks around them, and is audited as
`jarvis_telegram_approval_decided` with the channel recorded. There is no
second approval path.

---

## When something is wrong

| What you see | What it means |
| --- | --- |
| The bot says nothing at all | The webhook is not set, or the secret does not match. Check `getWebhookInfo`. |
| "I don't know you yet" | This chat is not linked. Send `/start <code>`. |
| "That code is not right, or it has expired" | Read the current code from the Jarvis screen — it rotates every five minutes. |
| "Too many wrong codes" | Five failures in an hour. Wait it out. |
| "This chat is linked, but that LYNQ account can no longer act" | The account lost its owner/admin role. Nothing was done. |
| "That is 12 directives in the last hour" | The hourly ceiling for one chat. Wait, or use the Command Center. |
| "This chat is linked to a different workspace" | `JARVIS_TELEGRAM_ORGANIZATION_ID` changed after the chat was linked. Send `/unlink`, then link again. |
| "Something broke on my side handling that" | The update failed and will not be retried — Telegram was already acknowledged. Send it again. |
| The panel says "not finished being set up" | An environment variable is missing. The panel never says which one. |
