// Production time / shipping / return-policy copy is fetched live from the
// database (public.store_settings, public.shipping_rules,
// public.return_policies via repository.ts) rather than hardcoded here —
// see getStoreSettings()/getShippingRules()/getReturnPolicies(). Do not
// hardcode a specific lead time, rate, or return rule in this file again.

import { getStoreSettings, getShippingRules, getReturnPolicies } from "@/lib/repository";
import { formatMoney } from "@/lib/site-settings";
import type { ReturnPolicy } from "@/lib/types";

// Live catalog-adjacent data should never be prerendered — same reasoning as
// app/page.tsx.
export const dynamic = "force-dynamic";

function shippingSentence(rules: Awaited<ReturnType<typeof getShippingRules>>): string {
  if (!rules.length) {
    return "Shipping details will be published here once confirmed.";
  }
  const parts = rules.map((r) =>
    r.isQuoteRequired || r.amount === null
      ? `${r.label}: calculated based on destination — contact us for a quote`
      : `${r.label}: ${formatMoney(r.amount, r.currencyCode)}`
  );
  return parts.join(". ") + ".";
}

function returnAnswer(policies: ReturnPolicy[]): string {
  const custom = policies.find((p) => p.orderType === "custom");
  const ready = policies.find((p) => p.orderType === "ready_for_delivery");
  const parts: string[] = [];
  if (custom) parts.push(`Custom, made-to-order: ${custom.policySummary}`);
  if (ready) parts.push(`Ready for Delivery: ${ready.policySummary}`);
  const exceptions = custom?.exceptionsSummary ?? ready?.exceptionsSummary;
  if (exceptions) parts.push(exceptions);
  return parts.length ? parts.join(" ") : "Return policy will be published here once confirmed.";
}

export default async function FaqPage() {
  const [settings, shippingRules, returnPolicies] = await Promise.all([
    getStoreSettings(),
    getShippingRules(),
    getReturnPolicies(),
  ]);

  const productionAnswer = settings
    ? `Made-to-order bags: production takes ${settings.productionTimeLabel}. Ready for Delivery items (already in stock): ${settings.readyForDeliveryFulfillmentLabel.toLowerCase()} delivery.`
    : "Made-to-order bags have a lead time; Ready for Delivery items (already in stock) ship faster. Exact timing will be published here once confirmed.";

  const shippingAnswer = shippingSentence(shippingRules);

  const FAQS = [
    { q: "How long does it take to receive my bag?", a: productionAnswer },
    {
      q: "Can I customize any bag?",
      a: "Most styles offer colour, size, and — where relevant — strap, chain and two-tone choices in the customizer. Ready for Delivery items are already finished and don't go through the customizer — what you see is exactly what ships.",
    },
    {
      q: "What are your bags made from?",
      a: "100% cotton yarn, hand-crocheted. Spot clean and air dry to keep it looking its best.",
    },
    { q: "What's your shipping policy?", a: shippingAnswer },
    { q: "What's your return/exchange policy?", a: returnAnswer(returnPolicies) },
  ];

  return (
    <section className="section">
      <div className="page-head">
        <p className="eyebrow">FAQ</p>
        <h1>Good to know.</h1>
      </div>
      <div className="faq-list">
        {FAQS.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
