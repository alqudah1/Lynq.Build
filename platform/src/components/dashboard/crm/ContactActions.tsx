function whatsappUrl(phone: string, businessName: string): string {
  const digits = phone.replace(/\D/g, "");
  const message = `Hi — this is Mustafa from LYNQ. You confirmed I could follow up about ${businessName}'s online presence. I have an idea to share. Reply STOP at any time to opt out.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function emailUrl(email: string, businessName: string): string {
  const subject = `Idea for ${businessName}`;
  const body = `Hi — this is Mustafa from LYNQ. You confirmed I could follow up about ${businessName}'s online presence. I have an idea to share. Reply unsubscribe at any time to opt out.`;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const actionClass = "lynq-transition inline-flex min-h-9 items-center justify-center rounded-sm border border-border-strong px-3 text-[0.68rem] font-medium uppercase tracking-[0.07em] text-foreground hover:bg-white/5";
const disabledClass = "inline-flex min-h-9 cursor-not-allowed items-center justify-center rounded-sm border border-border px-3 text-[0.68rem] font-medium uppercase tracking-[0.07em] text-subtle opacity-60";

export function ContactActions({ email, phone, businessName }: { email?: string | null; phone?: string | null; businessName: string }) {
  return (
    <div className="flex flex-wrap gap-2" aria-label={`Contact ${businessName}`}>
      {email ? (
        <a className={actionClass} href={emailUrl(email, businessName)} aria-label={`Email ${businessName}`}>Email</a>
      ) : (
        <span className={disabledClass} aria-disabled="true" title="No published email address">Email</span>
      )}
      {phone ? (
        <a className={actionClass} href={whatsappUrl(phone, businessName)} target="_blank" rel="noopener noreferrer" aria-label={`Open WhatsApp for ${businessName}`}>WhatsApp</a>
      ) : (
        <span className={disabledClass} aria-disabled="true" title="No phone number">WhatsApp</span>
      )}
    </div>
  );
}
