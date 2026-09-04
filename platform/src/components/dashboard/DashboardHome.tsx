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

        <div className="mt-6">
          <p className="text-[0.62rem] uppercase tracking-[0.2em] text-subtle">{employee.room}</p>
          <h3 className="mt-1 font-serif text-[1.65rem] leading-tight font-light text-foreground">{employee.title}</h3>
          <p className="mt-1 text-xs text-muted">{employee.registryName}</p>
        </div>

        <div className="mt-auto border-t border-border pt-4">
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

const TEAM_LANES = [
  {
    id: "leadership",
    eyebrow: "Direction",
    title: "Leadership",
    description: "Turns your direction into a coordinated company plan.",
  },
  {
    id: "growth",
    eyebrow: "Demand",
    title: "Growth & clients",
    description: "Finds opportunities, creates campaigns, and manages relationships.",
  },
  {
    id: "delivery",
    eyebrow: "Execution",
    title: "Product & delivery",
    description: "Designs, builds, checks, and delivers the work.",
  },
] as const;

function teamLaneFor(employee: OfficeAgentProfile): (typeof TEAM_LANES)[number]["id"] {
  if (["founders_office", "finance_and_operations", "legal_and_compliance"].includes(employee.department)) {
    return "leadership";
  }
  if (["sales_and_bizdev", "marketing_and_brand", "client_success", "support"].includes(employee.department)) {
    return "growth";
  }
  return "delivery";
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
  const workingCount = office.employees.filter((employee) => employee.presence === "working").length;
  const attentionCount = office.employees.filter((employee) => employee.presence === "attention").length;

  return (
    <div className="office-floor flex min-h-full flex-col gap-8 px-4 py-5 md:px-7 md:py-7 lg:px-9 lg:py-8">
      <Suspense fallback={null}>
        <InvitationStatusBanner />
      </Suspense>

      <header className="office-hero">
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.28em] text-subtle">{organizationName} · Company Office</p>
          <h1 className="mt-3 max-w-3xl font-serif text-4xl leading-[1.02] font-light text-foreground md:text-5xl">
            Good to see you, {firstName}.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted md:text-base">
            This is your company at a glance. Give Jarvis a direction, see who is working, and step in only when the team needs you.
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

      <section aria-label="Company status" className="office-overview-grid">
        <div className="office-overview-card">
          <span>Working now</span>
          <strong>{workingCount}</strong>
          <small>{office.activeAssignmentCount} active assignments</small>
        </div>
        <div className="office-overview-card">
          <span>Needs you</span>
          <strong>{pendingWorkTotal}</strong>
          <small>{attentionCount} employees waiting</small>
        </div>
        <div className="office-overview-card">
          <span>Active projects</span>
          <strong>{summary.activeProjectCount}</strong>
          <small>{office.completedThisPeriod} completed</small>
        </div>
        <div className="office-overview-card">
          <span>Open pipeline</span>
          <strong>{summary.openOpportunityCount}</strong>
          <small>sales opportunities</small>
        </div>
      </section>

      <section aria-labelledby="office-start-heading" className="office-start-grid">
        <div className="min-w-0">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-[0.65rem] uppercase tracking-[0.2em] text-subtle">Command center</p>
              <h2 id="office-start-heading" className="mt-1 font-serif text-2xl font-light text-foreground">Tell Jarvis what happens next</h2>
            </div>
            <Link href={`${base}/jarvis`} className="office-text-link">See every directive →</Link>
          </div>
          <OfficeCommandCenter
            organizationId={organizationId}
            organizationSlug={organizationSlug}
            workspaceId={workspaceId}
          />
        </div>

        <aside className="office-panel office-shortcuts" aria-label="Quick access">
          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-subtle">Quick access</p>
          <h2 className="mt-1 font-serif text-xl font-light text-foreground">Go straight to the work</h2>
          <nav className="mt-5 grid gap-2">
            <Link href={`${base}/my-work`} className="office-shortcut"><span>01</span><div><strong>My Work</strong><small>Tasks and approvals for you</small></div><b>→</b></Link>
            <Link href={`${base}/projects`} className="office-shortcut"><span>02</span><div><strong>Projects</strong><small>Briefs, progress, and files</small></div><b>→</b></Link>
            <Link href={`${base}/marketing`} className="office-shortcut"><span>03</span><div><strong>Marketing</strong><small>Plan, create, and publish</small></div><b>→</b></Link>
            <Link href={`${base}/crm`} className="office-shortcut"><span>04</span><div><strong>CRM</strong><small>Leads and conversations</small></div><b>→</b></Link>
          </nav>
        </aside>
      </section>

      <section aria-labelledby="office-team-heading">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.24em] text-subtle">Connected company</p>
            <h2 id="office-team-heading" className="mt-1 font-serif text-3xl font-light text-foreground">See how the team works together</h2>
          </div>
          <Link href={`${base}/founder/agents`} className="office-text-link">Open workforce report →</Link>
        </div>
        <div className="office-company-map">
          {TEAM_LANES.map((lane, index) => {
            const employees = office.employees.filter((employee) => teamLaneFor(employee) === lane.id);
            return (
              <section key={lane.id} className="office-team-lane" aria-labelledby={`office-lane-${lane.id}`}>
                <div className="office-team-lane__heading">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <p>{lane.eyebrow}</p>
                    <h3 id={`office-lane-${lane.id}`}>{lane.title}</h3>
                    <small>{lane.description}</small>
                  </div>
                </div>
                <div className="office-grid">
                  {employees.map((employee) => (
                    <EmployeeOffice key={employee.id} employee={employee} organizationSlug={organizationSlug} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <section aria-labelledby="office-activity-heading" className="office-panel">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.65rem] uppercase tracking-[0.2em] text-subtle">Live company feed</p>
              <h2 id="office-activity-heading" className="mt-1 font-serif text-2xl font-light text-foreground">What&apos;s happening</h2>
            </div>
            <Link href={`${base}/my-work`} className="office-text-link">Open work →</Link>
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
            <div className="office-metric p-4">
              <dt className="text-[0.62rem] uppercase tracking-[0.12em] text-subtle">Projects</dt>
              <dd className="mt-2 font-serif text-3xl font-light text-foreground">{summary.activeProjectCount}</dd>
            </div>
            <div className="office-metric p-4">
              <dt className="text-[0.62rem] uppercase tracking-[0.12em] text-subtle">Completed</dt>
              <dd className="mt-2 font-serif text-3xl font-light text-foreground">{office.completedThisPeriod}</dd>
            </div>
            <div className="office-metric p-4">
              <dt className="text-[0.62rem] uppercase tracking-[0.12em] text-subtle">Pipeline</dt>
              <dd className="mt-2 font-serif text-2xl font-light text-foreground">{summary.openOpportunityCount}</dd>
            </div>
            <div className="office-metric p-4">
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
