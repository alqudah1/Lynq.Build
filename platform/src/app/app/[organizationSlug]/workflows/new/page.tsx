import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { CreateWorkflowForm } from "@/components/dashboard/workflows/CreateWorkflowForm";
import { createWorkflowAction } from "@/lib/dashboard/actions/workflows";

export const dynamic = "force-dynamic";

export default async function NewWorkflowPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/workflows/new`);

  let organizationName: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Workflows", href: `/app/${organizationSlug}/workflows` }, { label: "New" }]} />
      <h1 className="font-serif text-3xl italic font-light text-foreground">New workflow</h1>
      <CreateWorkflowForm action={createWorkflowAction.bind(null, organizationSlug)} />
    </div>
  );
}
