"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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
  calls: PhoneCall[];
  refreshAfterMs: number | null;
};

type PasscodeState = { available: boolean; passcode: string | null; expiresInMs: number | null; reason?: string };

const DISPATCH_LABEL: Record<string, string> = {
  awaiting_confirmation: "Waiting for you to confirm on the call",
  awaiting_approval: "Needs your approval",
  declined: "You declined it",
  directive_created: "Work started",
  cancelled: "Cancelled on the call",
  failed: "Could not start",
};

const DISPATCH_STYLE: Record<string, string> = {
  awaiting_confirmation: "border-white/10 bg-white/[0.02] text-muted",
  awaiting_approval: "border-amber-300/40 bg-amber-300/10 text-amber-100",
  declined: "border-white/10 bg-white/[0.02] text-subtle",
  directive_created: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  cancelled: "border-white/10 bg-white/[0.02] text-subtle",
  failed: "border-red-400/30 bg-red-400/10 text-red-200",
};

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function JarvisPhoneControl({ organizationId, organizationSlug }: { organizationId: string; organizationSlug: string }) {
  const [state, setState] = useState<PhoneState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [passcode, setPasscode] = useState<PasscodeState | null>(null);
  const [showPasscode, setShowPasscode] = useState(false);
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
    setShowPasscode(true);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/jarvis/phone/passcode`, { cache: "no-store" });
      const payload = (await response.json()) as { data?: PasscodeState; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "The code is unavailable.");
      setPasscode(payload.data);
    } catch (codeError) {
      setPasscode({ available: false, passcode: null, expiresInMs: null, reason: codeError instanceof Error ? codeError.message : "unavailable" });
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

      {state?.readiness.enabled ? (
        <div className="office-panel">
          <h3 className="font-serif text-xl font-light text-foreground">Your verification code</h3>
          <p className="mt-2 text-sm leading-6 text-muted">
            When you call Jarvis, he will ask for this six-digit code before he takes any instruction. Your phone number alone is not enough
            to prove it is you.
          </p>
          {!showPasscode ? (
            <button type="button" onClick={() => void revealPasscode()} className="office-dispatch-button mt-4">
              Show my code
            </button>
          ) : passcode?.available && passcode.passcode ? (
            <div className="mt-4">
              <p className="font-mono text-4xl tracking-[0.35em] text-foreground" aria-live="polite">
                {passcode.passcode}
              </p>
              <p className="mt-2 text-xs text-subtle">This code changes every few minutes. Read the one showing when Jarvis asks.</p>
            </div>
          ) : (
            <p role="alert" className="mt-4 text-sm text-danger">
              The code is not available right now. Phone control may not be fully set up.
            </p>
          )}
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
                <span className={`rounded-full border px-2 py-1 text-[0.6rem] uppercase tracking-[0.12em] ${DISPATCH_STYLE[command.dispatchState] ?? "border-border text-muted"}`}>
                  {DISPATCH_LABEL[command.dispatchState] ?? command.dispatchState}
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

              {command.requiresApproval ? (
                <div className="mt-5 rounded-sm border border-amber-300/40 bg-amber-300/10 p-4">
                  <h5 className="text-sm font-medium text-amber-100">What needs your approval</h5>
                  <ul className="mt-2 list-disc pl-5 text-sm text-amber-100/90">
                    {(command.gatedReasons.length > 0 ? command.gatedReasons : command.riskReasons).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  {command.dispatchState === "awaiting_approval" ? (
                    <>
                      <p className="mt-3 text-sm text-amber-100/90">Nothing has started. Nothing will until you decide here.</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void decide(command.id, "approve")}
                          disabled={pendingCommandId === command.id}
                          className="office-dispatch-button"
                        >
                          {pendingCommandId === command.id ? "Working…" : "Approve and start the work"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void decide(command.id, "decline")}
                          disabled={pendingCommandId === command.id}
                          className="office-starter"
                        >
                          Decline
                        </button>
                      </div>
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
                ) : command.dispatchState === "failed" ? (
                  <>
                    <p role="alert" className="mt-1 text-sm text-danger">
                      No. Jarvis could not open the project{command.failureCode ? ` (${command.failureCode.replace(/_/g, " ")})` : ""}. Nothing was
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
                        This one has been tried as many times as it can be. Call Jarvis again if you still want it.
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
