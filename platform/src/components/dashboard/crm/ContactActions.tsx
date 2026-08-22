function outreachText(countryCode: string | null | undefined, businessName: string, demoUrl?: string | null): string {
  if (countryCode === "JO") {
    const demoLine = demoUrl ? `\n\nهذا التصور اللي عملته لكم:\n${demoUrl}` : "";
    return `مرحبا، معك مصطفى من LYNQ. لفتني ${businessName}، خصوصاً تقييمكم القوي، فحبيت أوريكم كيف ممكن يكون حضوركم أونلاين بشكل يليق بشغلكم.${demoLine}\n\nهذا مش الموقع النهائي ولا قالب جاهز. هو مجرد بداية حتى تشوفوا الاتجاه. إذا حبيتوه، بنبني النسخة الكاملة حول هويتكم الحقيقية ونضيف المنيو أو الخدمات والحجز والطلبات والواتساب وإدارة العملاء حسب شغلكم.\n\nحاب أعرف رأيكم بصراحة: نكمل بهذا الاتجاه، ولا بتفضلوا ستايل مختلف؟\n\nالاشتراك 25 دينار بالشهر. وإذا ما بتحبوا نتواصل معكم مرة ثانية اكتبوا توقف.`;
  }

  const demoLine = demoUrl ? `\n\nHere is the direction I created for you:\n${demoUrl}` : "";
  return `Hi, this is Mustafa from LYNQ. ${businessName} stood out to me, especially the strength of your reviews, so I wanted to show you what your online presence could look like when it truly matches the quality of the business.${demoLine}\n\nThis is not the finished website or an off-the-shelf template. It is simply a starting point so you can see the direction. If you like it, we would build the full version around your real brand and add the services or menu, booking, orders, WhatsApp and customer follow-up your business needs.\n\nI would genuinely value your reaction: should we keep developing this direction, or would a different style fit you better?\n\nIt is $100 CAD per month. If you would rather not hear from us again, reply STOP.`;
}

function whatsappUrl(phone: string, businessName: string, countryCode?: string | null, demoUrl?: string | null): string {
  const digits = phone.replace(/\D/g, "");
  const message = outreachText(countryCode, businessName, demoUrl);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function emailUrl(email: string, businessName: string, countryCode?: string | null, demoUrl?: string | null): string {
  const subject = countryCode === "JO" ? `فكرة جاهزة لـ ${businessName}` : `A website concept for ${businessName}`;
  const body = outreachText(countryCode, businessName, demoUrl);
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const actionClass = "lynq-transition inline-flex min-h-9 items-center justify-center rounded-sm border border-border-strong px-3 text-[0.68rem] font-medium uppercase tracking-[0.07em] text-foreground hover:bg-white/5";
const disabledClass = "inline-flex min-h-9 cursor-not-allowed items-center justify-center rounded-sm border border-border px-3 text-[0.68rem] font-medium uppercase tracking-[0.07em] text-subtle opacity-60";

const WHATSAPP_SENDER_BY_COUNTRY = {
  CA: { label: "Canada", phone: "+1 647-892-7346" },
  JO: { label: "Jordan", phone: "+962 79 694 0024" },
} as const;

export function ContactActions({ email, phone, businessName, countryCode, demoSlug }: { email?: string | null; phone?: string | null; businessName: string; countryCode?: string | null; demoSlug?: string | null }) {
  const sender = countryCode === "CA" || countryCode === "JO" ? WHATSAPP_SENDER_BY_COUNTRY[countryCode] : null;
  const demoUrl = demoSlug ? `https://app.lynq.build/demo/${demoSlug}` : null;

  return (
    <div className="flex flex-col gap-1.5" aria-label={`Contact ${businessName}`}>
      <div className="flex flex-wrap gap-2">
        {email ? (
          <a className={actionClass} href={emailUrl(email, businessName, countryCode, demoUrl)} aria-label={`Email ${businessName}`}>Email</a>
        ) : (
          <span className={disabledClass} aria-disabled="true" title="No published email address">Email</span>
        )}
        {phone ? (
          <a className={actionClass} href={whatsappUrl(phone, businessName, countryCode, demoUrl)} target="_blank" rel="noopener noreferrer" aria-label={`Open WhatsApp for ${businessName}`}>WhatsApp{countryCode ? ` · ${countryCode}` : ""}</a>
        ) : (
          <span className={disabledClass} aria-disabled="true" title="No phone number">WhatsApp</span>
        )}
        {demoUrl ? <a className={actionClass} href={demoUrl} target="_blank" rel="noopener noreferrer" aria-label={`View demo for ${businessName}`}>Demo</a> : null}
      </div>
      {sender ? <span className="text-[0.65rem] text-subtle">Send from {sender.label}: {sender.phone}</span> : null}
    </div>
  );
}
