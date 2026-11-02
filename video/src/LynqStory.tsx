import React from "react";
import { BK, Bakery, Calls, LI, LN, Lang, MapCard, MU, NewSite, OldSite, Orders, Phone, Reviews, Sami, Say, Sfx, StoryFrame, Street, Tag, Kw, Walkers, WH, fontFor, ramp, useSpringAt, useT } from "./lynq-story-kit";

/*
 * "The shop nobody could find": five cold-open episodes about Sami, a made-up bakery owner.
 * Each opens on its most dramatic moment, ends on the next problem, and leads back into frame 0.
 * Every line lives in TX so the Arabic cut uses the same pictures.
 */

const COMMON = {
  en: {
    series: "THE SHOP NOBODY COULD FIND", madeUp: "A MADE-UP SHOP · REAL FIXES", search: "sami's bakery", shop: "Sami's Bakery",
    openNow: "Open · until 8 PM", closedNow: "Closed", directions: "Directions", call: "Call", website: "Website",
    oldTitle: "WELCOME TO SAMI'S BAKERY!!!", oldBody: "Site under construction. Please call us for the menu.", loading: "Loading",
    newTag: "Fresh bread from 7 AM. Order ahead, skip the line.", order: "Order ahead", hoursLabel: "HOURS", hours: "Every day · 7 AM to 8 PM", menuLabel: "MENU", menu: "Croissants|Sourdough loaf|Za'atar manakish|Cinnamon rolls",
    reviewsCount: "27 reviews", reviewer: "Dana K.", badReview: "Waited 20 minutes. Nobody even looked up.", noReply: "8 months ago · No reply", ownerLabel: "Reply from the owner", reply: "Sorry Dana, that's on us. Come back, your coffee is on me.",
    incoming: "Incoming call", unknown: "+1 416 ···", missed: "Missed calls", newOrder: "NEW ORDER", orders: "6 croissants · pick up 8:15|2 sourdough loaves · 9:00|4 za'atar manakish · 12:30|Birthday cake · Saturday",
    qr: "Loved it? Leave a review", customers: "Customers today", aiVoice: "AI voice",
  },
  ar: {
    series: "المحل اللي ما حدا لاقاه", madeUp: "محل خيالي · حلول حقيقية", search: "مخبز سامي", shop: "مخبز سامي",
    openNow: "مفتوح · لغاية ٨ المسا", closedNow: "مسكّر", directions: "الاتجاهات", call: "اتصال", website: "الموقع",
    oldTitle: "أهلاً وسهلاً في مخبز سامي!!!", oldBody: "الموقع قيد الإنشاء. اتصلوا فينا لتعرفوا القائمة.", loading: "جاري التحميل",
    newTag: "خبز طازة من الساعة ٧ الصبح. اطلب مسبقاً وما تستنى.", order: "اطلب مسبقاً", hoursLabel: "الدوام", hours: "كل يوم · من ٧ الصبح لـ ٨ المسا", menuLabel: "القائمة", menu: "كرواسون|خبز ساوردو|مناقيش زعتر|سينابون",
    reviewsCount: "٢٧ تقييم", reviewer: "دانا ك.", badReview: "استنيت ٢٠ دقيقة وما حدا حتى اطّلع عليّ.", noReply: "قبل ٨ شهور · بدون رد", ownerLabel: "رد صاحب المحل", reply: "آسفين يا دانا، الحق علينا. ارجعي زورينا، القهوة على حسابي.",
    incoming: "مكالمة واردة", unknown: "+962 7 ···", missed: "مكالمات فائتة", newOrder: "طلب جديد", orders: "٦ كرواسون · استلام ٨:١٥|٢ خبز ساوردو · ٩:٠٠|٤ مناقيش زعتر · ١٢:٣٠|كيكة عيد ميلاد · السبت",
    qr: "عجبك؟ اترك تقييم", customers: "زباين اليوم", aiVoice: "الصوت مولّد بالذكاء الاصطناعي",
  },
};

