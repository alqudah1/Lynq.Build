"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

interface DispatchAssignment {
  agentId: string;
  agentName: string;
  role: string;
  taskId: string;
  executionId: string;
  status: string;
  title: string;
  handoff: string;
}

interface DirectiveResponse {
  data?: {
    assistantReply: string;
    plannedByAI: boolean;
    executionMode: "delivery" | "advisory";
    project: { id: string; name: string; projectKey: string; status: string };
    assignments: DispatchAssignment[];
  };
  error?: { message: string };
}

const STARTERS = [
  "Digitally transform a client business",
  "Build a sales and marketing plan",
  "Research a new market opportunity",
];

export function OfficeCommandCenter({
  organizationId,
  organizationSlug,
  workspaceId,
  preferredAgentId,
  employeeTitle,
  compact = false,
}: {
  organizationId: string;
  organizationSlug: string;
  workspaceId?: string | null;
  preferredAgentId?: string | null;
  employeeTitle?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState<DirectiveResponse["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = instruction.trim();
    if (trimmed.length < 10 || submitting) return;

    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/office/directives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: trimmed,
          ...(workspaceId ? { workspaceId } : {}),
          ...(preferredAgentId ? { preferredAgentId } : {}),
        }),
      });
      const payload = (await response.json()) as DirectiveResponse;
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "The office could not dispatch this directive.");
      setResult(payload.data);
      setInstruction("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The office could not dispatch this directive.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby={compact ? "employee-brief-heading" : "assistant-heading"} className={`office-command ${compact ? "office-command--compact" : ""}`}>
      <div className="office-command__assistant" aria-hidden="true">
        <span>EA</span>
        <i />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.24em] text-accent-foreground">{preferredAgentId ? "Direct assignment" : "Executive Assistant"}</p>
            <h2 id={compact ? "employee-brief-heading" : "assistant-heading"} className="mt-1 font-serif text-2xl font-light text-foreground">
              {preferredAgentId ? `Brief ${employeeTitle ?? "this employee"}` : "What should the company work on?"}
            </h2>
          </div>
          <span className="office-presence office-presence--ready">Ready</span>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor={preferredAgentId ? `office-directive-${preferredAgentId}` : "office-directive"} className="sr-only">
            Founder directive
          </label>
          <textarea
            id={preferredAgentId ? `office-directive-${preferredAgentId}` : "office-directive"}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={compact ? 3 : 4}
            maxLength={5000}
            placeholder={
              preferredAgentId
                ? `Tell ${employeeTitle ?? "this employee"} what you need…`
                : "Example: We signed KidsCoding. Digitally transform the business, create the strategy, redesign the website, and prepare marketing and sales."
            }
            className="office-command__input"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            {!compact ? (
              <div className="flex flex-wrap gap-2" aria-label="Example directives">
                {STARTERS.map((starter) => (
                  <button key={starter} type="button" onClick={() => setInstruction(starter)} className="office-starter">
                    {starter}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-subtle">This creates a real project task and tracked agent execution.</p>
            )}
            <button type="submit" disabled={submitting || instruction.trim().length < 10} className="office-dispatch-button">
              {submitting ? "Briefing the team…" : preferredAgentId ? "Assign work" : "Send to the office"}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </form>

        {error ? <p role="alert" className="mt-4 rounded-sm border border-danger/30 bg-danger-wash px-3 py-2 text-sm text-danger">{error}</p> : null}

        {result ? (
          <div className="office-dispatch-result" role="status">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-foreground">{result.assistantReply}</p>
                <p className="mt-1 text-xs text-subtle">Project {result.project.projectKey} · {result.assignments.length} workstream{result.assignments.length === 1 ? "" : "s"} dispatched</p>
              </div>
              <Link href={`/app/${organizationSlug}/projects/${result.project.id}`} className="text-xs font-medium text-accent-foreground hover:text-foreground">
                Open project →
              </Link>
            </div>
            <ul className="mt-4 grid gap-2 md:grid-cols-2">
              {result.assignments.map((assignment) => (
                <li key={assignment.taskId} className="rounded-sm border border-border bg-black/10 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-foreground">{assignment.role}</span>
                    <span className={`text-[0.6rem] uppercase tracking-[0.1em] ${assignment.status === "backlog" ? "text-muted" : "text-success"}`}>
                      {assignment.status === "backlog" ? "Queued" : "Started"}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{assignment.title}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
