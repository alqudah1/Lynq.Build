import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { computeAttentionItems } from "@/lib/founder-os/attention-engine";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { AttentionList } from "@/components/founder/AttentionList";

export const dynamic = "force-dynamic";

export default async function FounderAttentionPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/founder/attention`);

  let organizationName: string;
  let organizationId: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    organizationId = organization.id;
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const items = await computeAttentionItems(db, { organizationId, workspaceId: null, actorUserId: user.userId });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Founder", href: `/app/${organizationSlug}/founder` }, { label: "Attention" }]} />
      <PageHeader eyebrow="Founder Workspace" title="What needs your attention" description="A deterministic set of warning signals from real canonical records — never opaque AI scoring. Sorted by severity, then earliest due date." />
      <AttentionList items={items} />
    </div>
  );
}
