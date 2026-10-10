// Colour lab — the recolouring prototype, for review before anything reaches
// the storefront. Admin only: src/proxy.ts refuses /admin/* without a signed
// session, and this page checks again. noindex. Nothing here is orderable and
// no preview image is published: every preview is drawn in the viewer's own
// browser from an authentic photograph.

import { redirect, notFound } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getBagBySlug, getStoreSettings } from "@/lib/repository";
import { plainText } from "@/lib/site-settings";
import ColourLab from "./ColourLab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Colour lab | Arcubed", robots: { index: false, follow: false } };

export default async function ColourLabPage() {
  if (!(await isAdmin())) redirect("/admin");
  const slugs = ["nova", "mini-luna", "vault", "loco"];
  const [settings, ...found] = await Promise.all([getStoreSettings(), ...slugs.map((s) => getBagBySlug(s))]);
  const bags = found.filter((b): b is NonNullable<typeof b> => Boolean(b));
  if (!bags.length) notFound();
  return <ColourLab bags={bags} productionTimeLabel={settings?.productionTimeLabel ? plainText(settings.productionTimeLabel) : null} />;
}