const LINES = {
  en: {
    e1a: "He's open. Google says closed.", e1b: "So people walk right past.", e1c: "Wrong hours online. Zero customers.", e1d: "And that's only problem 1.", e1tag: "4 problems · 5 episodes",
    e2a: "Fix 1: the real hours.", e2b: "10 minutes. People walk in.", e2c: "Then they look up his website.", e2d: "Still loading. They're gone.", e2e: "Can a website lose a sale before it loads?", e2tag: "Episode 3: the rebuild",
    e3a: "Fix 2: a site that opens in a second.", e3b: "Hours. Menu. One button.", e3x: "And they come in.", e3c: "Then they read the reviews.", e3d: "3.1 stars. Would you go?", e3tag: "Episode 4: the reviews",
    e4a: "Fix 3: answer every review.", e4b: "Then ask the happy ones.", e4c: "Now everyone calls. At once.", e4d: "Every missed call is a lost order.", e4tag: "Final episode",
    e5a: "Fix 4: let them order without calling.", e5b: "The orders come in. Quietly.", e5list: "Real hours|Fast site|Answered reviews|Order button", e5d: "Sami is made up. The fixes are real.", e5e: "Want the free checklist?", e5cta: "Comment FIX", e5sub: "Or we do all four for you · lynq.build", kw: "Comment FIX · free checklist",
  },
  ar: {
    e1a: "المحل مفتوح. وجوجل بيقول مسكّر.", e1b: "فالناس بتمرق من قدامه.", e1c: "الدوام غلط على النت. ولا زبون.", e1d: "وهاي بس المشكلة الأولى.", e1tag: "٤ مشاكل · ٥ حلقات",
    e2a: "الحل ١: الدوام الصح.", e2b: "١٠ دقايق. والناس بتفوت.", e2c: "بعدين بيدوّروا على موقعه.", e2d: "لسا بيحمّل. راحوا.", e2e: "ممكن موقع يخسّرك بيعة قبل ما يفتح؟", e2tag: "الحلقة ٣: موقع جديد",
    e3a: "الحل ٢: موقع بيفتح بثانية.", e3b: "الدوام. القائمة. زر واحد.", e3x: "وبيفوتوا.", e3c: "بعدين بيقرأوا التقييمات.", e3d: "٣.١ نجوم. كنت رحت؟", e3tag: "الحلقة ٤: التقييمات",
    e4a: "الحل ٣: رد على كل تقييم.", e4b: "واطلب من الزباين المبسوطين.", e4c: "هلق الكل بيتصل. بنفس الوقت.", e4d: "كل مكالمة فائتة طلب ضايع.", e4tag: "الحلقة الأخيرة",
    e5a: "الحل ٤: خليهم يطلبوا بدون اتصال.", e5b: "الطلبات بتوصل. بهدوء.", e5list: "دوام صح|موقع سريع|ردود على التقييمات|زر الطلب", e5d: "سامي خيالي. الحلول حقيقية.", e5e: "بدك القائمة ببلاش؟", e5cta: "اكتب FIX", e5sub: "أو منعملهم عنك · lynq.build", kw: "اكتب FIX بالتعليقات · القائمة ببلاش",
  },
};

const ACCENT = { en: ["closed.", "past.", "Zero", "1.", "Fix", "1:", "2:", "3:", "4:", "gone.", "second.", "button.", "reviews.", "3.1", "every", "At", "once.", "lost", "Quietly.", "real.", "walk", "in."], ar: ["مسكّر.", "ولا", "زبون.", "الأولى.", "الحل", "راحوا.", "بثانية.", "واحد.", "التقييمات.", "كل", "ضايع.", "بهدوء.", "حقيقية.", "بتفوت."] };

type P = { lang?: Lang };
const T = (lang: Lang) => ({ tx: COMMON[lang], l: LINES[lang], ac: ACCENT[lang] });

/** Street scene shrunk into the top of the frame, used where the phone shares the shot. */
const SmallStreet: React.FC<{ sign: "open" | "closed"; pose?: "neutral" | "worried" | "happy" }> = ({ sign, pose }) => (
  <div style={{ position: "absolute", left: 0, top: 220, width: 1080, height: 1920, transform: "scale(0.62)", transformOrigin: "50% 0" }}><Street sign={sign} pose={pose} /></div>
);

