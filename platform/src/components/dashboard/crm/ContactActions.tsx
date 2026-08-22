function outreachText(countryCode: string | null | undefined, businessName: string, demoUrl?: string | null): string {
  if (countryCode === "JO") {
    const demoLine = demoUrl ? `\n\nعملنا لكم نموذج سريع حتى تشوفوا الفكرة بشكل واضح:\n${demoUrl}` : "";
    return `مرحبا، معك مصطفى من LYNQ. شفت ${businessName} وعجبني شغلكم وتقييمكم، وحبيت أشارككم فكرة تساعدكم تظهروا بشكل أقوى أونلاين.${demoLine}\n\nالنموذج يقدر يعرض خدماتكم وموقعكم ويسهّل تواصل الزبائن معكم. وإذا عجبكم الاتجاه، بنقدر نكمله ونضيف الحجز والواتساب وإدارة العملاء والمتابعة حسب احتياجكم. الاشتراك 25 دينار أردني بالشهر. إذا بتحبوا أشرح لكم أكثر أنا جاهز. وإذا ما بتحبوا نتواصل معكم مرة ثانية اكتبوا توقف.`;
  }

  const demoLine = demoUrl ? `\n\nI put together a quick concept so you can see the idea:\n${demoUrl}` : "";
  return `Hi, this is Mustafa from LYNQ. I came across ${businessName} and was impressed by your reviews. I wanted to share an idea that could strengthen how your business shows up online.${demoLine}\n\nThe concept can showcase your services and location and make it easier for customers to reach you. If you like the direction, we can finish it and add booking, WhatsApp, customer management and follow ups based on what you need. The price is $100 CAD per month. Happy to walk you through it. If you would rather not hear from us again, just reply STOP.`;
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
