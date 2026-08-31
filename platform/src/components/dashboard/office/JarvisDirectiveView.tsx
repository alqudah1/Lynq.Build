"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { JARVIS_STATE_LABELS, jarvisRecommendation, type JarvisStepState } from "@/lib/office/jarvis-presentation";

type JarvisStep = {
  taskId: string;
  title: string;
  state: JarvisStepState;
  stage: string;
  goal: string;
  handoff: string | null;
  agent: { id: string; name: string; role: string } | null;
  execution: { id: string; status: string; waitReason: string | null } | null;
  approval: { id: string; status: string } | null;
  deliverable: { id: string; title: string } | null;
  pullRequestUrl: string | null;
  previewUrl: string | null;
};

type JarvisStatus = {
  project: { id: string; name: string; projectKey: string; status: string; objective: string | null; directive: string | null };
  overallState: string;
  steps: JarvisStep[];
  refreshAfterMs: number | null;
};

type StatusResponse = { data?: JarvisStatus; error?: { message?: string } };

const STATE_STYLE: Record<JarvisStepState, string> = {
  queued: "border-white/10 bg-white/[0.02] text-subtle",
  waiting: "border-white/10 bg-white/[0.02] text-muted",
  running: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  needs_approval: "border-amber-300/40 bg-amber-300/10 text-amber-100",
  failed: "border-red-400/30 bg-red-400/10 text-red-200",
  completed: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
};

