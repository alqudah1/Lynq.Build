import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listWorkspacesForUser } from "@/lib/workspaces/workspaces";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { CreateProjectForm } from "@/components/dashboard/projects/CreateProjectForm";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/projects/new`);

  let organizationName: string;
  let workspaces: { id: string; name: string }[];
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    const allWorkspaces = await listWorkspacesForUser(db, user.userId);
    workspaces = allWorkspaces.filter((w) => w.organizationId === organization.id).map((w) => ({ id: w.id, name: w.name }));
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  return (
    <div className="flex max-w-xl flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Projects", href: `/app/${organizationSlug}/projects` }, { label: "New" }]} />
      <header>
        <h1 className="font-serif text-3xl italic font-light text-foreground">New project</h1>
      </header>
      <CreateProjectForm organizationSlug={organizationSlug} workspaces={workspaces} />
    </div>
  );
}
