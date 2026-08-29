import type { LeadGenMarket } from "@/lib/lead-gen/markets";
import type { BuiltOutreach } from "@/lib/lead-gen/outreach";
import type { DemoEligibility } from "@/lib/lead-gen/demo-quality";

/**
 * Lead-row contact actions.
 *
 * Every string a prospect would read comes from `lib/lead-gen/outreach.ts`
 * via `resolveCompanyOutreachContext` — this component composes no copy and
 * knows no prices. It previously held both, in two languages, which is how
 * the Jordanian message ended up in Arabic and the Canadian price ended up
 * as the fallback for any lead with an unknown country.
 *
 * The WhatsApp and Email buttons here are MANUAL, one-at-a-time actions for
 * a human: they open the operator's own WhatsApp or mail client with the
 * text prefilled. LYNQ records nothing about them and cannot know whether
 * anything was actually sent — which is exactly why they are labelled
 * "manual" and why real, tracked campaigns go through an approved bulk
 * batch on the WhatsApp Cloud API instead.
 */

function whatsappUrl(phone: string, bodyText: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(bodyText)}`;
}

function emailUrl(email: string, subject: string, bodyText: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
}

const actionClass = "lynq-transition inline-flex min-h-9 items-center justify-center rounded-sm border border-border-strong px-3 text-[0.68rem] font-medium uppercase tracking-[0.07em] text-foreground hover:bg-white/5";
const disabledClass = "inline-flex min-h-9 cursor-not-allowed items-center justify-center rounded-sm border border-border px-3 text-[0.68rem] font-medium uppercase tracking-[0.07em] text-subtle opacity-60";

export function ContactActions({
  email,
  phone,
  businessName,
  market,
  demoUrl,
  outreach,
  eligibility,
}: {
  email?: string | null;
  phone?: string | null;
  businessName: string;
  market: LeadGenMarket | null;
  demoUrl: string | null;
  outreach: Pick<BuiltOutreach, "bodyText" | "emailSubject"> | null;
  eligibility: DemoEligibility;
}) {
  // No approved demo means no outreach text — a link to an unreviewed page
  // is precisely what the quality gate exists to stop, and disabling the
  // button is more honest than prefilling a message a human then has to
  // remember not to send.
  const canReachOut = Boolean(outreach) && eligibility.eligible;
  const blockedReason = !market
    ? "Market unknown — no price can be selected for this lead"
    : !demoUrl
      ? "No demo has been generated for this business yet"
      : !eligibility.eligible
        ? eligibility.detail
        : null;

  return (
    <div className="flex flex-col gap-1.5" aria-label={`Contact ${businessName}`}>
      <div className="flex flex-wrap gap-2">
        {email && canReachOut && outreach ? (
          <a className={actionClass} href={emailUrl(email, outreach.emailSubject, outreach.bodyText)} aria-label={`Email ${businessName}`}>
            Email
          </a>
        ) : (
          <span className={disabledClass} aria-disabled="true" title={email ? (blockedReason ?? "Unavailable") : "No published email address"}>
            Email
          </span>
        )}

        {phone && canReachOut && outreach ? (
          <a
            className={actionClass}
            href={whatsappUrl(phone, outreach.bodyText)}
            target="_blank"
            rel="noopener noreferrer"
            title="Opens your own WhatsApp with the message prefilled. LYNQ does not record or track this send."
            aria-label={`Open WhatsApp manually for ${businessName}`}
          >
            WhatsApp · manual{market ? ` · ${market.code}` : ""}
          </a>
        ) : (
          <span className={disabledClass} aria-disabled="true" title={phone ? (blockedReason ?? "Unavailable") : "No phone number"}>
            WhatsApp
          </span>
        )}

        {demoUrl ? (
          <a className={actionClass} href={demoUrl} target="_blank" rel="noopener noreferrer" aria-label={`View demo for ${businessName}`}>
            Demo
          </a>
        ) : null}
      </div>

      {market ? (
        <span className="text-[0.65rem] text-subtle">
          {market.countryName} · {market.priceDisplay}/month · send from {market.senderPhoneDisplay}
        </span>
      ) : (
        <span className="text-[0.65rem] text-subtle">No market resolved — set the company&apos;s country before contacting</span>
      )}

      {blockedReason && (email || phone) ? <span className="text-[0.65rem] text-subtle">Outreach blocked: {blockedReason}</span> : null}
    </div>
  );
}
