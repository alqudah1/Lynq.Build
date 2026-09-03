/**
 * How long a call can possibly still be alive.
 *
 * Two things read this and they must agree, which is why it lives on its own
 * rather than beside either of them:
 *
 * - `reapAbandonedDraft` expires a draft whose call has been silent longer than
 *   this, so a confirmation that can never come stops looking like one that
 *   might.
 * - the inbound conversation refuses a tool call on a session silent longer
 *   than this, so a delivery arriving after a call is over — reordered,
 *   replayed, or forged — cannot capture and confirm a real project into
 *   existence, even when the row still says `active` because the call's ending
 *   was never delivered.
 *
 * Twice the assistant's own ten-minute ceiling. The margin matters: the clock
 * is `jarvis_call_sessions.last_event_at`, which is written by every provider
 * delivery, and being wrong in the tight direction means cancelling a draft out
 * from under a founder who is still describing it.
 */
export const ABANDONED_DRAFT_MS = 20 * 60 * 1000;
