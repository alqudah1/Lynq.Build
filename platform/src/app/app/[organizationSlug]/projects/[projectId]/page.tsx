import Link from "next/link";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users } from "@/db/schema";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getProjectForUser, getLegalProjectTransitions } from "@/lib/projects/projects";
import { calculateProjectProgress, calculateMilestoneProgress } from "@/lib/projects/progress";
import { listPhases } from "@/lib/projects/phases";
import { listMilestones } from "@/lib/projects/milestones";
import { listTasks, listTaskAssignments } from "@/lib/projects/tasks";
import { listDependenciesForTask } from "@/lib/projects/dependencies";
import { listProjectMembers } from "@/lib/projects/members";
import { listProjectEvents } from "@/lib/projects/events";
import { listArtifactLinks, listApprovalLinks, listExecutionLinksForProject, listExecutionLinksForTask } from "@/lib/projects/links";
import {
  transitionProjectAction,
  createPhaseAction,
  updatePhaseStatusAction,
  createMilestoneAction,
  updateMilestoneStatusAction,
  createTaskAction,
  transitionTaskAction,
  assignTaskAction,
  unassignTaskAction,
  addDependencyAction,
  linkArtifactAction,
  linkApprovalAction,
  launchKnowledgeAnalystAction,
} from "@/lib/dashboard/actions/projects";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ProjectTabs } from "@/components/dashboard/projects/ProjectTabs";
import { ProjectStatusControl } from "@/components/dashboard/projects/ProjectStatusControl";
import { PhaseItem } from "@/components/dashboard/projects/PhaseItem";
import { CreatePhaseForm } from "@/components/dashboard/projects/CreatePhaseForm";
import { MilestoneItem } from "@/components/dashboard/projects/MilestoneItem";
import { CreateMilestoneForm } from "@/components/dashboard/projects/CreateMilestoneForm";
import { TaskItem } from "@/components/dashboard/projects/TaskItem";
import { CreateTaskForm } from "@/components/dashboard/projects/CreateTaskForm";
import { ActivityFeed } from "@/components/dashboard/projects/ActivityFeed";
import { ArtifactsSection } from "@/components/dashboard/projects/ArtifactsSection";
import { ApprovalsSection } from "@/components/dashboard/projects/ApprovalsSection";
import { AgentsSection } from "@/components/dashboard/projects/AgentsSection";

export const dynamic = "force-dynamic";

