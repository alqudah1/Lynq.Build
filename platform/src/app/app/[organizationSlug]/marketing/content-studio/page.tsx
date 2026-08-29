import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listBrandProfiles, listStudioDrafts } from "@/lib/marketing-os/content-studio";
import { resolveContentDraftAssistantAgent } from "@/lib/marketing-os/agents";
import { generateContentStudioConceptsAction, setupContentStudioAction } from "@/lib/dashboard/actions/marketing";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { SelectField } from "@/components/dashboard/SelectField";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export const dynamic = "force-dynamic";

export default async function ContentStudioPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const db = createDbClient(loadEnv());
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/content-studio`);
  let organization;
  try {
    ({ organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId));
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const [brands, drafts, agentReady] = await Promise.all([
    listBrandProfiles(db, { organizationId: organization.id, actorUserId: user.userId }),
    listStudioDrafts(db, { organizationId: organization.id, actorUserId: user.userId }),
    resolveContentDraftAssistantAgent(db, organization.id).then(() => true).catch(() => false),
  ]);
  const ready = brands.length === 2 && agentReady;

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organization.name, href: `/app/${organizationSlug}` }, { label: "Marketing", href: `/app/${organizationSlug}/marketing` }, { label: "Content Studio" }]} />
      <PageHeader title="Content Studio" description="Create brand-grounded posts, carousels, and short videos, then review and save them to the existing content calendar." />

      {!ready ? (
        <Card className="flex flex-col gap-4 border-l-2 border-l-accent">
          <div>
            <p className="text-sm text-foreground">One-time setup required</p>
            <p className="mt-1 text-xs text-subtle">Creates the two persistent brand profiles and connects Content Studio to the existing Content Draft Assistant. An organization owner or admin should run this once.</p>
          </div>
          <ActionForm action={setupContentStudioAction.bind(null, organizationSlug)}>
            <SubmitButton pendingLabel="Setting up…">Set up Content Studio</SubmitButton>
          </ActionForm>
        </Card>
      ) : (
        <ActionForm action={generateContentStudioConceptsAction.bind(null, organizationSlug)} className="grid gap-5 rounded-md border border-border bg-elevated p-5 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <p className="text-xs uppercase tracking-[0.16em] text-accent-foreground">New content package</p>
            <p className="mt-1 text-sm text-subtle">Describe the outcome. LYNQ Office will return exactly three distinct, brand-grounded concepts.</p>
          </div>
          <SelectField label="Brand" name="brandProfileId" options={brands.map((brand) => ({ value: brand.id, label: brand.name }))} />
          <SelectField label="Format & channel" name="intendedChannel" options={["Instagram Reel", "Instagram Single-image Post", "Instagram Carousel", "TikTok Video", "YouTube Short", "LinkedIn Post", "LinkedIn Carousel", "Facebook Post", "Multi-channel Static Post", "Multi-channel Short Video"].map((value) => ({ value, label: value }))} />
          <label className="flex flex-col gap-1.5 lg:col-span-2">
            <span className="text-xs uppercase tracking-[0.1em] text-subtle">Goal or topic *</span>
            <textarea name="goal" required rows={4} maxLength={2000} placeholder="Example: Create a carousel showing parents how a child turns one idea into a playable CodeIt project." className="lynq-transition rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-subtle focus-visible:border-accent/60" />
          </label>
          <FormField label="Planned publish date" name="plannedPublishAt" type="datetime-local" hint="Optional — adding a date lets an approved package appear as scheduled on the calendar." />
          <div className="flex items-end"><SubmitButton pendingLabel="Creating concepts…">Generate 3 concepts</SubmitButton></div>
        </ActionForm>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Recent Content Studio work</h2>
        {drafts.length === 0 ? <p className="text-sm text-subtle">No studio packages yet.</p> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {drafts.map((draft) => (
              <Card key={draft.id} as={Link} href={`/app/${organizationSlug}/marketing/content-studio/${draft.id}`} interactive padding="sm" className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2"><span className="text-sm text-foreground">{draft.productionPackage?.title ?? draft.goal}</span><Badge tone={draft.status === "saved" ? "success" : "neutral"}>{draft.status}</Badge></div>
                <p className="line-clamp-2 text-xs text-subtle">{draft.goal}</p>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
