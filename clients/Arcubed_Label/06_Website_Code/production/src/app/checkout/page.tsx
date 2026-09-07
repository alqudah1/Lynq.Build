// Checkout. Server component loads the authoritative shipping rules and
// production timing; all amounts shown are recomputed server-side at submit.
import { getShippingRules, getStoreSettings } from "@/lib/repository";
import { plainText } from "@/lib/site-settings";
import CheckoutClient from "./CheckoutClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const [rules, settings] = await Promise.all([getShippingRules(), getStoreSettings()]);
  const fulfillmentLabel = settings?.readyForDeliveryFulfillmentLabel ?? "Next day";
  return (
    <CheckoutClient
      rules={rules}
      productionTimeLabel={plainText(settings?.productionTimeLabel ?? "3 to 5 business days")}
      deliveryPromise={`${fulfillmentLabel.replace(/\s+day$/i, "-day")} delivery in Jordan`}
      currency={settings?.currencyCode ?? "JOD"}
    />
  );
}