async function loadProjectDetailData(
  db: ReturnType<typeof createDbClient>,
  organizationSlug: string,
  projectId: string,
  actorUserId: string
) {
  const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, actorUserId);
  const project = await getProjectForUser(db, { organizationId: organization.id, projectId, actorUserId });

  const [progress, phases, milestones, tasks, members, events, artifactLinks, approvalLinks, executionLinks] = await Promise.all([
    calculateProjectProgress(db, organization.id, projectId),
    listPhases(db, { organizationId: organization.id, projectId, actorUserId }),
    listMilestones(db, { organizationId: organization.id, projectId, actorUserId }),
    listTasks(db, { organizationId: organization.id, projectId, actorUserId }),
    listProjectMembers(db, { organizationId: organization.id, projectId, actorUserId }),
    listProjectEvents(db, projectId, 50),
    listArtifactLinks(db, { organizationId: organization.id, projectId, actorUserId }),
    listApprovalLinks(db, { organizationId: organization.id, projectId, actorUserId }),
    listExecutionLinksForProject(db, { organizationId: organization.id, projectId, actorUserId }),
  ]);

  const milestonesWithProgress = await Promise.all(
    milestones.map(async (m) => ({ milestone: m, progress: await calculateMilestoneProgress(db, organization.id, m.id) }))
  );

  const tasksWithDetails = await Promise.all(
    tasks.map(async (task) => {
      const [assignments, dependencies, taskExecutions] = await Promise.all([
        listTaskAssignments(db, task.id),
        listDependenciesForTask(db, organization.id, task.id),
        listExecutionLinksForTask(db, { organizationId: organization.id, taskId: task.id, actorUserId }),
      ]);
      return { task, assignments, dependencies, executionCount: taskExecutions.length };
    })
  );
  const taskTitleById = new Map(tasks.map((t) => [t.id, t.title]));

  const actorIds = [...new Set(events.map((e) => e.actorUserId).filter((id): id is string => Boolean(id)))];
  const actors = actorIds.length > 0 ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, actorIds)) : [];
  const actorNameById = new Map(actors.map((a) => [a.id, a.name ?? a.email]));

  const legalTargets = getLegalProjectTransitions(project.status);

  return {
    organizationName: organization.name,
    project,
    progress,
    phases,
    milestones,
    milestonesWithProgress,
    tasks,
    tasksWithDetails,
    members,
    events,
    artifactLinks,
    approvalLinks,
    executionLinks,
    taskTitleById,
    actorNameById,
    legalTargets,
  };
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ organizationSlug: string; projectId: string }> }) {
  const { organizationSlug, projectId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/projects/${projectId}`);

  let data: Awaited<ReturnType<typeof loadProjectDetailData>>;
  try {
    data = await loadProjectDetailData(db, organizationSlug, projectId, user.userId);
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const {
    organizationName,
    project,
    progress,
    phases,
    milestonesWithProgress,
    milestones,
    tasksWithDetails,
    tasks,
    members,
    events,
    artifactLinks,
    approvalLinks,
    executionLinks,
    taskTitleById,
    actorNameById,
    legalTargets,
  } = data;

  const overviewContent = (
    <div className="flex flex-col gap-8">
      <ProjectStatusControl currentStatus={project.status} legalTargets={legalTargets} expectedRevision={project.revision} action={transitionProjectAction.bind(null, organizationSlug, projectId)} />
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-[0.1em] text-subtle">Progress</span>
          <ProgressBar percentage={progress.percentage} />
        </div>
        {project.description ? <p className="mt-1 text-sm text-foreground">{project.description}</p> : null}
        {project.objective ? <p className="text-sm text-muted">Objective: {project.objective}</p> : null}
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Phases</h2>
        {phases.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {phases.map((phase) => (
              <PhaseItem key={phase.id} phase={phase} action={updatePhaseStatusAction.bind(null, organizationSlug, projectId, phase.id)} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No phases yet." />
        )}
        <CreatePhaseForm action={createPhaseAction.bind(null, organizationSlug, projectId)} />
      </section>
    </div>
  );

  const tasksContent = (
    <div className="flex flex-col gap-6">
      <CreateTaskForm action={createTaskAction.bind(null, organizationSlug, projectId)} phases={phases} milestones={milestones} />
      {tasksWithDetails.length === 0 ? (
        <EmptyState title="No tasks yet." />
      ) : (
        <ul className="flex flex-col gap-3">
          {tasksWithDetails.map(({ task, assignments, dependencies, executionCount }) => (
            <TaskItem
              key={task.id}
              task={task}
              assignees={assignments}
              members={members}
              otherTasks={tasks.filter((t) => t.id !== task.id).map((t) => ({ id: t.id, title: t.title }))}
              blockedByTitles={dependencies.blockedBy.map((d) => taskTitleById.get(d.blockingTaskId) ?? "another task")}
              executionCount={executionCount}
              transitionAction={transitionTaskAction.bind(null, organizationSlug, projectId, task.id)}
              assignAction={assignTaskAction.bind(null, organizationSlug, projectId, task.id)}
              unassignAction={async (userId: string) => {
                "use server";
                return unassignTaskAction(organizationSlug, projectId, task.id, userId);
              }}
              addDependencyAction={addDependencyAction.bind(null, organizationSlug, projectId, task.id)}
              launchAgentAction={launchKnowledgeAnalystAction.bind(null, organizationSlug, projectId, task.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );

  const milestonesContent = (
    <div className="flex flex-col gap-6">
      <CreateMilestoneForm action={createMilestoneAction.bind(null, organizationSlug, projectId)} />
      {milestonesWithProgress.length === 0 ? (
        <EmptyState title="No milestones yet." />
      ) : (
        <ul className="flex flex-col gap-2">
          {milestonesWithProgress.map(({ milestone, progress: milestoneProgress }) => (
            <MilestoneItem key={milestone.id} milestone={milestone} progress={milestoneProgress} action={updateMilestoneStatusAction.bind(null, organizationSlug, projectId, milestone.id)} />
          ))}
        </ul>
      )}
    </div>
  );

  const activityContent = <ActivityFeed events={events} actorNameById={actorNameById} />;
  const artifactsContent = <ArtifactsSection links={artifactLinks} projectId={projectId} action={linkArtifactAction.bind(null, organizationSlug, projectId)} />;
  const agentsContent = (
    <div className="flex flex-col gap-6">
      <AgentsSection links={executionLinks} taskTitleById={taskTitleById} />
      <div>
        <h2 className="mb-2 text-xs uppercase tracking-[0.1em] text-subtle">Approvals</h2>
        <ApprovalsSection links={approvalLinks} projectId={projectId} action={linkApprovalAction.bind(null, organizationSlug, projectId)} />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs
        items={[
          { label: "LYNQ", href: "/app" },
          { label: organizationName, href: `/app/${organizationSlug}` },
          { label: "Projects", href: `/app/${organizationSlug}/projects` },
          { label: project.name },
        ]}
      />
      <PageHeader
        eyebrow={project.projectKey}
        title={project.name}
        actions={
          <Link
            href={`/app/${organizationSlug}/projects/${projectId}/settings`}
            className="lynq-transition flex min-h-11 items-center rounded-sm border border-border px-5 text-xs font-medium uppercase tracking-[0.08em] text-foreground hover:border-border-strong"
          >
            Settings
          </Link>
        }
      />

      <ProjectTabs
        tabs={[
          { id: "overview", label: "Overview", content: overviewContent },
          { id: "tasks", label: "Tasks", content: tasksContent },
          { id: "milestones", label: "Milestones", content: milestonesContent },
          { id: "activity", label: "Activity", content: activityContent },
          { id: "artifacts", label: "Artifacts", content: artifactsContent },
          { id: "agents", label: "Agents", content: agentsContent },
        ]}
      />
    </div>
  );
}
