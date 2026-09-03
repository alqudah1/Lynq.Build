/**
 * Two bounds on a call, and they measure different things on purpose.
 *
 * `ABANDONED_DRAFT_MS` is SILENCE — how long since the last delivery this lane
 * accepted. It is what the reapers use to decide a call has gone quiet, so a
 * draft waiting for a confirmation that can never come stops looking like one
 * that might, and a session whose ending was never delivered stops reading as
 * live. Twice the assistant's own ten-minute ceiling, because being wrong in
 * the tight direction means cancelling a draft out from under a founder who is
 * still describing it.
 *
 * `MAX_CALL_AGE_MS` is AGE — how long since the call began. It is what the
 * inbound conversation uses to refuse a tool call, and it has to be a different
 * quantity: a tool call is one of the deliveries that marks a call alive, so a
 * guard reading the silence clock would be reset by the very deliveries it
 * exists to refuse, and a stream of replayed or forged tool calls at
 * under-twenty-minute intervals would be honoured for ever. Age since the
 * session row was inserted cannot be moved by anything.
 *
 * It is generous — four hours — because it is a hard cap on a real call, and
 * the ceiling that would otherwise bound one is configured in the provider's
 * dashboard on a deployment with a statically assigned assistant, not in this
 * code. A tighter value would tell a founder mid-sentence that their call had
 * ended. A call longer than four hours is not something this lane supports.
 */
export const ABANDONED_DRAFT_MS = 20 * 60 * 1000;

export const MAX_CALL_AGE_MS = 4 * 60 * 60 * 1000;
