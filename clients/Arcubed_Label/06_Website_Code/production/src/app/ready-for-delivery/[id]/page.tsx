import { notFound } from "next/navigation";
import { getReadyForDeliveryItemById, getStoreSettings } from "@/lib/repository";
import ReadyForDeliveryDetail from "./ReadyForDeliveryDetail";

// Live catalog data should never be prerendered — see app/page.tsx for why
// this must be explicit rather than inferred.
export const dynamic = "force-dynamic";

export default async function ReadyForDeliveryDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const [item, settings] = await Promise.all([getReadyForDeliveryItemById(id), getStoreSettings()]);
  if (!item) notFound();

  return <ReadyForDeliveryDetail item={item} fulfillmentLabel={settings?.readyForDeliveryFulfillmentLabel ?? "Next day"} />;
}
