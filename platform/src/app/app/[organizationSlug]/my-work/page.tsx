import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listProjectsForUser } from "@/lib/projects/projects";
import { listTasks, listTaskAssignments } from "@/lib/projects/tasks";
import { listMyWorkflowHumanTasks } from "@/lib/workflows/human-tasks";
import { listPendingApprovalsForApprover } from "@/lib/agent-runtime/approvals";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { HumanTaskCard } from "@/components/dashboard/workflows/HumanTaskCard";
import { PendingApprovalCard } from "@/components/dashboard/workflows/PendingApprovalCard";
import { completeHumanTaskAction, approveApprovalAction, rejectApprovalAction } from "@/lib/dashboard/actions/workflows";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AddMyWorkForm } from "@/components/dashboard/my-work/AddMyWorkForm";
import { createPersonalTaskAction } from "@/lib/dashboard/actions/projects";

export const dynamic = "force-dynamic";

export default async function MyWorkPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/my-work`);

  let organizationName: string;
  let tasks: Awaited<ReturnType<typeof listMyWorkflowHumanTasks>>;
  let approvals: Awaited<ReturnType<typeof listPendingApprovalsForApprover>>;
  let projects: Awaited<ReturnType<typeof listProjectsForUser>>;
  let personalTasks: { id: string; title: string; status: string; priority: string; projectId: string; projectName: string }[];
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    [tasks, approvals, projects] = await Promise.all([
      listMyWorkflowHumanTasks(db, { organizationId: organization.id, actorUserId: user.userId, status: "pending" }),
      listPendingApprovalsForApprover(db, { organizationId: organization.id, actorUserId: user.userId }),
      listProjectsForUser(db, { organizationId: organization.id, actorUserId: user.userId, status: "active" }),
    ]);
    const taskGroups = await Promise.all(projects.map(async (project) => {
      const projectTasks = await listTasks(db, { organizationId: organization.id, projectId: project.id, actorUserId: user.userId });
      const assignments = await Promise.all(projectTasks.map(async (task) => ({ task, assignees: await listTaskAssignments(db, task.id) })));
      return assignments.filter(({ assignees }) => assignees.some((assignee) => assignee.userId === user.userId)).map(({ task }) => ({ ...task, projectName: project.name }));
    }));
    personalTasks = taskGroups.flat();
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "My work" }]} />
      <PageHeader title="My work" description="Your project tasks, workflow tasks, and approvals in one place." actions={<AddMyWorkForm projects={projects.map((project) => ({ id: project.id, name: project.name }))} action={createPersonalTaskAction.bind(null, organizationSlug)} />} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Project work</h2>
        {personalTasks.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {personalTasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-elevated p-4">
                <div>
                  <p className="text-sm text-foreground">{task.title}</p>
                  <p className="mt-1 text-xs text-subtle">{task.projectName} · {task.status.replace(/_/g, " ")} · {task.priority} priority</p>
                </div>
                <a href={`/app/${organizationSlug}/projects/${task.projectId}?tab=tasks`} className="text-xs text-subtle hover:text-foreground">Open project →</a>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No project tasks assigned to you yet. Use + Add work to create one for yourself." />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Assigned tasks</h2>
        {tasks.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {tasks.map((task) => (
              <HumanTaskCard key={task.id} task={task} completeAction={completeHumanTaskAction.bind(null, organizationSlug, task.id)} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No workflow tasks assigned to you right now." />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Pending approvals</h2>
        {approvals.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {approvals.map((approval) => (
              <PendingApprovalCard
                key={approval.id}
                approval={{ id: approval.id, requestedAction: approval.requestedAction, summary: approval.summary, riskLevel: approval.riskLevel, expiresAt: approval.expiresAt }}
                approveAction={approveApprovalAction.bind(null, organizationSlug, approval.id)}
                rejectAction={rejectApprovalAction.bind(null, organizationSlug, approval.id)}
              />
            ))}
          </ul>
        ) : (
          <EmptyState title="No pending approvals right now." />
        )}
      </section>
    </div>
  );
}
