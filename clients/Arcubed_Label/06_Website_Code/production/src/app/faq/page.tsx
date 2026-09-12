// Production time / shipping / return-policy copy is fetched live from the
// database (public.store_settings, public.shipping_rules,
// public.return_policies via repository.ts) rather than hardcoded here —
// see getStoreSettings()/getShippingRules()/getReturnPolicies(). Do not
// hardcode a specific lead time, rate, or return rule in this file again.

import Image from "next/image";
import { getStoreSettings, getShippingRules, getReturnPolicies } from "@/lib/repository";
import { plainText } from "@/lib/site-settings";
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
      ? `${r.label}: calculated by destination. Contact us for a quote`
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
    ? `Made-to-order bags: production takes ${plainText(settings.productionTimeLabel)}. Ready for Delivery items (already in stock): ${settings.readyForDeliveryFulfillmentLabel.toLowerCase()} delivery.`
    : "Made-to-order bags have a lead time; Ready for Delivery items (already in stock) ship faster. Exact timing will be published here once confirmed.";

  const shippingAnswer = shippingSentence(shippingRules);

  // Grouped so the page reads as three subjects rather than one undifferentiated
  // list. The answers themselves are untouched and still come from the
  // database; only their arrangement changed.
  const GROUPS = [
    {
      label: "Ordering and making",
      items: [
        { q: "How long does it take to receive my bag?", a: productionAnswer },
        {
          q: "Can I customize any bag?",
          a: "Most styles offer colour, size, and, where relevant, strap, chain and two-tone choices in the customizer. Ready for Delivery items are already finished and don't go through the customizer. What you see is exactly what ships.",
        },
      ],
    },
    {
      label: "Shipping",
      items: [
        { q: "What's your shipping policy?", a: shippingAnswer },
        {
          // Nothing new is claimed here. Ready for Delivery is described in
          // exactly these terms on /ready-for-delivery and in the customizer
          // answer above; it was the one thing a customer had to assemble from
          // two different answers to understand.
          q: "What is Ready for Delivery?",
          a: "Pieces that are already made, photographed exactly as they ship. You choose one as it is: there is no customizer, and no colour, size or fitting to pick. In Jordan they go out for next-day delivery instead of being made to order.",
        },
      ],
    },
    {
      label: "Material, care and returns",
      items: [
        {
          q: "What are your bags made from?",
          a: "100% cotton yarn, hand-crocheted. Spot clean and air dry to keep it looking its best.",
        },
        { q: "What's your return/exchange policy?", a: returnAnswer(returnPolicies) },
      ],
    },
  ];

  return (
    <section className="fq">
      {/* One real material photograph rather than decoration: the page was a
          small title over five rules on white, with the footer taking nearly
          half of it. */}
      <div className="fq-side">
        <p className="eyebrow">FAQ</p>
        <h1 className="fq-title">
          Good
          <br />
          to know.
        </h1>
        <figure className="fq-crop">
          {/* LCP on /faq at every width measured. */}
          <Image src="/media/macro-twotone.webp" alt="Close detail of silver and gold metallic ribbon yarn"
                 width={1465} height={932} sizes="(max-width: 860px) 92vw, 34vw" preload />
        </figure>
        <p className="fq-note">Hand crocheted to order in Amman.</p>
      </div>

      <div className="fq-body">
        {GROUPS.map((g) => (
          <section className="fq-group" key={g.label}>
            <h2 className="fq-group-label">{g.label}</h2>
            <div className="faq-list">
              {g.items.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