export function JarvisDirectiveView({ organizationId, organizationSlug, projectId }: { organizationId: string; organizationSlug: string; projectId: string }) {
  const [status, setStatus] = useState<JarvisStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/organizations/${organizationId}/office/directives/${projectId}`, { cache: "no-store", signal });
      const payload = (await response.json()) as StatusResponse;
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Jarvis status is unavailable.");
      setStatus(payload.data);
      setError(null);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Jarvis status is unavailable.");
    }
  }, [organizationId, projectId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadStatus(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadStatus, retryKey]);

  useEffect(() => {
    if (!status?.refreshAfterMs) return;
    const timer = window.setTimeout(() => void loadStatus(), status.refreshAfterMs);
    return () => window.clearTimeout(timer);
  }, [loadStatus, status]);

  if (!status && !error) {
    return <div className="office-floor px-5 py-10 text-sm text-muted md:px-10">Jarvis is loading the live handoffs…</div>;
  }

  if (!status) {
    return (
      <div className="office-floor flex min-h-[60vh] items-center justify-center px-5 py-10">
        <div className="office-panel max-w-lg text-center">
          <h1 className="font-serif text-3xl font-light text-foreground">Jarvis could not load this directive</h1>
          <p role="alert" className="mt-3 text-sm text-muted">{error}</p>
          <button type="button" onClick={() => setRetryKey((value) => value + 1)} className="office-dispatch-button mt-5">Try again</button>
        </div>
      </div>
    );
  }

  const approvalSteps = status.steps.filter((step) => step.state === "needs_approval");

  return (
    <div className="office-floor flex flex-col gap-8 px-5 py-7 md:px-8 lg:px-10 lg:py-9">
      <nav aria-label="Back navigation" className="flex flex-wrap gap-4 text-xs text-subtle">
        <Link href={`/app/${organizationSlug}/jarvis`} className="hover:text-foreground">← Jarvis Command Center</Link>
        <Link href={`/app/${organizationSlug}`} className="hover:text-foreground">Office home</Link>
      </nav>

      <header className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[0.65rem] uppercase tracking-[0.28em] text-accent-foreground">{status.project.projectKey}</p>
            <span className="rounded-full border border-border px-2 py-1 text-[0.6rem] uppercase tracking-[0.12em] text-muted">{status.overallState.replaceAll("_", " ")}</span>
          </div>
          <h1 className="mt-3 max-w-4xl font-serif text-4xl font-light leading-none text-foreground md:text-6xl">{status.project.name}</h1>
          {status.project.directive ? <p className="mt-5 max-w-3xl text-base leading-7 text-muted">“{status.project.directive}”</p> : null}
        </div>
        <aside className="office-panel">
          <p className="text-[0.62rem] uppercase tracking-[0.18em] text-subtle">Jarvis recommends</p>
          <p className="mt-3 text-sm leading-6 text-foreground">{jarvisRecommendation(status.overallState)}</p>
        </aside>
      </header>

      {approvalSteps.length > 0 ? (
        <section aria-labelledby="jarvis-approval-heading" className="border border-amber-300/40 bg-amber-300/10 p-5">
          <p className="text-[0.62rem] uppercase tracking-[0.18em] text-amber-100">Paused safely</p>
          <h2 id="jarvis-approval-heading" className="mt-1 font-serif text-2xl font-light text-foreground">Jarvis needs your approval</h2>
          <p className="mt-2 text-sm text-amber-50/80">{approvalSteps.map((step) => step.title).join(" · ")}</p>
          <Link href={`/app/${organizationSlug}/my-work`} className="office-dispatch-button mt-4 inline-flex">Review approval →</Link>
        </section>
      ) : null}

      <section aria-labelledby="jarvis-plan-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.2em] text-subtle">Live plan</p>
            <h2 id="jarvis-plan-heading" className="mt-1 font-serif text-3xl font-light text-foreground">Ordered handoffs</h2>
          </div>
          <Link href={`/app/${organizationSlug}/projects/${projectId}`} className="text-xs text-subtle hover:text-foreground">Open full project →</Link>
        </div>

        <ol className="space-y-3">
          {status.steps.map((step, index) => (
            <li key={step.taskId} className="office-panel grid gap-5 md:grid-cols-[3rem_1fr_auto]">
              <div className="font-serif text-3xl font-light text-subtle">{String(index + 1).padStart(2, "0")}</div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-medium text-foreground">{step.title}</h3>
                  <span className={`rounded-full border px-2 py-1 text-[0.58rem] uppercase tracking-[0.1em] ${STATE_STYLE[step.state]}`}>{JARVIS_STATE_LABELS[step.state]}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted">{step.goal}</p>
                {step.agent ? (
                  <p className="mt-3 text-xs text-subtle">{step.agent.role} · {step.agent.name}</p>
                ) : null}
                {step.execution?.waitReason ? (
                  <p className="mt-3 border-l-2 border-red-300/50 pl-3 text-xs leading-5 text-red-100">{step.execution.waitReason}</p>
                ) : null}
                {step.handoff ? <p className="mt-3 text-xs leading-5 text-subtle">Next handoff: {step.handoff}</p> : null}
              </div>
              <div className="flex min-w-36 flex-col items-start gap-2 text-xs md:items-end">
                {step.agent ? <Link href={`/app/${organizationSlug}/office/${step.agent.id}`} className="text-muted hover:text-foreground">Employee office →</Link> : null}
                {step.execution ? <Link href={`/app/${organizationSlug}/workflow-executions/${step.execution.id}`} className="text-muted hover:text-foreground">Execution →</Link> : null}
                {step.deliverable ? <Link href={`/app/${organizationSlug}/projects/${projectId}`} className="text-muted hover:text-foreground">Deliverable →</Link> : null}
                {step.pullRequestUrl ? <a href={step.pullRequestUrl} target="_blank" rel="noreferrer" className="text-muted hover:text-foreground">Pull request ↗</a> : null}
                {step.previewUrl ? <a href={step.previewUrl} target="_blank" rel="noreferrer" className="text-accent-foreground hover:text-foreground">Preview ↗</a> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {error ? <p role="status" className="text-xs text-amber-100">Live refresh paused: {error} <button type="button" className="underline" onClick={() => setRetryKey((value) => value + 1)}>Retry</button></p> : null}
    </div>
  );
}
