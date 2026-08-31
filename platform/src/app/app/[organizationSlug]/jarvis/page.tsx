import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { listProjectsForUser } from "@/lib/projects/projects";
import { listWorkspacesForUser } from "@/lib/workspaces/workspaces";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { extractFounderDirective } from "@/lib/office/jarvis-presentation";
import { OfficeCommandCenter } from "@/components/dashboard/office/OfficeCommandCenter";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";

export const dynamic = "force-dynamic";

const PROJECT_STATUS: Record<string, string> = {
  proposed: "Queued",
  planning: "Planning",
  active: "In progress",
  on_hold: "Waiting",
  completed: "Done",
  cancelled: "Stopped",
};

export default async function JarvisPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/jarvis`);

  let organization;
  let projects;
  try {
    ({ organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId));
    projects = await listProjectsForUser(db, { organizationId: organization.id, actorUserId: user.userId });
  } catch (error) {
    if (error instanceof TenantResourceNotFoundError) notFound();
    throw error;
  }

  const workspaces = await listWorkspacesForUser(db, user.userId);
  const workspace = workspaces.find((item) => item.organizationId === organization.id && item.slug === "operations")
    ?? workspaces.find((item) => item.organizationId === organization.id)
    ?? null;
  const directives = projects
    .map((project) => ({ project, directive: extractFounderDirective(project.description) }))
    .filter((item): item is typeof item & { directive: string } => Boolean(item.directive));

  return (
    <div className="office-floor flex flex-col gap-8 px-5 py-7 md:px-8 lg:px-10 lg:py-9">
      <Breadcrumbs items={[{ label: "Office", href: `/app/${organizationSlug}` }, { label: "Jarvis" }]} />
      <header className="max-w-4xl">
        <p className="text-[0.65rem] uppercase tracking-[0.3em] text-accent-foreground">Founder command</p>
        <h1 className="mt-2 font-serif text-4xl font-light leading-none text-foreground md:text-6xl">Jarvis Command Center</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted md:text-base">
          Tell Jarvis the outcome you want. He creates the project, briefs the right employees, tracks each handoff, and stops when your approval is required.
        </p>
      </header>

      <OfficeCommandCenter organizationId={organization.id} organizationSlug={organizationSlug} workspaceId={workspace?.id ?? null} navigateToDirective />

      <section aria-labelledby="jarvis-directives-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.22em] text-subtle">Live coordination</p>
            <h2 id="jarvis-directives-heading" className="mt-1 font-serif text-3xl font-light text-foreground">Your directives</h2>
          </div>
          <Link href={`/app/${organizationSlug}/projects`} className="text-xs text-subtle hover:text-foreground">All projects →</Link>
        </div>

        {directives.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {directives.map(({ project, directive }) => (
              <Link key={project.id} href={`/app/${organizationSlug}/jarvis/${project.id}`} className="office-panel group block min-h-52 transition-colors hover:border-white/30">
                <div className="flex items-start justify-between gap-4">
                  <span className="text-[0.62rem] uppercase tracking-[0.16em] text-subtle">{project.projectKey}</span>
                  <span className="rounded-full border border-border px-2 py-1 text-[0.6rem] uppercase tracking-[0.12em] text-muted">{PROJECT_STATUS[project.status] ?? project.status}</span>
                </div>
                <h3 className="mt-6 font-serif text-2xl font-light leading-tight text-foreground">{project.name}</h3>
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted">{directive}</p>
                <p className="mt-6 text-xs text-accent-foreground opacity-80 transition-opacity group-hover:opacity-100">Open live coordination →</p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="office-panel">
            <p className="text-sm text-muted">No Jarvis directives yet. Give him the first objective above.</p>
          </div>
        )}
      </section>
    </div>
  );
}