export const LynqStory1: React.FC<P> = ({ lang = "en" }) => {
  const { s } = useT();
  const { tx, l, ac } = T(lang);
  return (
    <StoryFrame ep={1} seconds={15} lang={lang} tx={tx}>
      {s < 3.1 && <><SmallStreet sign="open" /><Phone at={-1} x={470} y={900} scale={0.62}><MapCard status="closed" lang={lang} tx={tx} /></Phone><Say text={l.e1a} at={-1} out={2.9} lang={lang} top={250} accent={ac} size={86} /></>}
      {s >= 3.1 && s < 6.6 && <><Street sign="open" /><Walkers from={3.2} n={4} /><Say text={l.e1b} at={3.2} out={6.4} lang={lang} top={250} accent={ac} /></>}
      {s >= 6.6 && s < 10.1 && <><Phone at={6.6} out={9.9}><MapCard status="closed" lang={lang} tx={tx} /></Phone><Say text={l.e1c} at={6.8} out={9.9} lang={lang} top={250} accent={ac} size={78} /></>}
      {s >= 10.1 && (
        <>
          <Bakery pose="worried" sign="open" top={170} />
          <Say text={l.e1d} at={10.2} lang={lang} top={250} accent={ac} size={88} />
          <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ position: "absolute", left: 0, right: 0, top: 1470, textAlign: "center", fontFamily: `'${fontFor(lang)}'`, fontSize: 34, color: MU }}>{tx.customers}: <span style={{ fontFamily: "'Inter SemiBold'", fontSize: 60, color: WH }}>0</span></div>
          <Tag text={l.e1tag} at={12.0} top={1560} lang={lang} /><Kw text={l.kw} at={12.7} top={1680} lang={lang} />
        </>
      )}
      <Sfx at={0.05} src="thump.wav" />
      <Sfx at={3.1} src="whoosh.wav" volume={0.5} />
      <Sfx at={6.6} src="whoosh.wav" volume={0.5} />
      <Sfx at={7.4} src="thump.wav" volume={0.7} />
      <Sfx at={10.1} src="whoosh.wav" volume={0.5} />
      <Sfx at={12.0} src="pop.wav" />
    </StoryFrame>
  );
};

export const LynqStory2: React.FC<P> = ({ lang = "en" }) => {
  const { s } = useT();
  const { tx, l, ac } = T(lang);
  return (
    <StoryFrame ep={2} seconds={15} lang={lang} tx={tx}>
      {s < 2.7 && <><Phone at={-1}><MapCard status="editing" editAt={0.9} lang={lang} tx={tx} /></Phone><Say text={l.e2a} at={-1} out={2.5} lang={lang} top={250} accent={ac} size={92} /></>}
      {s >= 2.7 && s < 5.7 && <><Street sign="open" pose="happy" /><Walkers from={2.8} n={3} enter /><Say text={l.e2b} at={2.8} out={5.5} lang={lang} top={250} accent={ac} /></>}
      {s >= 5.7 && s < 12.0 && (
        <>
          <Phone at={5.7} out={11.5}><OldSite loadingFrom={8.6} lang={lang} tx={tx} /></Phone>
          {s < 8.6 && <Say text={l.e2c} at={5.8} out={8.4} lang={lang} top={250} accent={ac} size={80} />}
          {s >= 8.6 && <Say text={l.e2d} at={8.7} out={11.8} lang={lang} top={250} accent={ac} size={88} />}
        </>
      )}
      {s >= 12.0 && <><Bakery pose="worried" top={170} /><Say text={l.e2e} at={12.0} lang={lang} top={250} accent={ac} size={74} /><Tag text={l.e2tag} at={13.0} top={1520} lang={lang} /><Kw text={l.kw} at={13.5} top={1650} lang={lang} /></>}
      <Sfx at={0.9} src="click.wav" />
      <Sfx at={1.1} src="ding.wav" volume={0.5} />
      <Sfx at={2.7} src="whoosh.wav" volume={0.5} />
      {[3.8, 4.6, 5.4].map((t) => <Sfx key={t} at={t} src="ding.wav" volume={0.35} />)}
      <Sfx at={5.7} src="whoosh.wav" volume={0.5} />
      <Sfx at={11.5} src="whoosh.wav" volume={0.6} />
      <Sfx at={12.0} src="thump.wav" />
    </StoryFrame>
  );
};

