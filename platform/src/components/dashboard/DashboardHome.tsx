import Link from "next/link";
import { Suspense } from "react";
import { InvitationStatusBanner } from "./InvitationStatusBanner";
import { OfficeCommandCenter } from "./office/OfficeCommandCenter";
import type { DashboardSummary } from "@/lib/dashboard/summary";
import type { OfficeAgentProfile, OfficeView } from "@/lib/office/view";

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  assigned: "Assigned",
  gathering_context: "Gathering context",
  planning: "Planning",
  reasoning: "Thinking",
  waiting: "Waiting",
  executing: "Working",
  delegating: "Delegating",
  human_approval: "Needs approval",
  verifying: "Reviewing",
  paused: "Paused",
  completed: "Completed",
  failed: "Needs attention",
  cancelled: "Cancelled",
  archived: "Archived",
};

function EmployeeOffice({ employee, organizationSlug }: { employee: OfficeAgentProfile; organizationSlug: string }) {
  return (
    <Link
      href={`/app/${organizationSlug}/office/${employee.id}`}
      className="office-room group"
      aria-label={`Enter ${employee.title}'s office`}
    >
      <div className="office-room__ambient" aria-hidden="true" />
      <div className="relative z-[1] flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="office-monogram" aria-hidden="true">{employee.monogram}</div>
          <span className={`office-presence office-presence--${employee.presence}`}>{employee.presenceLabel}</span>
        </div>

        <div className="mt-8">
          <p className="text-[0.62rem] uppercase tracking-[0.2em] text-subtle">{employee.room}</p>
          <h3 className="mt-1 font-serif text-[1.65rem] leading-tight font-light text-foreground">{employee.title}</h3>
          <p className="mt-1 text-xs text-muted">{employee.registryName}</p>
        </div>

        <div className="mt-auto border-t border-white/[0.08] pt-4">
          {employee.currentAssignment ? (
            <>
              <p className="text-[0.6rem] uppercase tracking-[0.18em] text-subtle">Currently working on</p>
              <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted">{employee.currentAssignment}</p>
            </>
          ) : (
            <p className="text-sm text-subtle">Available for a new assignment.</p>
          )}
          <div className="mt-4 flex items-center justify-between text-xs">
            <span className="text-subtle">{employee.activeAssignmentCount} active · {employee.completedCount} completed</span>
            <span className="text-accent-foreground opacity-0 transition-opacity group-hover:opacity-100">Enter office →</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function DashboardHome({
  displayName,
  organizationName,
  organizationId,
  organizationSlug,
  workspaceId,
  summary,
  office,
}: {
  displayName: string;
  organizationName: string;
  workspaceName: string | null;
  organizationId: string;
  organizationSlug: string;
  workspaceId: string | null;
  summary: DashboardSummary;
  office: OfficeView;
}) {
  const base = `/app/${organizationSlug}`;
  const firstName = displayName.split(/\s|@/)[0] || displayName;
  const pendingWorkTotal = summary.pendingTaskCount + summary.pendingApprovalCount + summary.pendingFollowUpCount;
  const readyCount = office.employees.filter((employee) => employee.presence === "ready").length;

  return (
    <div className="office-floor flex flex-col gap-10 px-5 py-7 md:px-8 lg:px-10 lg:py-9">
      <Suspense fallback={null}>
        <InvitationStatusBanner />
      </Suspense>

      <header className="office-hero">
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.32em] text-accent-foreground">{organizationName} · LYNQ Office</p>
          <h1 className="mt-3 max-w-3xl font-serif text-4xl leading-[0.98] font-light text-foreground md:text-6xl">
            The company is <em className="text-accent-foreground">online.</em>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted md:text-base">
            Welcome back, {firstName}. Start with your assigned work or open a project. Leaders can ask Jarvis to coordinate company work and track every handoff.
          </p>
        </div>
        <div className="office-hero__pulse" aria-label={`${readyCount} employees ready and ${office.activeAssignmentCount} active assignments`}>
          <span className="office-hero__pulse-dot" />
          <div>
            <strong>{readyCount} ready</strong>
            <span>{office.activeAssignmentCount} assignments active</span>
          </div>
        </div>
      </header>

      <section aria-labelledby="office-start-heading" className="grid gap-3 md:grid-cols-3">
        <div className="office-panel md:col-span-2">
          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-subtle">Start here</p>
          <h2 id="office-start-heading" className="mt-1 font-serif text-2xl font-light text-foreground">Find what you need</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Your tasks live in My Work. Project briefs, tasks, and progress live in Projects. Use the Office home when you want a leader to coordinate a new piece of work.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`${base}/my-work`} className="office-mini-link">Open My Work</Link>
            <Link href={`${base}/projects`} className="office-mini-link">Open Projects</Link>
            <Link href={`${base}/workflows`} className="office-mini-link">View workflows</Link>
            <Link href={`${base}/jarvis`} className="office-mini-link">Ask Jarvis</Link>
          </div>
        </div>
        <aside className="office-panel">
          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-subtle">New here?</p>
          <h2 className="mt-1 font-serif text-xl font-light text-foreground">Work in three steps</h2>
          <ol className="mt-3 space-y-2 text-sm leading-5 text-muted">
            <li><span className="mr-2 text-accent-foreground">1.</span>Open My Work.</li>
            <li><span className="mr-2 text-accent-foreground">2.</span>Open the related project.</li>
            <li><span className="mr-2 text-accent-foreground">3.</span>Update progress or ask for help.</li>
          </ol>
        </aside>
      </section>

      <OfficeCommandCenter
        organizationId={organizationId}
        organizationSlug={organizationSlug}
        workspaceId={workspaceId}
      />

      <section aria-labelledby="office-team-heading">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.24em] text-subtle">Company floor</p>
            <h2 id="office-team-heading" className="mt-1 font-serif text-3xl font-light text-foreground">Your leadership team</h2>
          </div>
          <Link href={`${base}/founder/agents`} className="text-xs text-subtle transition-colors hover:text-foreground">Workforce report →</Link>
        </div>
        <div className="office-grid">
          {office.employees.map((employee) => (
            <EmployeeOffice key={employee.id} employee={employee} organizationSlug={organizationSlug} />
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <section aria-labelledby="office-activity-heading" className="office-panel">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.65rem] uppercase tracking-[0.2em] text-subtle">Live company feed</p>
              <h2 id="office-activity-heading" className="mt-1 font-serif text-2xl font-light text-foreground">What&apos;s happening</h2>
            </div>
            <Link href={`${base}/my-work`} className="text-xs text-subtle hover:text-foreground">Open work →</Link>
          </div>
          {office.recentActivity.length > 0 ? (
            <ol className="mt-5 flex flex-col">
              {office.recentActivity.map((item) => (
                <li key={item.id} className="office-activity-row">
                  <span className={`office-activity-dot office-activity-dot--${item.status}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm text-foreground">{item.agentName}</p>
                      <span className="text-[0.62rem] uppercase tracking-[0.12em] text-subtle">{STATUS_LABEL[item.status] ?? item.status}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">{item.title}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-5 text-sm text-subtle">The office is quiet. Send the first directive above.</p>
          )}
        </section>

        <aside className="office-panel" aria-labelledby="office-company-heading">
          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-subtle">Founder&apos;s snapshot</p>
          <h2 id="office-company-heading" className="mt-1 font-serif text-2xl font-light text-foreground">Company today</h2>
          <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border">
            <div className="bg-[#0c0c0c] p-4">
              <dt className="text-[0.62rem] uppercase tracking-[0.12em] text-subtle">Projects</dt>
              <dd className="mt-2 font-serif text-3xl font-light text-foreground">{summary.activeProjectCount}</dd>
            </div>
            <div className="bg-[#0c0c0c] p-4">
              <dt className="text-[0.62rem] uppercase tracking-[0.12em] text-subtle">Completed</dt>
              <dd className="mt-2 font-serif text-3xl font-light text-foreground">{office.completedThisPeriod}</dd>
            </div>
            <div className="bg-[#0c0c0c] p-4">
              <dt className="text-[0.62rem] uppercase tracking-[0.12em] text-subtle">Pipeline</dt>
              <dd className="mt-2 font-serif text-2xl font-light text-foreground">{summary.openOpportunityCount}</dd>
            </div>
            <div className="bg-[#0c0c0c] p-4">
              <dt className="text-[0.62rem] uppercase tracking-[0.12em] text-subtle">Needs you</dt>
              <dd className="mt-2 font-serif text-2xl font-light text-foreground">{pendingWorkTotal}</dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href={`${base}/projects`} className="office-mini-link">Projects</Link>
            <Link href={`${base}/crm`} className="office-mini-link">CRM</Link>
            <Link href={`${base}/marketing`} className="office-mini-link">Marketing</Link>
            <Link href={`${base}/founder`} className="office-mini-link">Founder OS</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
