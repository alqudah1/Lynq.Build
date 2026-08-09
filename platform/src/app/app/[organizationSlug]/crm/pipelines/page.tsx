import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listPipelinesForUser } from "@/lib/crm/pipelines";
import { listStagesForPipeline } from "@/lib/crm/stages";
import { listOpportunitiesForUser } from "@/lib/crm/opportunities";
import { createPipelineAction, createStageAction, setDefaultPipelineAction } from "@/lib/dashboard/actions/crm";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { CreatePipelineForm } from "@/components/dashboard/crm/CreatePipelineForm";
import { CreateStageForm } from "@/components/dashboard/crm/CreateStageForm";
import { SetDefaultPipelineForm } from "@/components/dashboard/crm/SetDefaultPipelineForm";
import { PipelineStageSummary, type StageSummary } from "@/components/dashboard/crm/PipelineStageSummary";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

/** Pipeline UI — structured stage list, opportunity counts/value, stage editing. Deliberately not a drag-and-drop Kanban board. */
export default async function PipelinesPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/crm/pipelines`);

  let organizationId: string;
  let organizationName: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationId = organization.id;
    organizationName = organization.name;
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const pipelines = await listPipelinesForUser(db, { organizationId, actorUserId: user.userId });

  const pipelinesWithStages = await Promise.all(
    pipelines.map(async (pipeline) => {
      const stages = await listStagesForPipeline(db, { organizationId, pipelineId: pipeline.id, actorUserId: user.userId });
      const opportunities = await listOpportunitiesForUser(db, { organizationId, actorUserId: user.userId, pipelineId: pipeline.id, limit: 200 });
      const summaries: StageSummary[] = stages.map((stage) => {
        const inStage = opportunities.filter((o) => o.stageId === stage.id);
        return { stage, count: inStage.length, totalAmount: inStage.reduce((sum, o) => sum + (o.amount ? Number(o.amount) : 0), 0) };
      });
      return { pipeline, summaries };
    })
  );

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "CRM", href: `/app/${organizationSlug}/crm` }, { label: "Pipelines" }]} />
      <PageHeader title="Pipelines" description="Structured sales stages — a plain, accessible list rather than a drag-and-drop board." />

      <CreatePipelineForm action={createPipelineAction.bind(null, organizationSlug)} />

      {pipelinesWithStages.length === 0 ? (
        <EmptyState title="No pipelines yet." description="Create the first one above." />
      ) : (
        <div className="flex flex-col gap-6">
          {pipelinesWithStages.map(({ pipeline, summaries }) => (
            <Card as="section" key={pipeline.id} padding="md" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-lg text-foreground">
                  {pipeline.name}
                  {pipeline.isDefault ? <Badge tone="accent">Default</Badge> : null}
                </h2>
                {!pipeline.isDefault ? <SetDefaultPipelineForm action={setDefaultPipelineAction.bind(null, organizationSlug, pipeline.id)} /> : null}
              </div>
              <PipelineStageSummary summaries={summaries} />
              <CreateStageForm pipelineId={pipeline.id} action={createStageAction.bind(null, organizationSlug)} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
