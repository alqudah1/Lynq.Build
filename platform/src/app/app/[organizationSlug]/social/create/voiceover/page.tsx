import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { VoiceoverTool } from "@/components/social/VoiceoverTool";
import { loadSocialPageContext, socialBreadcrumbs } from "@/components/social/page-context";

export const dynamic = "force-dynamic";

/** Voiceover: AI voice clips (Arabic or English) for reels, one per script line. */
export default async function SocialVoiceoverPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const { organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/create/voiceover`);
  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "Create", href: `/app/${organizationSlug}/social/create` }, { label: "Voiceover" }])} />
      <PageHeader eyebrow="Create" title="Voiceover" description="Turn a reel script into voice clips, one per line, in Levantine or Standard Arabic or English." />
      <Card>
        <VoiceoverTool organizationId={organization.id} />
      </Card>
    </div>
  );
}
