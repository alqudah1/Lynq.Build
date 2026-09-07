// Server Component: fetches shipping rules + store settings (DB-backed, see
// repository.ts) so the real Amman/outside-Amman rates and production-time
// text render without hardcoding them in a client component. The cart
// itself is localStorage-backed client state — see CartPageClient.tsx.

import { getShippingRules, getStoreSettings } from "@/lib/repository";
import { plainText } from "@/lib/site-settings";
import CartPageClient from "./CartPageClient";

// Live shipping/settings data should never be prerendered — same reasoning
// as app/page.tsx.
export const dynamic = "force-dynamic";

export default async function CartPage() {
  const [shippingRules, storeSettings] = await Promise.all([getShippingRules(), getStoreSettings()]);

  return (
    <CartPageClient
      shippingRules={shippingRules}
      productionTimeLabel={storeSettings?.productionTimeLabel ? plainText(storeSettings.productionTimeLabel) : null}
      readyForDeliveryFulfillmentLabel={storeSettings?.readyForDeliveryFulfillmentLabel ?? null}
    />
  );
}
