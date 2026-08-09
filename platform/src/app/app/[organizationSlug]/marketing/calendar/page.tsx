import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getMarketingCalendar } from "@/lib/marketing-os/calendar";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

/** Isolated in its own function so the page component's render body never calls `Date.now()` directly. */
function defaultCalendarWindow(): { from: Date; to: Date } {
  return { from: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), to: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) };
}

export default async function MarketingCalendarPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/calendar`);

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

  const { from, to } = defaultCalendarWindow();
  const events = await getMarketingCalendar(db, { organizationId, actorUserId: user.userId, from, to });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Marketing", href: `/app/${organizationSlug}/marketing` }, { label: "Calendar" }]} />
      <PageHeader title="Calendar" description="Derived from campaign start/end dates and content planned-publish dates — never a duplicate calendar record." />

      {events.length === 0 ? (
        <EmptyState title="Nothing scheduled in this window." />
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((event, i) => (
            <Card as="li" key={`${event.eventType}-${event.campaignId}-${event.contentItemId ?? i}`} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <Link href={event.contentItemId ? `/app/${organizationSlug}/marketing/content/${event.contentItemId}` : `/app/${organizationSlug}/marketing/campaigns/${event.campaignId}`} className="lynq-transition text-sm text-foreground hover:text-accent-foreground">
                  {event.title}
                </Link>
                <span className="text-xs text-subtle">{event.campaignName} · {event.eventType.replace(/_/g, " ")}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-subtle">{event.date.toLocaleDateString()}</span>
                <Badge tone="neutral">{event.status}</Badge>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
