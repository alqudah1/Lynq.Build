"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { describeDispatchFailure as describeFailureCode } from "@/lib/voice/failure-labels";

/**
 * The founder-facing phone-control surface inside the Jarvis Command Center.
 *
 * It answers exactly the five questions the lane requires, in this order and
 * in plain language:
 *
 *   what Mustafa said        → the redacted final transcript turns
 *   what Jarvis understood   → the captured command fields
 *   what Jarvis proposes     → the proposed steps
 *   what requires approval   → the gate, with the reasons, and the decision
 *   whether work started     → the real project link, or the real failure
 *
 * It also renders the verification passcode, which is the second factor for
 * the call itself: reaching this component already required a validated
 * session, and the code endpoint additionally requires owner/admin.
 *
 * Everything on screen is real state from the server. There is no button here
 * that does not perform a real, audited action, and nothing shows progress
 * that has not actually happened.
 */

type PhoneCommand = {
  id: string;
  requestedOutcome: string;
  target: string | null;
  constraints: string[];
  requiredIntegrations: string[];
  proposedSteps: string[];
  missingInformation: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
  gatedReasons: string[];
  riskReasons: string[];
  overrideAttempted: boolean;
  readback: string;
  confirmationStatus: string;
  dispatchState: string;
  projectId: string | null;
  projectName: string | null;
  projectKey: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  dispatchAttempts: number;
  retryable: boolean;
  /** True only while a dispatch is genuinely running; a stuck one is `dispatching` but not in flight. */
  inFlight: boolean;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
};

type PhoneCall = {
  session: {
    id: string;
    status: string;
    verificationState: string;
    verificationAttempts: number;
    callerNumberLastFour: string | null;
    callerNumberMatched: boolean;
    deliveryStatus: string | null;
    endedReason: string | null;
    failureCode: string | null;
    startedAt: string;
    endedAt: string | null;
  };
  turns: Array<{ id: string; role: "founder" | "jarvis"; text: string; redactedKinds: string[] }>;
  commands: PhoneCommand[];
};

type PhoneState = {
  readiness: { enabled: boolean; ready: boolean; completedChecks: number; totalChecks: number; missing: string[] };
  /** Whether this viewer may approve, decline, or retry. Any member can read the screen; only an owner/admin can act. */
  canDecide: boolean;
  /** Whether this viewer is the configured founder, whose second factor the passcode is. Server-computed: the panel must never offer a code that would be refused. */
  canSeePasscode: boolean;
  calls: PhoneCall[];
  refreshAfterMs: number | null;
};

/**
 * Whether calls or codes from the founder's number are currently being refused
 * before the code is even checked. Both budgets are keyed on an asserted caller
 * ID, so someone spoofing the line can spend them; without this the founder
 * heard "there have been too many code attempts from this number" on a call
 * they had not made, and had nothing to do about it.
 */
type LockoutState = {
  locked: boolean;
  /** Tenant-wide, filled by calls from OTHER numbers. Never the founder's own doing, and it does not stop their calls. */
  refusedCallsSpent: boolean;
  resetAt: string | null;
  callsRemaining: number;
  attemptsRemaining: number;
  refusedCallsRemaining: number;
};

type PasscodeState = {
  available: boolean;
  passcode: string | null;
  expiresInMs: number | null;
  reason?: string;
  lockout?: LockoutState | null;
};

const DISPATCH_LABEL: Record<string, string> = {
  awaiting_confirmation: "Waiting for you to confirm on the call",
  awaiting_approval: "Needs your approval",
  awaiting_start: "Waiting for you to start it",
  dispatching: "Opening the project now",
  dispatching_stalled: "Stopped part-way",
  declined: "You declined it",
  directive_created: "Work started",
  cancelled: "Cancelled on the call",
  failed: "Could not start",
};

const DISPATCH_STYLE: Record<string, string> = {
  awaiting_confirmation: "border-white/10 bg-white/[0.02] text-muted",
  awaiting_approval: "border-amber-300/40 bg-amber-300/10 text-amber-100",
  awaiting_start: "border-white/10 bg-white/[0.02] text-muted",
  dispatching: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  declined: "border-white/10 bg-white/[0.02] text-subtle",
  directive_created: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  cancelled: "border-white/10 bg-white/[0.02] text-subtle",
  failed: "border-red-400/30 bg-red-400/10 text-red-200",
};

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * The retry cap, mirrored for display only. The server is the authority on
 * whether a retry is allowed (`retryable`); this exists so the screen can tell
 * "tried as many times as it can be" apart from "not settled yet" instead of
 * asserting the first about a command tried once.
 */
