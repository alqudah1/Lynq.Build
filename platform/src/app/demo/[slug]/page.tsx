import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { createDbClient } from "@/db/client";
import { crmCompanies } from "@/db/schema";
import { loadEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const getDemoCompany = cache(async (slug: string) => {
  if (!/^[a-f0-9]{40}$/.test(slug)) return null;
  const db = createDbClient(loadEnv());
  const [company] = await db
    .select({ name: crmCompanies.name, industry: crmCompanies.industry, phone: crmCompanies.phone, address: crmCompanies.address })
    .from(crmCompanies)
    .where(and(eq(crmCompanies.idempotencyKey, `lynq-prospect-company:${slug}`), eq(crmCompanies.status, "active")))
    .limit(1);
  return company ?? null;
});

function textField(address: Record<string, unknown> | null, key: string): string {
  const value = address?.[key];
  return typeof value === "string" ? value : "";
}

function numberField(address: Record<string, unknown> | null, key: string): number | null {
  const value = address?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeImageUrl(address: Record<string, unknown> | null): string | null {
  const value = textField(address, "photo");
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function hoursField(address: Record<string, unknown> | null): Array<{ day: string; hours: string }> {
  const value = address?.hours;
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([day, raw]) => {
    const entries = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
    return entries.length ? [{ day, hours: entries.join(" · ") }] : [];
  });
}

type Experience = { index: string; title: string; description: string };

function experienceSet(industry: string, arabic: boolean): Experience[] {
  const value = industry.toLowerCase();
  if (/restaurant|food|cafe|coffee|bakery|مطعم|مقهى/.test(value)) {
    return arabic ? [
      { index: "01", title: "المنيو والتجربة", description: "عرض واضح للأطباق والتجربة التي تميز المكان." },
      { index: "02", title: "الحجز والطلبات", description: "طريق أقصر من الاكتشاف إلى الحجز أو الطلب." },
      { index: "03", title: "الموقع وساعات العمل", description: "كل ما يحتاجه الضيف قبل الزيارة في مكان واحد." },
    ] : [
      { index: "01", title: "Menu & experience", description: "A considered showcase of the dishes and atmosphere that make the business memorable." },
      { index: "02", title: "Reservations & orders", description: "A shorter path from discovery to booking, ordering or getting in touch." },
      { index: "03", title: "Visit information", description: "Location, hours and the details guests need before they arrive." },
    ];
  }
  if (/salon|barber|beauty|spa|صالون|حلاق|تجميل/.test(value)) {
    return arabic ? [
      { index: "01", title: "الخدمات", description: "تقديم راقٍ وواضح للخدمات والتخصصات." },
      { index: "02", title: "الحجز", description: "تجربة حجز مباشرة وسهلة من الهاتف." },
      { index: "03", title: "الزيارة والتواصل", description: "الموقع والساعات وواتساب في مكان واحد." },
    ] : [
      { index: "01", title: "Services", description: "A refined, easy-to-understand presentation of services and specialties." },
      { index: "02", title: "Booking", description: "A direct mobile-first appointment experience." },
      { index: "03", title: "Visit & contact", description: "Location, hours and WhatsApp in one place." },
    ];
  }
  return arabic ? [
    { index: "01", title: "الخدمات", description: "عرض واضح لما يقدمه النشاط ولماذا يختاره العملاء." },
    { index: "02", title: "طلبات العملاء", description: "طريقة مباشرة لاستقبال الاستفسارات والطلبات." },
    { index: "03", title: "الزيارة والتواصل", description: "الموقع والساعات والتواصل في مكان واحد." },
  ] : [
    { index: "01", title: "Services", description: "A clear presentation of what the business offers and why customers choose it." },
    { index: "02", title: "Customer enquiries", description: "A direct way to capture questions, requests and new opportunities." },
    { index: "03", title: "Visit & contact", description: "Location, hours and contact details in one place." },
  ];
}

function editorialCopy(industry: string, arabic: boolean) {
  const value = industry.toLowerCase();
  if (/restaurant|food|cafe|coffee|bakery|مطعم|مقهى/.test(value)) {
    return arabic ? {
      eyebrow: "عن المكان",
      intro: "المذاق يجذب الضيف أول مرة، أما التجربة المتكاملة فهي التي تجعله يعود.",
      headline: "مكان له سمعته. وتجربة رقمية تجعل اكتشافه وحجزه أسهل من أول زيارة.",
      imageLine: "تبدأ التجربة قبل الوصول: صورة تشهي، تفاصيل واضحة، وطريق مباشر للحجز أو الطلب.",
      experienceLabel: "تجربة الضيف",
      experienceTitle: "من الاكتشاف إلى الطاولة، بلا تعقيد.",
      closing: "طاولتكم التالية تبدأ من هنا.",
    } : {
      eyebrow: "The place",
      intro: "The food earns the first visit. A complete guest experience earns the next one.",
      headline: "A place with a reputation, made easier to discover, choose and visit.",
      imageLine: "The experience starts before arrival: appetite, clarity and a direct path to the table.",
      experienceLabel: "Guest experience",
      experienceTitle: "From discovery to the table, without the friction.",
      closing: "Your next table starts here.",
    };
  }
  if (/salon|barber|beauty|spa|صالون|حلاق|تجميل/.test(value)) {
    return arabic ? {
      eyebrow: "عن المكان",
      intro: "الانطباع الأول مهم، والحضور الرقمي يجب أن يعكس نفس العناية الموجودة في كل خدمة.",
      headline: "خبرة يثق بها العملاء، بهوية رقمية تجعل اختيار الخدمة والحجز أسهل.",
      imageLine: "من أول نظرة إلى موعد مؤكد، تجربة واضحة تليق باسم المكان.",
      experienceLabel: "تجربة العميل",
      experienceTitle: "الخدمة المناسبة والموعد المناسب، بخطوات أقل.",
      closing: "موعدك القادم يبدأ من هنا.",
    } : {
      eyebrow: "The studio",
      intro: "First impressions matter. The digital experience should reflect the same care as every appointment.",
      headline: "Trusted expertise, presented with an identity that makes choosing and booking effortless.",
      imageLine: "From first look to confirmed appointment, a clear experience worthy of the name.",
      experienceLabel: "Client experience",
      experienceTitle: "The right service and the right time, in fewer steps.",
      closing: "Your next appointment starts here.",
    };
  }
  return arabic ? {
    eyebrow: "عن المكان",
    intro: "الحضور الرقمي الأقوى لا يغيّر هوية النشاط، بل يجعل قيمته أوضح وأسهل للوصول.",
    headline: "سمعة قوية، مترجمة إلى تجربة رقمية يثق بها العميل من أول زيارة.",
    imageLine: "من الصورة الأولى إلى آخر تفصيل، كل شيء يحكي قصة المكان نفسه.",
    experienceLabel: "تجربة العميل",
    experienceTitle: "كل ما يحتاجه العميل، بلا تعقيد.",
    closing: "خطوتك التالية تبدأ من هنا.",
  } : {
    eyebrow: "About",
    intro: "A stronger digital presence does not change the business. It makes its value clearer and easier to reach.",
    headline: "A strong reputation, translated into a digital experience customers trust from the first visit.",
    imageLine: "From the first image to the last detail, every element tells the story of the business itself.",
    experienceLabel: "Customer experience",
    experienceTitle: "Everything a customer needs, without the friction.",
    closing: "Your next step starts here.",
  };
}

function businessInitials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const company = await getDemoCompany((await params).slug);
  return company ? { title: company.name, description: `A digital experience concept prepared for ${company.name}.` } : { title: "Digital experience concept" };
}

export default async function DemoPage({ params }: { params: Promise<{ slug: string }> }) {
  const company = await getDemoCompany((await params).slug);
  if (!company) notFound();

  const address = company.address && typeof company.address === "object" && !Array.isArray(company.address) ? company.address as Record<string, unknown> : null;
  const countryCode = textField(address, "countryCode");
  const arabic = countryCode === "JO";
  const category = textField(address, "category") || company.industry || (arabic ? "وجهة محلية" : "Local destination");
  const description = textField(address, "description");
  const formattedAddress = textField(address, "formatted");
  const city = textField(address, "city");
  const photo = safeImageUrl(address);
  const rating = numberField(address, "rating");
  const reviews = numberField(address, "reviews");
  const hours = hoursField(address);
  const experiences = experienceSet(`${company.industry ?? ""} ${category}`, arabic);
  const copy = editorialCopy(`${company.industry ?? ""} ${category}`, arabic);
  const phoneDigits = company.phone?.replace(/\D/g, "") ?? "";
  const initials = businessInitials(company.name);
  const mapUrl = formattedAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formattedAddress)}` : null;
  const placeLabel = formattedAddress || city || (arabic ? "الأردن" : "Canada");

  return (
    <main dir={arabic ? "rtl" : "ltr"} className="min-h-screen overflow-hidden bg-[#0a0a09] text-[#f5f2ea] selection:bg-[#d8c4a0] selection:text-[#11110f]">
      <section className="relative isolate min-h-[92svh] overflow-hidden border-b border-white/10">
        {photo ? <div className="absolute inset-0 -z-30 scale-[1.02] bg-cover bg-center" style={{ backgroundImage: `url(${photo})` }} /> : <div className="absolute inset-0 -z-30 bg-[#28271f]" />}
        <div className="absolute inset-0 -z-20 bg-[linear-gradient(180deg,rgba(8,8,7,.34)_0%,rgba(8,8,7,.18)_28%,rgba(8,8,7,.78)_78%,rgba(8,8,7,.96)_100%)]" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(7,7,6,.65)_0%,transparent_55%)] rtl:bg-[linear-gradient(270deg,rgba(7,7,6,.65)_0%,transparent_55%)]" />

        <nav className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-5 md:px-10 md:py-7">
          <a href="#top" className="flex items-center gap-3" aria-label={company.name}>
            <span className="grid size-11 place-items-center border border-white/35 bg-black/20 text-xs font-semibold tracking-[0.18em] backdrop-blur-md">{initials}</span>
            <span className="max-w-48 text-sm font-medium leading-tight tracking-[-0.01em] md:max-w-none md:text-base">{company.name}</span>
          </a>
          <div className="hidden items-center gap-8 text-xs uppercase tracking-[0.18em] text-white/65 md:flex">
            <a href="#story" className="transition hover:text-white">{arabic ? "قصتنا" : "Story"}</a>
            <a href="#experience" className="transition hover:text-white">{arabic ? "التجربة" : "Experience"}</a>
            <a href="#visit" className="transition hover:text-white">{arabic ? "الزيارة" : "Visit"}</a>
          </div>
          {phoneDigits ? <a href={`https://wa.me/${phoneDigits}`} className="border border-white/30 bg-white/10 px-4 py-3 text-xs font-semibold backdrop-blur-md transition hover:bg-white hover:text-black md:px-6">{arabic ? "احجز أو تواصل" : "Book or contact"}</a> : null}
        </nav>

        <div id="top" className="mx-auto flex min-h-[calc(92svh-100px)] max-w-[1500px] flex-col justify-end px-5 pb-10 md:px-10 md:pb-16">
          <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <p className="mb-5 flex items-center gap-3 text-[0.68rem] font-medium uppercase tracking-[0.28em] text-[#e0cfad]"><span className="h-px w-9 bg-current" />{category}</p>
              <h1 className="max-w-5xl text-[clamp(3.4rem,9vw,8.8rem)] font-medium leading-[0.82] tracking-[-0.075em] text-white">{company.name}</h1>
              <p className="mt-8 max-w-2xl text-base leading-7 text-white/72 md:text-xl md:leading-8">{description || (arabic ? "تجربة محلية لها حضورها الخاص. مكان يعرفه ضيوفه، وهوية رقمية تليق باسمه وسمعته." : "A local experience with a character of its own, translated into a digital presence worthy of its reputation.")}</p>
            </div>
            <div className="border-t border-white/30 pt-5 text-sm text-white/70 lg:border-s lg:border-t-0 lg:ps-7 lg:pt-0">
              <p className="text-[0.65rem] uppercase tracking-[0.22em] text-white/45">{arabic ? "اكتشف المكان" : "Discover the place"}</p>
              <p className="mt-3 text-base text-white">{placeLabel}</p>
              {rating ? <p className="mt-5 text-[#e0cfad]"><span className="text-2xl font-medium text-white">{rating.toFixed(1)}</span> / 5&nbsp;&nbsp;★ {reviews ? `${reviews.toLocaleString()} ${arabic ? "تقييم" : "reviews"}` : ""}</p> : null}
            </div>
          </div>
        </div>
      </section>

      <section id="story" className="mx-auto grid max-w-[1500px] gap-12 px-5 py-24 md:px-10 md:py-36 lg:grid-cols-[0.75fr_1.25fr] lg:gap-24">
        <div>
          <p className="text-[0.68rem] uppercase tracking-[0.26em] text-[#b9a47f]">{copy.eyebrow}</p>
          <p className="mt-5 max-w-sm text-sm leading-7 text-white/48">{copy.intro}</p>
        </div>
        <div>
          <h2 className="max-w-4xl text-4xl font-medium leading-[1.02] tracking-[-0.045em] md:text-7xl">{copy.headline}</h2>
          <div className="mt-12 grid gap-px bg-white/10 sm:grid-cols-3">
            <div className="bg-[#0a0a09] py-6 pe-6"><p className="text-3xl font-medium">{rating ? rating.toFixed(1) : "—"}</p><p className="mt-2 text-xs uppercase tracking-[0.16em] text-white/42">{arabic ? "التقييم" : "Rating"}</p></div>
            <div className="bg-[#0a0a09] px-0 py-6 sm:px-6"><p className="text-3xl font-medium">{reviews ? reviews.toLocaleString() : "—"}</p><p className="mt-2 text-xs uppercase tracking-[0.16em] text-white/42">{arabic ? "آراء الضيوف" : "Guest reviews"}</p></div>
            <div className="bg-[#0a0a09] py-6 sm:ps-6"><p className="text-3xl font-medium">{arabic ? "مباشر" : "Direct"}</p><p className="mt-2 text-xs uppercase tracking-[0.16em] text-white/42">{arabic ? "الحجز والتواصل" : "Booking & contact"}</p></div>
          </div>
        </div>
      </section>

      <section className="mx-3 overflow-hidden md:mx-6">
        <div className="relative min-h-[68svh] bg-[#24231e]">
          {photo ? <div className="absolute inset-0 bg-cover bg-[center_68%] md:bg-fixed" style={{ backgroundImage: `url(${photo})` }} /> : null}
          <div className="absolute inset-0 bg-black/28" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
          <p className="absolute bottom-7 start-7 max-w-xl text-xl font-medium leading-tight text-white md:bottom-12 md:start-12 md:text-4xl">{copy.imageLine}</p>
        </div>
      </section>

      <section id="experience" className="mx-auto max-w-[1500px] px-5 py-24 md:px-10 md:py-36">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-24">
          <div><p className="text-[0.68rem] uppercase tracking-[0.26em] text-[#b9a47f]">{copy.experienceLabel}</p><h2 className="mt-5 max-w-xl text-5xl font-medium leading-[0.94] tracking-[-0.05em] md:text-7xl">{copy.experienceTitle}</h2></div>
          <div className="divide-y divide-white/12 border-t border-white/12">
            {experiences.map((experience) => <article key={experience.index} className="grid gap-5 py-8 md:grid-cols-[60px_1fr] md:py-10"><span className="text-xs text-[#b9a47f]">{experience.index}</span><div><h3 className="text-2xl font-medium md:text-3xl">{experience.title}</h3><p className="mt-3 max-w-xl text-sm leading-7 text-white/48 md:text-base">{experience.description}</p></div></article>)}
          </div>
        </div>
      </section>

      <section id="visit" className="border-y border-white/10 bg-[#f0ede5] text-[#141411]">
        <div className="mx-auto grid max-w-[1500px] lg:grid-cols-2">
          <div className="px-5 py-20 md:px-10 md:py-28 lg:border-e lg:border-black/10">
            <p className="text-[0.68rem] uppercase tracking-[0.26em] text-black/48">{arabic ? "خطط لزيارتك" : "Plan your visit"}</p><h2 className="mt-5 text-5xl font-medium tracking-[-0.05em] md:text-7xl">{arabic ? "أهلاً وسهلاً" : "Come say hello"}</h2><p className="mt-8 max-w-lg text-base leading-7 text-black/62">{placeLabel}</p>
            <div className="mt-10 flex flex-wrap gap-3">{mapUrl ? <a href={mapUrl} target="_blank" rel="noreferrer" className="bg-[#141411] px-6 py-4 text-xs font-semibold uppercase tracking-[0.12em] text-white">{arabic ? "افتح الخريطة" : "Open map"}</a> : null}{phoneDigits ? <a href={`https://wa.me/${phoneDigits}`} className="border border-black/25 px-6 py-4 text-xs font-semibold uppercase tracking-[0.12em]">{arabic ? "تواصل عبر واتساب" : "Contact on WhatsApp"}</a> : null}</div>
          </div>
          <div className="px-5 py-20 md:px-10 md:py-28">
            <p className="text-[0.68rem] uppercase tracking-[0.26em] text-black/48">{arabic ? "ساعات العمل" : "Opening hours"}</p>
            <div className="mt-7 divide-y divide-black/12 border-y border-black/12">{(hours.length ? hours : [{ day: arabic ? "يومياً" : "Daily", hours: arabic ? "تواصل معنا لمعرفة ساعات العمل" : "Contact us for opening hours" }]).map((item) => <div key={item.day} className="flex items-center justify-between gap-6 py-4 text-sm"><span className="font-medium">{item.day}</span><span className="text-black/58">{item.hours}</span></div>)}</div>
          </div>
        </div>
      </section>

      <section className="px-5 py-24 text-center md:px-10 md:py-36">
        <p className="text-[0.68rem] uppercase tracking-[0.26em] text-[#b9a47f]">{company.name}</p><h2 className="mx-auto mt-5 max-w-4xl text-5xl font-medium leading-[0.9] tracking-[-0.06em] md:text-8xl">{copy.closing}</h2>{phoneDigits ? <a href={`https://wa.me/${phoneDigits}`} className="mt-10 inline-flex min-h-14 items-center border border-white/28 px-8 text-xs font-semibold uppercase tracking-[0.14em] transition hover:bg-white hover:text-black">{arabic ? "احجز أو تواصل" : "Book or contact"}</a> : null}
      </section>

      <footer className="border-t border-white/10 px-5 py-6 md:px-10"><div className="mx-auto flex max-w-[1500px] flex-col gap-3 text-[0.64rem] uppercase tracking-[0.16em] text-white/32 md:flex-row md:items-center md:justify-between"><p>{company.name}</p><p>{city || category}</p></div></footer>
    </main>
  );
}
