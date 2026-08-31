import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { getProjectForUser } from "@/lib/projects/projects";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { JarvisDirectiveView } from "@/components/dashboard/office/JarvisDirectiveView";

export const dynamic = "force-dynamic";

export default async function JarvisDirectivePage({ params }: { params: Promise<{ organizationSlug: string; projectId: string }> }) {
  const { organizationSlug, projectId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/jarvis/${projectId}`);

  let organizationId: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    await getProjectForUser(db, { organizationId: organization.id, projectId, actorUserId: user.userId });
    organizationId = organization.id;
  } catch (error) {
    if (error instanceof TenantResourceNotFoundError) notFound();
    throw error;
  }

  return <JarvisDirectiveView organizationId={organizationId} organizationSlug={organizationSlug} projectId={projectId} />;
}
