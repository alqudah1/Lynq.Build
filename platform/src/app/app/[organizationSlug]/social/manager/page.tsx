import { listBrands } from "@/lib/social-os/brands";
import { listManagerThreads } from "@/lib/social-os/manager";
import { describeAiProviders, loadSocialAiEnv } from "@/lib/social-os/providers/ai/registry";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import { createManagerThreadAction } from "@/lib/dashboard/actions/social";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { SocialBrandSwitcher } from "@/components/social/SocialBrandSwitcher";
import { AiSetupCard, ManagerThreadList, NewThreadForm, managerSuggestions } from "@/components/social/ManagerParts";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { resolveBrandSelection } from "@/components/social/brand-selection";

export const dynamic = "force-dynamic";

export default async function SocialManagerPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ brand?: string }> }) {
  const { organizationSlug } = await params;
  const sp = await searchParams;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/manager`);

  let data;
  try {
    const brands = await listBrands(db, { organizationId: organization.id, actorUserId: user.userId });
    const selection = resolveBrandSelection(brands, sp.brand, true);
    const [threads, providers, timeZone] = await Promise.all([
      listManagerThreads(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId: selection.brandProfileId }),
      loadSocialAiEnv().then(describeAiProviders),
      getSocialTimezone(db, organization.id),
    ]);
    data = { brands, selection, threads, providers, timeZone };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "AI Social Manager" });
  }
  const { brands, selection, threads, providers, timeZone } = data;
  const textConfigured = providers.some((p) => p.kind === "text" && p.configured);
  const startThread = createManagerThreadAction.bind(null, organizationSlug);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "AI Manager" }])} />
      <PageHeader
        title="AI Social Manager"
        description="Ask for plans, drafts and analysis. Everything it creates lands as a draft for your review."
        actions={<SocialBrandSwitcher brands={brands.map((b) => ({ id: b.id, name: b.name }))} selectedBrandId={selection.selectedBrandId} />}
      />

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside aria-labelledby="manager-threads" className="order-2 flex flex-col gap-4 lg:order-1">
          <h2 id="manager-threads" className="text-xs uppercase tracking-[0.1em] text-subtle">Conversations</h2>
          <ManagerThreadList organizationSlug={organizationSlug} threads={threads} brandParam={selection.brandParam} timeZone={timeZone} />
          <NewThreadForm organizationSlug={organizationSlug} brandProfileId={selection.brandProfileId} />
        </aside>

        <section aria-labelledby="manager-start" className="order-1 flex flex-col gap-4 lg:order-2">
          <h2 id="manager-start" className="text-xs uppercase tracking-[0.1em] text-subtle">Start with</h2>
          {textConfigured ? (
            <Card className="flex flex-col gap-4">
              <p className="text-sm text-muted">{selection.brandName ? `Working on ${selection.brandName}.` : "Choose a brand above so the manager works in that brand's voice."} Pick a starting point — it opens a new conversation with the prompt ready to send.</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {managerSuggestions(selection.brandName).map((prompt) => (
                  <li key={prompt}>
                    <ActionForm action={startThread} hiddenFields={{ prompt, title: prompt.slice(0, 80), ...(selection.brandProfileId ? { brandProfileId: selection.brandProfileId } : {}) }} className="h-full [&_button]:h-full [&_button]:w-full [&_button]:justify-start [&_button]:py-3 [&_button]:text-left [&_button]:normal-case [&_button]:tracking-normal">
                      <SubmitButton variant="glass" pendingLabel="Opening…">{prompt}</SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <AiSetupCard providers={providers} />
          )}
        </section>
      </div>
    </div>
  );
}