const MAX_DISPATCH_ATTEMPTS_UI = 5;


export function JarvisPhoneControl({ organizationId, organizationSlug }: { organizationId: string; organizationSlug: string }) {
  const [state, setState] = useState<PhoneState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [passcode, setPasscode] = useState<PasscodeState | null>(null);
  const [showPasscode, setShowPasscode] = useState(false);
  const [passcodeLoading, setPasscodeLoading] = useState(false);
  const [clearingLockout, setClearingLockout] = useState(false);
  const [lockoutError, setLockoutError] = useState<string | null>(null);
  const [pendingCommandId, setPendingCommandId] = useState<string | null>(null);
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/organizations/${organizationId}/jarvis/phone`, { cache: "no-store", signal });
      const payload = (await response.json()) as { data?: PhoneState; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Phone control status is unavailable.");
      setState(payload.data);
      setError(null);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Phone control status is unavailable.");
    }
  }, [organizationId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, retryKey]);

  useEffect(() => {
    if (!state?.refreshAfterMs) return;
    const timer = window.setTimeout(() => void load(), state.refreshAfterMs);
    return () => window.clearTimeout(timer);
  }, [load, state]);

  const revealPasscode = useCallback(async () => {
    // `loading` before `showPasscode`, so the panel never renders its error
    // branch while the request is still in flight. Setting showPasscode first
    // meant that, with no code yet, the JSX fell through to a role="alert"
    // reading "The code is not available right now" — announced immediately to
    // a screen reader and then silently replaced by the code.
    setPasscodeLoading(true);
    setShowPasscode(true);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/jarvis/phone/passcode`, { cache: "no-store" });
      const payload = (await response.json()) as { data?: PasscodeState; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "The code is unavailable.");
      setPasscode(payload.data);
    } catch (codeError) {
      setPasscode({ available: false, passcode: null, expiresInMs: null, reason: codeError instanceof Error ? codeError.message : "unavailable" });
    } finally {
      setPasscodeLoading(false);
    }
  }, [organizationId]);

  const clearLockout = useCallback(async () => {
    setClearingLockout(true);
    setLockoutError(null);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/jarvis/phone/passcode`, { method: "POST", cache: "no-store" });
      const payload = (await response.json()) as { data?: { cleared: boolean; reason: string | null; lockout: LockoutState | null }; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "That could not be cleared just now.");
      if (!payload.data.cleared) throw new Error(payload.data.reason ?? "That could not be cleared just now.");
      setPasscode((current) => (current ? { ...current, lockout: payload.data?.lockout ?? null } : current));
    } catch (clearError) {
      setLockoutError(clearError instanceof Error ? clearError.message : "That could not be cleared just now.");
    } finally {
      setClearingLockout(false);
    }
  }, [organizationId]);

  // The code rotates on the server; re-fetch just after the window this one
  // belongs to ends, so what is on screen is always the code Jarvis accepts.
  useEffect(() => {
    if (!showPasscode || !passcode?.available || !passcode.expiresInMs) return;
    const timer = window.setTimeout(() => void revealPasscode(), passcode.expiresInMs + 500);
    return () => window.clearTimeout(timer);
  }, [showPasscode, passcode, revealPasscode]);

  const decide = useCallback(
    async (commandId: string, decision: "approve" | "decline" | "retry") => {
      setPendingCommandId(commandId);
      setDecisionError(null);
      setDecisionMessage(null);
      try {
        const response = await fetch(`/api/organizations/${organizationId}/jarvis/phone/commands/${commandId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        });
        const payload = (await response.json()) as { data?: { message: string }; error?: { message?: string } };
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "The decision could not be recorded.");
        setDecisionMessage(payload.data.message);
        await load();
      } catch (decideError) {
        setDecisionError(decideError instanceof Error ? decideError.message : "The decision could not be recorded.");
      } finally {
        setPendingCommandId(null);
      }
    },
    [organizationId, load]
  );

  return (
    <section aria-labelledby="jarvis-phone-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.22em] text-subtle">Call Jarvis</p>
          <h2 id="jarvis-phone-heading" className="mt-1 font-serif text-3xl font-light text-foreground">
            Phone control
          </h2>
        </div>
        <button type="button" onClick={() => setRetryKey((value) => value + 1)} className="text-xs text-subtle hover:text-foreground">
          Refresh
        </button>
      </div>

      {error ? (
        <div className="office-panel">
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
          <button type="button" onClick={() => setRetryKey((value) => value + 1)} className="office-dispatch-button mt-4">
            Try again
          </button>
        </div>
      ) : null}

      {state && !state.readiness.enabled ? (
        <div className="office-panel">
          <h3 className="font-serif text-xl font-light text-foreground">Phone control is turned off</h3>
          <p className="mt-2 text-sm leading-6 text-muted">
            Jarvis will not accept spoken instructions until this is switched on in the production environment. Calls that come in now are
            answered by the existing notification assistant only.
          </p>
          {state.readiness.missing.length > 0 ? (
            <>
              <p className="mt-4 text-xs uppercase tracking-[0.16em] text-subtle">Still to set up</p>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted">
                {state.readiness.missing.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {/*
        Gated on `canDecide`, not only on readiness. The passcode route requires
        owner or admin, so a member was shown the panel and a button that always
        returned 403 — and the catch below turned that into "Phone control may
        not be fully set up", telling them the deployment was broken when the
        truth was that they lack the role.
      */}
      {state?.readiness.enabled && state.canSeePasscode ? (
        <div className="office-panel">
          <h3 className="font-serif text-xl font-light text-foreground">Your verification code</h3>
          <p className="mt-2 text-sm leading-6 text-muted">
            When you call Jarvis, he will ask for this code before he takes any instruction. Your phone number alone is not enough to prove
            it is you.
          </p>
          {/* Always in the DOM, so the announcement is reliable rather than
              racing the node that carries it into existence. */}
          <p className="sr-only" aria-live="polite">
            {passcodeLoading ? "Getting your code" : passcode?.available && passcode.passcode ? "Your code is showing" : ""}
          </p>
          {!showPasscode ? (
            <button type="button" onClick={() => void revealPasscode()} className="office-dispatch-button mt-4">
              Show my code
            </button>
          ) : passcodeLoading ? (
            <p className="mt-4 text-sm text-muted">Getting your code…</p>
          ) : passcode?.available && passcode.passcode ? (
            <div className="mt-4">
              <p className="font-mono text-4xl tracking-[0.35em] text-foreground">{passcode.passcode}</p>
              <p className="mt-2 text-xs text-subtle">This code changes every few minutes. Read the one showing when Jarvis asks.</p>
            </div>
          ) : (
            <p role="alert" className="mt-4 text-sm text-danger">
              {/* The server's own words. Swallowing them into one generic
                  sentence hid the difference between "you cannot do this" and
                  "this is not set up". */}
              {passcode?.reason ?? "The code is not available right now."}
            </p>
          )}

          {/*
            The lockout is shown only when it is real, and it is written in the
            terms the founder experiences: Jarvis refusing them on the phone.
            Both budgets are keyed on the number a caller claims, and caller ID
            can be faked, so someone else calling from a line that looks like
            theirs can spend both — and the founder is then turned away before
            their correct code is ever checked, with nothing on screen to
            explain it. Clearing grants no access: the code, the three-try cap
            and the number check all still apply afterwards.
          */}
          {passcode?.lockout?.locked || passcode?.lockout?.refusedCallsSpent ? (
            <div className="mt-5 rounded-sm border border-amber-300/40 bg-amber-300/10 px-3 py-3">
              {/*
                Two different situations, and they must not borrow each other's
                words. `locked` is the founder's OWN budget — their calls, their
                code attempts. `refusedCallsSpent` is a tenant-wide budget that
                calls from other numbers fill, which the founder never spends
                and which does not stop their calls at all, unless their phone
                is not sending its number. Reporting the second as the first
                announced that Jarvis was turning down the founder's calls when
                it was doing nothing of the kind.
              */}
              {passcode.lockout.locked ? (
                <>
                  <p className="text-sm font-medium text-amber-100">Jarvis is turning down calls from your number right now</p>
                  <p className="mt-1 text-sm leading-6 text-amber-100/80">
                    Too many calls or wrong codes came from a line claiming to be yours. That can happen if someone else is calling in
                    pretending to be you — a phone number is easy to fake. It clears on its own
                    {passcode.lockout.resetAt ? ` at ${formatTime(passcode.lockout.resetAt)}` : " shortly"}, or you can clear it now and try
                    again. Clearing it does not let anyone in: your code is still required.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-amber-100">A lot of calls from other numbers have come in this hour</p>
                  <p className="mt-1 text-sm leading-6 text-amber-100/80">
                    Your own calls still work normally. Jarvis has stopped recording the wrong-number ones for now, which also means a call is
                    turned away if your phone doesn&apos;t send your number with it. It clears on its own
                    {passcode.lockout.resetAt ? ` at ${formatTime(passcode.lockout.resetAt)}` : " shortly"}. You can clear it now if you need
                    to call in from a line that withholds its number — that will also start recording the other calls again.
                  </p>
                </>
              )}
              <button
                type="button"
                onClick={() => void clearLockout()}
                disabled={clearingLockout}
                className="office-dispatch-button mt-3"
              >
                {clearingLockout ? "Clearing…" : passcode.lockout.locked ? "Let me call in again" : "Clear it anyway"}
              </button>
              {lockoutError ? (
                <p role="alert" className="mt-2 text-sm text-danger">
                  {lockoutError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {decisionMessage ? (
        <p role="status" className="rounded-sm border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-sm text-emerald-100">
          {decisionMessage}
        </p>
      ) : null}
      {decisionError ? (
        <p role="alert" className="rounded-sm border border-danger/30 bg-danger-wash px-3 py-2 text-sm text-danger">
          {decisionError}
        </p>
      ) : null}

      {state && state.calls.length === 0 ? (
        <div className="office-panel">
          <p className="text-sm text-muted">No calls yet. When you call Jarvis, everything you said and everything he understood shows up here.</p>
        </div>
      ) : null}

      {state?.calls.map((call) => (
        <article key={call.session.id} className="office-panel">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-serif text-xl font-light text-foreground">Call on {formatTime(call.session.startedAt)}</h3>
              <p className="mt-1 text-xs text-subtle">
                {call.session.callerNumberLastFour ? `From ••• ${call.session.callerNumberLastFour}` : "Caller unknown"}
                {" · "}
                {call.session.verificationState === "verified"
                  ? "Identity verified"
                  : call.session.verificationState === "failed"
                    ? "Identity not verified"
                    : "Identity not yet verified"}
              </p>
            </div>
            <span className="rounded-full border border-border px-2 py-1 text-[0.6rem] uppercase tracking-[0.12em] text-muted">
              {call.session.status === "active" ? "On the call" : call.session.status === "refused" ? "Refused" : call.session.status === "failed" ? "Ended with a problem" : "Ended"}
            </span>
          </header>

          {call.session.status === "refused" ? (
            <p className="mt-3 rounded-sm border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">
              Jarvis refused this call and took no instruction from it.
              {call.session.failureCode === "caller_number_mismatch" ? " It did not come from your registered number." : " The code was not verified."}
            </p>
          ) : null}

          {call.turns.length > 0 ? (
            <section className="mt-5" aria-labelledby={`said-${call.session.id}`}>
              <h4 id={`said-${call.session.id}`} className="text-xs uppercase tracking-[0.16em] text-subtle">
                What was said
              </h4>
              <ul className="mt-2 flex flex-col gap-2">
                {call.turns.map((turn) => (
                  <li key={turn.id} className="text-sm leading-6">
                    <span className="text-subtle">{turn.role === "founder" ? "You: " : "Jarvis: "}</span>
                    <span className="text-muted">{turn.text}</span>
                    {turn.redactedKinds.length > 0 ? (
                      <span className="ml-2 text-xs text-amber-200">Something sensitive was removed before saving.</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {call.commands.map((command) => (
            <section key={command.id} className="mt-6 border-t border-border pt-5" aria-labelledby={`command-${command.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h4 id={`command-${command.id}`} className="font-serif text-lg font-light text-foreground">
                  What Jarvis understood
                </h4>
                {/*
                  Two commands can share `awaiting_approval` and mean different
                  things: one the gate stopped, and one it cleared that is
                  waiting only because nothing said on a call starts on its own.
                  Badging both "Needs your approval" would make the amber label
                  meaningless, which is how a founder learns to approve without
                  reading.
                */}
                <span
                  className={`rounded-full border px-2 py-1 text-[0.6rem] uppercase tracking-[0.12em] ${
                    (command.dispatchState === "dispatching" && !command.inFlight
                      ? DISPATCH_STYLE.failed
                      : command.dispatchState === "awaiting_approval" && !command.requiresApproval
                        ? DISPATCH_STYLE.awaiting_start
                        : DISPATCH_STYLE[command.dispatchState]) ?? "border-border text-muted"
                  }`}
                >
                  {command.dispatchState === "dispatching" && !command.inFlight
                    ? DISPATCH_LABEL.dispatching_stalled
                    : command.dispatchState === "awaiting_approval" && !command.requiresApproval
                      ? DISPATCH_LABEL.awaiting_start
                      : DISPATCH_LABEL[command.dispatchState] ?? command.dispatchState}
                </span>
              </div>

              <p className="mt-3 text-sm leading-6 text-foreground">{command.requestedOutcome}</p>
              {command.target ? <p className="mt-1 text-sm text-muted">For {command.target}</p> : null}

              {command.constraints.length > 0 ? (
                <>
                  <p className="mt-4 text-xs uppercase tracking-[0.16em] text-subtle">Your conditions</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-muted">
                    {command.constraints.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              ) : null}

              {command.proposedSteps.length > 0 ? (
                <>
                  <p className="mt-4 text-xs uppercase tracking-[0.16em] text-subtle">What Jarvis proposes</p>
                  <ol className="mt-1 list-decimal pl-5 text-sm text-muted">
                    {command.proposedSteps.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                </>
              ) : null}

              {command.missingInformation.length > 0 ? (
                <>
                  <p className="mt-4 text-xs uppercase tracking-[0.16em] text-subtle">Still missing</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-muted">
                    {command.missingInformation.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              ) : null}

              {command.overrideAttempted ? (
                <p className="mt-4 rounded-sm border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
                  This call asked Jarvis to skip the approval. He kept it in place.
                </p>
              ) : null}

              {/*
                The decision block renders for ANY command waiting on a
                decision, not only a gated one.
                
                It used to be inside `requiresApproval`, which was correct when
                a low-risk command dispatched itself. It no longer does:
                auto-dispatch is off by default, so an ungated command lands
                here too — and with the block hidden it sat on screen badged
                "Needs your approval" with no button that could approve it.

                The two cases are styled and worded apart on purpose. If work
                the gate cleared arrives looking exactly like work the gate
                stopped, the amber panel stops meaning anything and the founder
                learns to press Approve without reading it, which is the whole
                failure this lane is trying to avoid.
              */}
              {command.dispatchState === "awaiting_approval" || (command.requiresApproval && command.decidedAt) ? (
                <div
                  className={`mt-5 rounded-sm border p-4 ${
                    command.requiresApproval ? "border-amber-300/40 bg-amber-300/10" : "border-white/10 bg-white/[0.02]"
                  }`}
                >
                  <h5 className={`text-sm font-medium ${command.requiresApproval ? "text-amber-100" : "text-foreground"}`}>
                    {command.requiresApproval ? "What needs your approval" : "Ready when you are"}
                  </h5>
                  {command.requiresApproval ? (
                    <ul className="mt-2 list-disc pl-5 text-sm text-amber-100/90">
                      {(command.gatedReasons.length > 0 ? command.gatedReasons : command.riskReasons).map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-muted">
                      This reads as ordinary internal work — Jarvis found nothing here that reaches a customer, spends money, or changes
                      anything live. Nothing said on a call starts on its own, so it is waiting for you to start it.
                    </p>
                  )}
                  {command.dispatchState === "awaiting_approval" ? (
                    <>
                      <p className={`mt-3 text-sm ${command.requiresApproval ? "text-amber-100/90" : "text-muted"}`}>
                        Nothing has started. Nothing will until you decide here.
                      </p>
                      {state?.canDecide ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void decide(command.id, "approve")}
                            disabled={pendingCommandId === command.id}
                            className="office-dispatch-button"
                          >
                            {pendingCommandId === command.id
                              ? "Working…"
                              : command.requiresApproval
                                ? "Approve and start the work"
                                : "Start the work"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void decide(command.id, "decline")}
                            disabled={pendingCommandId === command.id}
                            className="office-starter"
                          >
                            {command.requiresApproval ? "Decline" : "Not now"}
                          </button>
                        </div>
                      ) : (
                        <p className={`mt-3 text-sm ${command.requiresApproval ? "text-amber-100/90" : "text-muted"}`}>
                          Only an organization owner or admin can decide this one.
                        </p>
                      )}
                    </>
                  ) : command.decidedAt ? (
                    <p className="mt-3 text-sm text-amber-100/90">Decided on {formatTime(command.decidedAt)}.</p>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-5">
                <p className="text-xs uppercase tracking-[0.16em] text-subtle">Whether work started</p>
                {command.dispatchState === "directive_created" && command.projectId ? (
                  <p className="mt-1 text-sm text-muted">
                    Yes — {command.projectName ?? "the project"} is open and the team is briefed.{" "}
                    <Link href={`/app/${organizationSlug}/jarvis/${command.projectId}`} className="text-accent-foreground hover:text-foreground">
                      Watch it live →
                    </Link>
                  </p>
                ) : command.dispatchState === "dispatching" && command.inFlight ? (
                  <p className="mt-1 text-sm text-muted" role="status">
                    Starting now. Jarvis is opening the project and briefing the team — this page updates on its own.
                  </p>
                ) : command.dispatchState === "dispatching" && command.projectId ? (
                  <>
                    {/*
                      Past its lease AND a project exists. The single branch
                      that used to cover all stalled dispatches said "Nothing
                      was recorded as started" here — about a live project with
                      a briefed team — and then, because a partially-created
                      command is not retryable, told the founder it had "been
                      tried as many times as it can be" when it had been tried
                      once, and to call Jarvis again, which would have created a
                      second copy of the work.
                    */}
                    <p role="alert" className="mt-1 text-sm text-danger">
                      Partly. Jarvis opened {command.projectName ?? "the project"} and then stopped before finishing the handoff. Some of the
                      work may already be running.
                    </p>
                    <p className="mt-2 text-sm text-muted">
                      Starting it again would create a second copy, so open the project and carry on from there.{" "}
                      <Link href={`/app/${organizationSlug}/jarvis/${command.projectId}`} className="text-accent-foreground hover:text-foreground">
                        Open it →
                      </Link>
                    </p>
                  </>
                ) : command.dispatchState === "dispatching" ? (
                  <>
                    {/* Past its lease, and no project was recorded before it
                        stopped, so promising it is still working would be
                        false. */}
                    <p role="alert" className="mt-1 text-sm text-danger">
                      Jarvis started opening this and then stopped without finishing. No project was recorded before it stopped.
                    </p>
                    {command.retryable ? (
                      <button
                        type="button"
                        onClick={() => void decide(command.id, "retry")}
                        disabled={pendingCommandId === command.id}
                        className="office-dispatch-button mt-3"
                      >
                        {pendingCommandId === command.id ? "Trying again…" : "Try again"}
                      </button>
                    ) : (
                      <p className="mt-2 text-sm text-muted">
                        {!state?.canDecide
                          ? "Only an organization owner or admin can try this again."
                          : command.dispatchAttempts >= MAX_DISPATCH_ATTEMPTS_UI
                            ? "This one has been tried as many times as it can be. Call Jarvis again if you still want it."
                            : "Jarvis is still settling this one. Refresh in a moment."}
                      </p>
                    )}
                  </>
                ) : command.dispatchState === "failed" && command.projectId ? (
                  <>
                    {/* A project exists despite the failure, so claiming
                        "nothing was started" here would be false. */}
                    <p role="alert" className="mt-1 text-sm text-danger">
                      Partly. Jarvis opened {command.projectName ?? "the project"} but could not finish the handoff
                      {command.failureCode ? ` (${describeFailureCode(command.failureCode)})` : ""}. Some of the work may already be running.
                    </p>
                    <p className="mt-2 text-sm text-muted">
                      Retrying would start it a second time, so open the project and carry on from there.{" "}
                      <Link href={`/app/${organizationSlug}/jarvis/${command.projectId}`} className="text-accent-foreground hover:text-foreground">
                        Open it →
                      </Link>
                    </p>
                  </>
                ) : command.dispatchState === "failed" ? (
                  <>
                    <p role="alert" className="mt-1 text-sm text-danger">
                      No. Jarvis could not open the project{command.failureCode ? ` (${describeFailureCode(command.failureCode)})` : ""}. Nothing was
                      started, and nothing was sent.
                    </p>
                    {command.retryable ? (
                      <button
                        type="button"
                        onClick={() => void decide(command.id, "retry")}
                        disabled={pendingCommandId === command.id}
                        className="office-dispatch-button mt-3"
                      >
                        {pendingCommandId === command.id ? "Trying again…" : "Try again"}
                      </button>
                    ) : (
                      <p className="mt-2 text-sm text-muted">
                        {state?.canDecide
                          ? "This one has been tried as many times as it can be. Call Jarvis again if you still want it."
                          : "Only an organization owner or admin can try this again."}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted">No. Nothing has been started for this yet.</p>
                )}
              </div>
            </section>
          ))}
        </article>
      ))}
    </section>
  );
}
