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

function serviceSet(industry: string, arabic: boolean): string[] {
  const value = industry.toLowerCase();
  if (/restaurant|food|cafe|coffee|bakery|مطعم|مقهى/.test(value)) return arabic ? ["عرض المنيو", "الطلبات والحجوزات", "الموقع وساعات العمل", "تواصل سريع"] : ["Menu showcase", "Orders and reservations", "Location and hours", "Fast customer contact"];
  if (/dent|clinic|medical|physio|عيادة|طب|علاج/.test(value)) return arabic ? ["عرض الخدمات", "حجز المواعيد", "استفسارات المرضى", "تذكير ومتابعة"] : ["Service overview", "Appointment booking", "Patient enquiries", "Reminders and follow ups"];
  if (/salon|barber|beauty|spa|صالون|حلاق|تجميل/.test(value)) return arabic ? ["عرض الخدمات", "الحجز أونلاين", "واتساب مباشر", "متابعة العملاء"] : ["Service showcase", "Online booking", "Direct WhatsApp", "Customer follow up"];
  if (/law|legal|محامي/.test(value)) return arabic ? ["مجالات الخبرة", "طلب استشارة", "استقبال الحالات", "متابعة العملاء"] : ["Areas of expertise", "Consultation requests", "Client intake", "Client follow up"];
  return arabic ? ["عرض الخدمات", "طلبات العملاء", "واتساب مباشر", "إدارة ومتابعة"] : ["Service showcase", "Customer enquiries", "Direct WhatsApp", "Customer management"];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const company = await getDemoCompany((await params).slug);
  return company ? { title: `${company.name} website concept`, description: `A website concept prepared for ${company.name} by LYNQ.` } : { title: "Website concept by LYNQ" };
}

export default async function DemoPage({ params }: { params: Promise<{ slug: string }> }) {
  const company = await getDemoCompany((await params).slug);
  if (!company) notFound();

  const address = company.address && typeof company.address === "object" && !Array.isArray(company.address) ? company.address as Record<string, unknown> : null;
  const countryCode = textField(address, "countryCode");
  const arabic = countryCode === "JO";
  const category = textField(address, "category") || company.industry || (arabic ? "نشاط محلي" : "Local business");
  const description = textField(address, "description");
  const formattedAddress = textField(address, "formatted");
  const photo = safeImageUrl(address);
  const rating = numberField(address, "rating");
  const reviews = numberField(address, "reviews");
  const services = serviceSet(`${company.industry ?? ""} ${category}`, arabic);
  const phoneDigits = company.phone?.replace(/\D/g, "") ?? "";
  const price = arabic ? "25 دينار بالشهر" : "$100 CAD per month";

  return (
    <main dir={arabic ? "rtl" : "ltr"} className="min-h-screen bg-[#f4f1ea] text-[#17211d]">
      <div className="bg-[#17211d] px-5 py-3 text-center text-xs uppercase tracking-[0.18em] text-[#d8c69c]">
        {arabic ? "نموذج موقع تجريبي من LYNQ" : "Website concept prepared by LYNQ"}
      </div>

      <section className="relative isolate flex min-h-[72vh] items-end overflow-hidden px-6 py-14 md:px-14 md:py-20">
        {photo ? <div className="absolute inset-0 -z-20 bg-cover bg-center" style={{ backgroundImage: `url(${photo})` }} /> : null}
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(11,25,20,.94),rgba(11,25,20,.52),rgba(11,25,20,.2))]" />
        <div className="max-w-4xl text-white">
          <p className="mb-5 text-sm uppercase tracking-[0.22em] text-[#e2cf9f]">{category}</p>
          <h1 className="max-w-3xl font-serif text-5xl leading-[.95] md:text-8xl">{company.name}</h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-white/80">
            {description || (arabic ? "واجهة رقمية بسيطة وواضحة تساعد الزبائن يعرفوا خدماتكم ويتواصلوا معكم بسرعة." : "A clear, modern online presence that helps customers understand your services and reach you quickly.")}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {phoneDigits ? <a href={`https://wa.me/${phoneDigits}`} className="rounded-full bg-[#e2cf9f] px-6 py-3 text-sm font-semibold text-[#17211d]">{arabic ? "تواصل معنا" : "Contact us"}</a> : null}
            {formattedAddress ? <span className="rounded-full border border-white/30 px-6 py-3 text-sm text-white/85">{formattedAddress}</span> : null}
          </div>
        </div>
      </section>

      <section className="px-6 py-20 md:px-14">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-[#8b6f3d]">{arabic ? "ماذا يمكن أن يقدم الموقع" : "What the website can do"}</p>
              <h2 className="mt-4 max-w-2xl font-serif text-4xl md:text-6xl">{arabic ? "تجربة أسهل للزبائن وشغل أرتب لكم" : "A better customer experience and a simpler way to grow"}</h2>
            </div>
            {rating ? <p className="text-lg text-[#4e5b55]">{rating.toFixed(1)} ★ {reviews ? `(${reviews.toLocaleString()} ${arabic ? "تقييم" : "reviews"})` : ""}</p> : null}
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {services.map((service, index) => <article key={service} className="min-h-48 rounded-3xl border border-[#d6d0c3] bg-white p-7"><span className="text-sm text-[#9a7b42]">0{index + 1}</span><h3 className="mt-12 text-xl font-medium">{service}</h3></article>)}
          </div>
        </div>
      </section>

      <section className="bg-[#17211d] px-6 py-20 text-white md:px-14">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-8 md:flex-row md:items-center">
          <div><p className="text-sm uppercase tracking-[0.2em] text-[#d8c69c]">LYNQ</p><h2 className="mt-3 font-serif text-4xl md:text-6xl">{arabic ? "جاهزين نكملها معكم" : "Ready to make it yours"}</h2><p className="mt-4 max-w-xl text-white/65">{arabic ? "نخصص التصميم والمحتوى ونضيف الحجز والواتساب وإدارة العملاء حسب احتياجكم." : "We will tailor the design and content, then add booking, WhatsApp and customer management around your workflow."}</p></div>
          <div className="rounded-3xl border border-white/15 p-7 text-center"><p className="text-sm text-white/55">{arabic ? "الباقة" : "Launch package"}</p><p className="mt-2 text-2xl font-semibold text-[#e2cf9f]">{price}</p></div>
        </div>
      </section>

      <footer className="bg-[#0d1612] px-6 py-6 text-center text-xs text-white/45">{arabic ? "هذا نموذج تجريبي أعدته LYNQ وليس الموقع الرسمي للنشاط." : "This is a concept prepared by LYNQ and is not the business's official website."}</footer>
    </main>
  );
}
