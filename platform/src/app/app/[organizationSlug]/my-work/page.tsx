import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listMyWorkflowHumanTasks } from "@/lib/workflows/human-tasks";
import { listPendingApprovalsForApprover } from "@/lib/agent-runtime/approvals";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { HumanTaskCard } from "@/components/dashboard/workflows/HumanTaskCard";
import { PendingApprovalCard } from "@/components/dashboard/workflows/PendingApprovalCard";
import { completeHumanTaskAction, approveApprovalAction, rejectApprovalAction } from "@/lib/dashboard/actions/workflows";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

export default async function MyWorkPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/my-work`);

  let organizationName: string;
  let tasks: Awaited<ReturnType<typeof listMyWorkflowHumanTasks>>;
  let approvals: Awaited<ReturnType<typeof listPendingApprovalsForApprover>>;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    [tasks, approvals] = await Promise.all([
      listMyWorkflowHumanTasks(db, { organizationId: organization.id, actorUserId: user.userId, status: "pending" }),
      listPendingApprovalsForApprover(db, { organizationId: organization.id, actorUserId: user.userId }),
    ]);
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "My work" }]} />
      <PageHeader title="My work" description="Tasks and approvals assigned to you across active workflows." />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Assigned tasks</h2>
        {tasks.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {tasks.map((task) => (
              <HumanTaskCard key={task.id} task={task} completeAction={completeHumanTaskAction.bind(null, organizationSlug, task.id)} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No assigned workflow tasks right now." />
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