/** Old site wiping away to reveal the new one. */
const Rebuild: React.FC<{ lang: Lang; tx: Record<string, string>; scrollAt?: number }> = ({ lang, tx, scrollAt }) => {
  const { s } = useT();
  const k = 1 - ramp(s, 0.25, 1.05);
  return (
    <>
      <NewSite lang={lang} tx={tx} scrollAt={scrollAt} />
      {k > 0 && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${k * 100}%`, overflow: "hidden", borderRight: `6px solid ${LI}` }}><div style={{ position: "absolute", left: 0, top: 0, width: 544, height: 1144 }}><OldSite lang={lang} tx={tx} /></div></div>}
    </>
  );
};

export const LynqStory3: React.FC<P> = ({ lang = "en" }) => {
  const { s } = useT();
  const { tx, l, ac } = T(lang);
  return (
    <StoryFrame ep={3} seconds={15} lang={lang} tx={tx}>
      {s < 6.4 && <Phone at={-1} out={6.2}><Rebuild lang={lang} tx={tx} scrollAt={3.4} /></Phone>}
      {s < 3.2 && <Say text={l.e3a} at={-1} out={3.0} lang={lang} top={250} accent={ac} size={80} />}
      {s >= 3.2 && s < 6.4 && <Say text={l.e3b} at={3.3} out={6.2} lang={lang} top={250} accent={ac} size={92} />}
      {s >= 6.4 && s < 8.6 && <><Street sign="open" pose="happy" /><Walkers from={6.4} n={3} enter /><Say text={l.e3x} at={6.5} out={8.4} lang={lang} top={250} accent={ac} size={92} /></>}
      {s >= 8.6 && s < 12.1 && <><Phone at={8.6} out={11.9}><Reviews rating={3.1} lang={lang} tx={tx} /></Phone><Say text={l.e3c} at={8.7} out={11.9} lang={lang} top={250} accent={ac} size={84} /></>}
      {s >= 12.1 && <><Bakery pose="worried" top={170} /><Say text={l.e3d} at={12.1} lang={lang} top={250} accent={ac} size={92} /><Tag text={l.e3tag} at={13.1} top={1520} lang={lang} /><Kw text={l.kw} at={13.6} top={1650} lang={lang} /></>}
      <Sfx at={0.25} src="whoosh.wav" volume={0.6} />
      <Sfx at={1.05} src="ding.wav" volume={0.5} />
      <Sfx at={6.4} src="whoosh.wav" volume={0.5} />
      {[7.2, 7.9].map((t) => <Sfx key={t} at={t} src="ding.wav" volume={0.35} />)}
      <Sfx at={8.6} src="whoosh.wav" volume={0.5} />
      <Sfx at={9.6} src="thump.wav" volume={0.7} />
      <Sfx at={12.1} src="thump.wav" />
    </StoryFrame>
  );
};

/** A QR card on the counter and the rating climbing (a made-up shop, made-up numbers). */
const Climb: React.FC<{ from: number; lang: Lang; tx: Record<string, string> }> = ({ from, lang, tx }) => {
  const { s } = useT();
  const r = 3.1 + ramp(s, from, from + 3) * 1.5;
  const qr = Array.from({ length: 49 }, (_, i) => ((i * 37) % 11 < 5 ? `<rect x="${(i % 7) * 20}" y="${Math.floor(i / 7) * 20}" width="20" height="20" fill="#0b0b0c"/>` : "")).join("");
  return (
    <>
      <div style={{ position: "absolute", left: 120, top: 1400, width: 300, padding: 22, borderRadius: 24, background: "#f2efe8", textAlign: "center" }}>
        <svg width="140" height="140" viewBox="0 0 140 140" dangerouslySetInnerHTML={{ __html: qr }} />
        <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ fontFamily: `'${fontFor(lang, "bold")}'`, fontSize: 24, color: BK, marginTop: 8 }}>{tx.qr}</div>
      </div>
      <div style={{ position: "absolute", right: 110, top: 1410, textAlign: "center" }}>
        <div style={{ fontFamily: "'Inter SemiBold'", fontSize: 130, color: WH, lineHeight: 1 }}>{r.toFixed(1)}</div>
        <div style={{ fontSize: 46, color: "#fbbf24", letterSpacing: 4 }}>{"★".repeat(Math.round(r))}<span style={{ color: "#3a3a40" }}>{"★".repeat(5 - Math.round(r))}</span></div>
      </div>
    </>
  );
};

export const LynqStory4: React.FC<P> = ({ lang = "en" }) => {
  const { s } = useT();
  const { tx, l, ac } = T(lang);
  return (
    <StoryFrame ep={4} seconds={15} lang={lang} tx={tx}>
      {s < 3.6 && <><Phone at={-1}><Reviews rating={3.1} replyAt={0.2} lang={lang} tx={tx} /></Phone><Say text={l.e4a} at={-1} out={3.4} lang={lang} top={250} accent={ac} size={86} /></>}
      {s >= 3.6 && s < 7.9 && <><Bakery pose="happy" top={170} /><Climb from={4.4} lang={lang} tx={tx} /><Say text={l.e4b} at={3.7} out={7.7} lang={lang} top={250} accent={ac} size={86} /></>}
      {s >= 7.9 && s < 11.6 && <><Phone at={7.9} out={11.4} shake><Calls from={8.0} lang={lang} tx={tx} /></Phone><Say text={l.e4c} at={8.0} out={11.4} lang={lang} top={250} accent={ac} size={86} /></>}
      {s >= 11.6 && <><Bakery pose="busy" top={170} /><Say text={l.e4d} at={11.6} lang={lang} top={250} accent={ac} size={80} /><Tag text={l.e4tag} at={12.8} top={1520} lang={lang} /><Kw text={l.kw} at={13.3} top={1650} lang={lang} /></>}
      {[0.4, 0.9, 1.4, 1.9, 2.4].map((t) => <Sfx key={t} at={t} src="click.wav" volume={0.4} />)}
      <Sfx at={3.6} src="whoosh.wav" volume={0.5} />
      {[4.6, 5.3, 6.0, 6.7, 7.4].map((t) => <Sfx key={t} at={t} src="ding.wav" volume={0.3} />)}
      {[7.9, 9.1, 10.3, 11.6, 12.8].map((t) => <Sfx key={t} at={t} src="ring.wav" volume={0.55} />)}
    </StoryFrame>
  );
};

const Checklist: React.FC<{ at: number; items: string[]; lang: Lang }> = ({ at, items, lang }) => (
  <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ position: "absolute", left: 120, right: 120, top: 520 }}>
    {items.map((it, i) => {
      const p = useSpringAt(at + i * 0.45, { damping: 12, stiffness: 200 });
      return (
        <div key={it} style={{ display: "flex", alignItems: "center", gap: 34, marginBottom: 46, opacity: Math.min(1, p * 1.4), transform: `translateX(${(1 - p) * (lang === "ar" ? 80 : -80)}px)` }}>
          <div style={{ width: 96, height: 96, borderRadius: 48, background: LI, color: BK, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 58, fontFamily: "'Inter SemiBold'" }}>✓</div>
          <div style={{ fontFamily: `'${fontFor(lang)}'`, fontSize: 76, color: WH, letterSpacing: lang === "ar" ? 0 : -2 }}>{it}</div>
        </div>
      );
    })}
  </div>
);

export const LynqStory5: React.FC<P> = ({ lang = "en" }) => {
  const { s } = useT();
  const { tx, l, ac } = T(lang);
  const btn = useSpringAt(10.4, { damping: 10, stiffness: 220 });
  return (
    <StoryFrame ep={5} seconds={13} lang={lang} tx={tx}>
      {s < 2.9 && <><Phone at={-1}><NewSite lang={lang} tx={tx} pressAt={1.3} /></Phone><Say text={l.e5a} at={-1} out={2.7} lang={lang} top={250} accent={ac} size={78} /></>}
      {s >= 2.9 && s < 6.6 && <><Phone at={2.9} out={6.4}><Orders from={3.2} lang={lang} tx={tx} /></Phone><Say text={l.e5b} at={3.0} out={6.4} lang={lang} top={250} accent={ac} size={86} /></>}
      {s >= 6.6 && s < 9.6 && <Checklist at={6.7} items={l.e5list.split("|")} lang={lang} />}
      {s >= 9.6 && (
        <>
          <Say text={l.e5d} at={9.6} lang={lang} top={470} accent={ac} size={92} />
          <Say text={l.e5e} at={10.1} lang={lang} top={800} size={92} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 1030, display: "flex", justifyContent: "center" }}><div dir={lang === "ar" ? "rtl" : "ltr"} style={{ padding: "34px 80px", borderRadius: 70, background: LI, fontFamily: `'${fontFor(lang, "bold")}'`, fontSize: 64, color: BK, transform: `scale(${btn})` }}>{l.e5cta}</div></div>
          <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ position: "absolute", left: 80, right: 80, top: 1230, textAlign: "center", fontFamily: `'${fontFor(lang)}'`, fontSize: 40, color: MU }}>{l.e5sub}</div>
          <Sami x={540} y={1700} size={0.5} pose="happy" />
          <div style={{ position: "absolute", left: 140, right: 140, top: 1720, height: 2, background: LN }} />
        </>
      )}
      <Sfx at={1.3} src="click.wav" />
      <Sfx at={2.9} src="whoosh.wav" volume={0.5} />
      {[3.2, 3.9, 4.6, 5.3].map((t) => <Sfx key={t} at={t} src="ding.wav" volume={0.35} />)}
      <Sfx at={6.6} src="whoosh.wav" volume={0.5} />
      {[6.7, 7.15, 7.6, 8.05].map((t) => <Sfx key={t} at={t} src="pop.wav" volume={0.5} />)}
      <Sfx at={9.6} src="thump.wav" />
      <Sfx at={10.4} src="pop.wav" />
    </StoryFrame>
  );
};

export const LYNQ_STORY = [LynqStory1, LynqStory2, LynqStory3, LynqStory4, LynqStory5];
export const LYNQ_STORY_SECONDS = [15, 15, 15, 15, 13];
