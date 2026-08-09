import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listContentItemsForUser } from "@/lib/marketing-os/content";
import { listCampaignsForUser } from "@/lib/marketing-os/campaigns";
import { createContentItemAction } from "@/lib/dashboard/actions/marketing";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { MARKETING_CONTENT_TYPES, type MarketingContentStatus } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<MarketingContentStatus, BadgeTone> = { draft: "neutral", review: "info", approved: "success", scheduled: "info", published: "success", rejected: "danger", archived: "neutral" };

export default async function MarketingContentListPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ status?: string; campaignId?: string }> }) {
  const { organizationSlug } = await params;
  const { status } = await searchParams;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/content`);

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

  const [items, campaigns] = await Promise.all([
    listContentItemsForUser(db, { organizationId, actorUserId: user.userId, status: status as MarketingContentStatus | undefined }),
    listCampaignsForUser(db, { organizationId, actorUserId: user.userId }),
  ]);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Marketing", href: `/app/${organizationSlug}/marketing` }, { label: "Content" }]} />
      <PageHeader title="Content" description="Every marketing content item — body stored as a real, immutable Runtime artifact." />

      <ActionForm action={createContentItemAction.bind(null, organizationSlug)} className="flex flex-wrap items-end gap-3 border border-border p-4">
        <SelectField label="Campaign" name="campaignId" options={campaigns.map((c) => ({ value: c.id, label: c.name }))} />
        <FormField label="Title" name="title" required />
        <SelectField label="Content type" name="contentType" options={MARKETING_CONTENT_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))} />
        <SubmitButton>Create content</SubmitButton>
      </ActionForm>

      {items.length === 0 ? (
        <EmptyState title="No content items yet." />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <Card as="li" key={item.id} padding="sm">
              <Link href={`/app/${organizationSlug}/marketing/content/${item.id}`} className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-foreground">{item.title}</span>
                  <span className="text-xs text-subtle">{item.contentType.replace(/_/g, " ")}</span>
                </div>
                <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
              </Link>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
