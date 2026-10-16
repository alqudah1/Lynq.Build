import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import * as wf from "@/lib/colour-workflow";
import ColourWorkbench from "./ColourWorkbench";

export const dynamic = "force-dynamic";
export const metadata = { title: "Colour | Arcubed", robots: { index: false, follow: false } };

export default async function ColourPage(props: PageProps<"/admin/colours/[id]">) {
  if (!(await isAdmin())) redirect("/admin");
  const { id } = await props.params;
  if (!(await wf.workflowAvailable())) redirect("/admin/colours");
  const [candidate, bags, catalogue] = await Promise.all([wf.getCandidate(id), wf.listBags(), wf.listCatalogue()]);
  if (!candidate) notFound();
  const refusals = Object.fromEntries(bags.map((b) => [b.slug, wf.bagRefusal(b, candidate.material, candidate.hex)]));
  const live = candidate.publishedColourId ? catalogue.filter((e) => e.colourId === candidate.publishedColourId) : [];
  return (
    <main className="adm">
      <p className="cw-back"><Link href="/admin/colours">← Colours</Link></p>
      <ColourWorkbench
        candidate={candidate}
        bags={bags}
        refusals={refusals}
        materialName={wf.MATERIALS[candidate.material]}
        live={live.map((e) => ({ ...e, bagName: bags.find((b) => b.id === e.productId)?.name ?? "" }))}
      />
    </main>
  );
}
