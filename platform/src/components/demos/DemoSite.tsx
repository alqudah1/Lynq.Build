import type { CSSProperties, ReactNode } from "react";
import { designTokens, webFontHref } from "@/lib/office/website/design";
import { siteCopy, type SiteCta, type SiteFact, type SiteSection, type SiteSpec } from "@/lib/office/website/spec";
import { DemoLeadForm } from "./DemoLeadForm";

/**
 * The LYNQ demo component system: one renderer for every generated
 * prospect website.
 *
 * Keeping the rendering here rather than in generated TSX is what makes
 * the site verifiable — the validator renders exactly these components
 * from exactly the spec that ships, so "the route renders" and "the
 * navigation resolves" are proven before anything is committed.
 *
 * Everything visual is driven by the design direction rather than
 * hard-coded: a real typeface pairing, a display scale that changes with
 * density, hairlines and veils mixed from the palette, and layout
 * archetypes that change the *structure* of the page rather than its
 * colour. Two prospects never receive the same page wearing a different
 * accent.
 *
 * The components are deliberately pure and hook-free so `website/render.ts`
 * can walk their element tree without a React server runtime.
 */

type Locale = "en" | "ar";

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

function asset(spec: SiteSpec, id: string | null) {
  return id ? spec.assets.find((item) => item.id === id) ?? null : null;
}

/**
 * One stylesheet, one grain texture, one set of entrance animations —
 * inlined so a generated route carries its own presentation and touches
 * nothing the platform owns. Motion is opt-out at the system level.
 */
const SITE_CSS = `
.demo-root{--demo-ease:cubic-bezier(.16,.84,.44,1)}
.demo-root *{box-sizing:border-box}
.demo-grain{position:fixed;inset:0;pointer-events:none;z-index:1;opacity:.05;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E")}
.demo-rise{opacity:0;transform:translateY(18px);animation:demo-rise .9s var(--demo-ease) forwards}
.demo-rise-2{animation-delay:.09s}
.demo-rise-3{animation-delay:.18s}
.demo-rise-4{animation-delay:.27s}
.demo-reveal{animation:demo-reveal 1.4s var(--demo-ease) forwards;transform:scale(1.06);opacity:0}
@keyframes demo-rise{to{opacity:1;transform:none}}
@keyframes demo-reveal{to{opacity:1;transform:none}}
.demo-eyebrow{font-size:.68rem;letter-spacing:.26em;text-transform:uppercase}
.demo-display{font-family:var(--demo-display);font-size:var(--demo-display-size);line-height:.94;letter-spacing:-.035em;font-weight:500}
.demo-h2{font-family:var(--demo-display);font-size:clamp(2rem,4vw,3.4rem);line-height:1.02;letter-spacing:-.03em;font-weight:500}
.demo-lead{font-size:var(--demo-lead-size);line-height:1.65}
.demo-rule{border:0;border-top:1px solid var(--demo-rule);margin:0}
.demo-leader{flex:1 1 auto;border-bottom:1px dotted var(--demo-rule-strong);transform:translateY(-.35em);min-width:1.5rem}
.demo-sticky{position:sticky;top:0;z-index:20;backdrop-filter:saturate(1.4) blur(14px);background:var(--demo-veil);border-bottom:1px solid var(--demo-rule)}
.demo-link-underline{background-image:linear-gradient(var(--demo-accent),var(--demo-accent));background-size:0% 1px;background-repeat:no-repeat;background-position:0 100%;transition:background-size .4s var(--demo-ease)}
.demo-link-underline:hover{background-size:100% 1px}
/* Every photograph on a prospect demo is the business's own file on the
   business's own host, and those move, 404 and refuse hotlinks. A browser's
   answer to that is a broken-image icon with the alt text sprawling beside
   it — on the one page meant to win the work. The frame carries the tone
   instead, and the image is painted transparent over it, so a file that
   never arrives reads as a quiet panel rather than as a mistake. Screen
   readers still get the alt text; the caption is still on the page. */
.demo-frame{position:relative;overflow:hidden;border-radius:var(--demo-radius);background:var(--demo-surface)}
.demo-frame img{background:var(--demo-surface);color:transparent;transition:transform 1.2s var(--demo-ease)}
.demo-frame:hover img{transform:scale(1.04)}
@media (prefers-reduced-motion:reduce){.demo-rise,.demo-reveal{animation:none;opacity:1;transform:none}.demo-frame img{transition:none}.demo-frame:hover img{transform:none}}
`;

function Picture({
  src,
  alt,
  credit,
  className,
  ratio,
  priority,
}: {
  src: string;
  alt: string;
  credit?: string | null;
  className?: string;
  ratio?: string;
  priority?: boolean;
}) {
  return (
    <figure className={`demo-frame ${priority ? "demo-reveal" : ""} ${className ?? ""}`} style={ratio ? ({ aspectRatio: ratio } as CSSProperties) : undefined}>
      {/*
        No referrer, for two reasons that point the same way. A good many
        hotlink protections key on the Referer header, so sending none is
        the difference between the photograph appearing and not. And the
        demo is built before anyone has spoken to the business: sending the
        header would put this preview's URL in their access logs days
        before the founder has decided whether to contact them at all.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- approved public asset on an arbitrary third-party host; no loader configuration is added for prospect demos. */}
      <img src={src} alt={alt} loading={priority ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
      {credit ? <figcaption className="mt-3 text-xs leading-5 text-[var(--demo-muted)]">{credit}</figcaption> : null}
    </figure>
  );
}

function Action({ cta, variant }: { cta: SiteCta; variant: "primary" | "secondary" | "quiet" }) {
  const external = cta.kind === "external";
  const shared = "inline-flex min-h-12 items-center gap-2 rounded-[var(--demo-radius)] px-7 text-sm font-semibold tracking-[-0.005em] outline-offset-4 transition-[transform,background-color,color] duration-300 focus-visible:outline-2 focus-visible:outline-[var(--demo-accent)] hover:-translate-y-0.5";
  const className =
    variant === "primary"
      ? `${shared} bg-[var(--demo-accent)] text-[var(--demo-accent-ink)]`
      : variant === "secondary"
        ? `${shared} border border-[var(--demo-rule-strong)] text-[var(--demo-ink)] hover:bg-[color-mix(in_srgb,var(--demo-ink)_8%,transparent)]`
        : "demo-link-underline inline-flex min-h-11 items-center text-sm font-medium text-[var(--demo-ink)] outline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--demo-accent)]";
  return (
    <a href={cta.href} className={className} {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
      {cta.label}
      {variant === "primary" ? <span aria-hidden="true">→</span> : null}
    </a>
  );
}

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={`demo-eyebrow flex items-center gap-3 font-medium text-[var(--demo-accent)] ${className ?? ""}`}>
      <span aria-hidden="true" className="h-px w-10 bg-current" />
      {children}
    </p>
  );
}

function FactList({ facts, tone }: { facts: SiteFact[]; tone?: "hero" }) {
  if (facts.length === 0) return null;
  return (
    <dl className={`grid gap-x-10 gap-y-6 ${facts.length > 1 ? "sm:grid-cols-2" : ""}`}>
      {facts.map((item) => (
        <div key={`${item.evidenceKey}-${item.label}`} className="grid gap-2 border-t border-[var(--demo-rule)] pt-4">
          <dt className="demo-eyebrow text-[var(--demo-muted)]">{item.label}</dt>
          <dd className={tone === "hero" ? "text-base leading-6 text-[var(--demo-ink)] md:text-lg" : "text-base leading-6 text-[var(--demo-ink)]"}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionShell({
  id,
  labelledBy,
  children,
  tone,
}: {
  id: string;
  labelledBy: string;
  children: ReactNode;
  tone?: "surface" | "inverse";
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={`relative px-5 py-[var(--demo-section)] md:px-10 ${tone === "surface" ? "bg-[var(--demo-surface)]" : ""}`}
    >
      <div className="mx-auto w-full max-w-[1180px]">{children}</div>
    </section>
  );
}

type HeadingLevel = 1 | 2 | 3;

function Heading({ id, level, children, className }: { id: string; level: HeadingLevel; children: ReactNode; className?: string }) {
  const Tag = `h${level}` as const;
  return (
    <Tag id={id} className={className ?? (level === 1 ? "demo-display text-[var(--demo-ink)]" : "demo-h2 text-[var(--demo-ink)]")}>
      {children}
    </Tag>
  );
}

function subLevel(level: HeadingLevel): HeadingLevel {
  return level === 1 ? 2 : 3;
}

function SubHeading({ level, children, className }: { level: HeadingLevel; children: ReactNode; className?: string }) {
  const Tag = `h${subLevel(level)}` as const;
  return <Tag className={className}>{children}</Tag>;
}

/** A section opener: eyebrow, heading and an optional standfirst, with the motif's rule. */
function SectionHead({
  level,
  headingId,
  heading,
  eyebrow,
  intro,
  align,
}: {
  level: HeadingLevel;
  headingId: string;
  heading: string;
  eyebrow?: string | null;
  intro?: string | null;
  align?: "center";
}) {
  return (
    <div className={`demo-rise grid gap-5 ${align === "center" ? "justify-items-center text-center" : ""}`}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <Heading id={headingId} level={level} className={`${level === 1 ? "demo-display" : "demo-h2"} max-w-4xl text-[var(--demo-ink)]`}>
        {heading}
      </Heading>
      {intro ? <p className="demo-lead max-w-[var(--demo-measure)] text-[var(--demo-muted)]">{intro}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero — the archetype does most of its work here                     */
/* ------------------------------------------------------------------ */

function Hero({ spec, section, level }: { spec: SiteSpec; section: Extract<SiteSection, { kind: "hero" }>; level: HeadingLevel }) {
  const image = asset(spec, section.assetId);
  const headingId = `${section.id}-heading`;
  const layout = spec.design.layout;
  const actions = (
    <div className="demo-rise demo-rise-3 flex flex-wrap items-center gap-4">
      {section.primaryCta ? <Action cta={section.primaryCta} variant="primary" /> : null}
      {section.secondaryCta ? <Action cta={section.secondaryCta} variant="secondary" /> : null}
    </div>
  );

  if (layout === "gallery-immersive" && image) {
    return (
      <section id={section.id} aria-labelledby={headingId} className="relative isolate overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <Picture src={image.url} alt={image.alt} priority className="h-full w-full rounded-none" />
        </div>
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--demo-bg)_30%,transparent)_0%,color-mix(in_srgb,var(--demo-bg)_55%,transparent)_45%,var(--demo-bg)_98%)]"
        />
        <div className="mx-auto flex min-h-[88svh] w-full max-w-[1180px] flex-col justify-end gap-8 px-5 pb-[var(--demo-section)] pt-32 md:px-10">
          <div className="demo-rise">{<Eyebrow>{section.eyebrow}</Eyebrow>}</div>
          <Heading id={headingId} level={level} className="demo-display demo-rise demo-rise-2 max-w-5xl text-[var(--demo-ink)]">
            {section.heading}
          </Heading>
          <p className="demo-lead demo-rise demo-rise-3 max-w-[var(--demo-measure)] text-[var(--demo-ink)]">{section.subhead}</p>
          {actions}
          <div className="demo-rise demo-rise-4 pt-6">
            <FactList facts={section.facts} tone="hero" />
          </div>
        </div>
      </section>
    );
  }

  if (layout === "warm-minimal") {
    return (
      <section id={section.id} aria-labelledby={headingId} className="px-5 pb-[var(--demo-section)] pt-28 md:px-10 md:pt-36">
        <div className="mx-auto grid w-full max-w-[900px] justify-items-center gap-8 text-center">
          <div className="demo-rise">
            <Eyebrow>{section.eyebrow}</Eyebrow>
          </div>
          <Heading id={headingId} level={level} className="demo-display demo-rise demo-rise-2 text-balance text-[var(--demo-ink)]">
            {section.heading}
          </Heading>
          <p className="demo-lead demo-rise demo-rise-3 max-w-[var(--demo-measure)] text-[var(--demo-muted)]">{section.subhead}</p>
          {actions}
        </div>
        {image ? (
          <div className="mx-auto mt-16 w-full max-w-[1180px]">
            <Picture src={image.url} alt={image.alt} credit={image.credit} priority ratio="16 / 8" />
          </div>
        ) : null}
        <div className="mx-auto mt-14 w-full max-w-[900px]">
          <FactList facts={section.facts} />
        </div>
      </section>
    );
  }

  if (layout === "market-grid") {
    return (
      <section id={section.id} aria-labelledby={headingId} className="px-5 pb-[var(--demo-section)] pt-28 md:px-10 md:pt-36">
        <div className="mx-auto grid w-full max-w-[1180px] gap-14">
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end lg:gap-16">
            <div className="grid gap-6">
              <div className="demo-rise">
                <Eyebrow>{section.eyebrow}</Eyebrow>
              </div>
              <Heading id={headingId} level={level} className="demo-display demo-rise demo-rise-2 text-balance text-[var(--demo-ink)]">
                {section.heading}
              </Heading>
            </div>
            <div className="demo-rise demo-rise-3 grid gap-6">
              <p className="demo-lead max-w-[var(--demo-measure)] text-[var(--demo-muted)]">{section.subhead}</p>
              {actions}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[1.6fr_1fr]">
            {image ? <Picture src={image.url} alt={image.alt} priority ratio="16 / 10" /> : null}
            <div className="grid content-end rounded-[var(--demo-radius)] border border-[var(--demo-rule)] bg-[var(--demo-surface)] p-7">
              <FactList facts={section.facts} />
            </div>
          </div>
        </div>
      </section>
    );
  }

  // editorial-split and counter-forward share a two-column frame; the
  // counter variant leads with the action and squares off the image.
  const counter = layout === "counter-forward";
  return (
    <section id={section.id} aria-labelledby={headingId} className="px-5 pb-[var(--demo-section)] pt-28 md:px-10 md:pt-36">
      <div className={`mx-auto grid w-full max-w-[1180px] items-center gap-12 lg:gap-20 ${image ? "lg:grid-cols-[1.05fr_.95fr]" : ""}`}>
        <div className="grid gap-7">
          <div className="demo-rise">
            <Eyebrow>{section.eyebrow}</Eyebrow>
          </div>
          <Heading id={headingId} level={level} className="demo-display demo-rise demo-rise-2 text-balance text-[var(--demo-ink)]">
            {section.heading}
          </Heading>
          <p className="demo-lead demo-rise demo-rise-3 max-w-[var(--demo-measure)] text-[var(--demo-muted)]">{section.subhead}</p>
          {actions}
          {counter ? (
            <div className="demo-rise demo-rise-4 pt-4">
              <FactList facts={section.facts} />
            </div>
          ) : null}
        </div>
        {image ? <Picture src={image.url} alt={image.alt} credit={image.credit} priority ratio={counter ? "1 / 1" : "4 / 5"} /> : null}
        {counter ? null : (
          <div className="demo-rise demo-rise-4 lg:col-span-2">
            <FactList facts={section.facts} />
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function SectionBody({ spec, section, level }: { spec: SiteSpec; section: SiteSection; level: HeadingLevel }) {
  const headingId = `${section.id}-heading`;
  switch (section.kind) {
    case "hero":
      return <Hero spec={spec} section={section} level={level} />;
    case "story": {
      const image = asset(spec, section.assetId);
      return (
        <SectionShell id={section.id} labelledBy={headingId}>
          <div className={`grid gap-12 ${image ? "lg:grid-cols-[1.05fr_.95fr] lg:gap-20" : ""}`}>
            <div className="grid content-start gap-7">
              <SectionHead level={level} headingId={headingId} heading={section.heading} eyebrow={section.eyebrow} />
              <div className="grid gap-6">
                {section.paragraphs.map((paragraph, index) => (
                  <p
                    key={index}
                    className={
                      index === 0
                        ? "max-w-[var(--demo-measure)] text-lg leading-8 text-[var(--demo-ink)] md:text-xl md:leading-9"
                        : "max-w-[var(--demo-measure)] text-base leading-8 text-[var(--demo-muted)] md:text-lg"
                    }
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
            {image ? <Picture src={image.url} alt={image.alt} credit={image.credit} ratio="3 / 4" className="lg:sticky lg:top-28" /> : null}
          </div>
        </SectionShell>
      );
    }
    case "highlights":
      return (
        <SectionShell id={section.id} labelledBy={headingId} tone="surface">
          <div className="grid gap-14">
            <SectionHead level={level} headingId={headingId} heading={section.heading} intro={section.intro} />
            <ol className="grid gap-px bg-[var(--demo-rule)] sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map((item, index) => (
                <li key={item.title} className="grid content-start gap-4 bg-[var(--demo-surface)] p-7 md:p-9">
                  <span aria-hidden="true" className="demo-eyebrow text-[var(--demo-accent)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <SubHeading level={level} className="font-[family-name:var(--demo-display)] text-2xl leading-tight tracking-[-0.02em] text-[var(--demo-ink)]">
                    {item.title}
                  </SubHeading>
                  <p className="text-[0.95rem] leading-7 text-[var(--demo-muted)]">{item.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </SectionShell>
      );
    case "services":
      return (
        <SectionShell id={section.id} labelledBy={headingId}>
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
            <SectionHead level={level} headingId={headingId} heading={section.heading} intro={section.intro} />
            <ul className="grid gap-0">
              {section.items.map((item) => (
                <li key={item.capability} className="grid gap-2 border-t border-[var(--demo-rule)] py-7 first:border-t-0 first:pt-0">
                  <SubHeading level={level} className="text-xl font-medium text-[var(--demo-ink)]">
                    {item.label}
                  </SubHeading>
                  {item.detail ? <p className="max-w-[var(--demo-measure)] text-[0.95rem] leading-7 text-[var(--demo-muted)]">{item.detail}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </SectionShell>
      );
    case "menu":
      return (
        <SectionShell id={section.id} labelledBy={headingId}>
          <div className="grid gap-14">
            <SectionHead level={level} headingId={headingId} heading={section.heading} intro={section.intro} />
            <div className="grid gap-14 lg:grid-cols-2 lg:gap-x-20">
              {section.categories.map((category) => (
                <div key={category.name} className="grid content-start gap-6">
                  <div className="grid gap-2">
                    <SubHeading level={level} className="font-[family-name:var(--demo-display)] text-3xl leading-tight tracking-[-0.02em] text-[var(--demo-ink)]">
                      {category.name}
                    </SubHeading>
                    {category.description ? <p className="text-[0.95rem] leading-7 text-[var(--demo-muted)]">{category.description}</p> : null}
                  </div>
                  <ul className="grid gap-5">
                    {category.items.map((item) => (
                      <li key={item.name} className="grid gap-1.5">
                        <p className="flex items-baseline gap-3">
                          <span className="text-base font-medium text-[var(--demo-ink)] md:text-lg">{item.name}</span>
                          {item.price ? <span aria-hidden="true" className="demo-leader" /> : null}
                          {item.price ? <span className="text-base text-[var(--demo-muted)]">{item.price}</span> : null}
                        </p>
                        {item.description ? <p className="max-w-[34rem] text-sm leading-6 text-[var(--demo-muted)]">{item.description}</p> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </SectionShell>
      );
    case "gallery":
      return (
        <SectionShell id={section.id} labelledBy={headingId}>
          <div className="grid gap-12">
            <SectionHead level={level} headingId={headingId} heading={section.heading} intro={section.intro} />
            <ul className="grid gap-3 sm:grid-cols-6">
              {section.assetIds.map((id, index) => {
                const image = asset(spec, id);
                if (!image) return null;
                // An editorial rhythm rather than a uniform grid: the first
                // of each trio runs wide, the others sit beside it.
                const wide = index % 3 === 0;
                return (
                  <li key={id} className={wide ? "sm:col-span-4" : "sm:col-span-2"}>
                    <Picture src={image.url} alt={image.alt} credit={image.credit} ratio={wide ? "16 / 10" : "4 / 5"} />
                  </li>
                );
              })}
            </ul>
          </div>
        </SectionShell>
      );
    case "proof":
      return (
        <SectionShell id={section.id} labelledBy={headingId} tone="surface">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <SectionHead level={level} headingId={headingId} heading={section.heading} intro={section.intro} />
            <div className="grid gap-8">
              <dl className="grid gap-px bg-[var(--demo-rule)] sm:grid-cols-2">
                {section.facts.map((item) => (
                  <div key={item.evidenceKey} className="grid gap-2 bg-[var(--demo-surface)] px-2 py-6 sm:px-7">
                    <dd className="font-[family-name:var(--demo-display)] text-5xl leading-none tracking-[-0.04em] text-[var(--demo-ink)] md:text-6xl">{item.value}</dd>
                    <dt className="demo-eyebrow text-[var(--demo-muted)]">{item.label}</dt>
                  </div>
                ))}
              </dl>
              {section.sourceUrl ? (
                <p className="text-xs leading-5 text-[var(--demo-muted)]">
                  <a href={section.sourceUrl} target="_blank" rel="noreferrer noopener" className="demo-link-underline">
                    {section.sourceUrl}
                  </a>
                </p>
              ) : null}
            </div>
          </div>
        </SectionShell>
      );
    case "visit": {
      const copy = siteCopy(spec.locale);
      return (
        <SectionShell id={section.id} labelledBy={headingId}>
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
            <div className="grid content-start gap-8">
              <SectionHead level={level} headingId={headingId} heading={section.heading} intro={section.intro} />
              <FactList facts={section.facts} />
              <div className="flex flex-wrap gap-4">
                {section.actions.map((action, index) => (
                  <Action key={action.href} cta={action} variant={index === 0 ? "primary" : "secondary"} />
                ))}
              </div>
            </div>
            <div className="grid content-start gap-5 rounded-[var(--demo-radius)] border border-[var(--demo-rule)] p-7 md:p-9">
              <SubHeading level={level} className="demo-eyebrow text-[var(--demo-muted)]">
                {copy.hours}
              </SubHeading>
              {section.hours.length > 0 ? (
                <dl className="grid">
                  {section.hours.map((row) => (
                    <div key={row.evidenceKey} className="flex items-baseline gap-4 border-t border-[var(--demo-rule)] py-4 first:border-t-0 first:pt-0">
                      <dt className="font-medium text-[var(--demo-ink)]">{row.day}</dt>
                      <span aria-hidden="true" className="demo-leader" />
                      <dd className="text-[var(--demo-muted)]">{row.hours}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm leading-7 text-[var(--demo-muted)]">{copy.hoursUnknown}</p>
              )}
            </div>
          </div>
        </SectionShell>
      );
    }
    case "contact":
      return (
        <SectionShell id={section.id} labelledBy={headingId} tone="surface">
          <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
            <div className="grid content-start gap-7">
              <SectionHead level={level} headingId={headingId} heading={section.heading} intro={section.intro} />
              {section.channels.length > 0 ? (
                <ul className="grid gap-4">
                  {section.channels.map((channel) => (
                    <li key={channel.href} className="border-t border-[var(--demo-rule)] pt-4">
                      <a
                        href={channel.href}
                        className="demo-link-underline text-lg text-[var(--demo-ink)]"
                        {...(channel.kind === "external" ? { target: "_blank", rel: "noreferrer noopener" } : {})}
                      >
                        {channel.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {section.form ? (
              <div className="rounded-[var(--demo-radius)] border border-[var(--demo-rule)] bg-[var(--demo-bg)] p-7 md:p-9">
                <DemoLeadForm form={section.form} idPrefix={`${section.id}-form`} locale={spec.locale} />
              </div>
            ) : null}
          </div>
        </SectionShell>
      );
    case "closing":
      return (
        <SectionShell id={section.id} labelledBy={headingId}>
          <div className="grid justify-items-center gap-8 py-8 text-center">
            <Heading id={headingId} level={level} className="demo-display max-w-4xl text-balance text-[var(--demo-ink)]" >
              {section.heading}
            </Heading>
            <p className="demo-lead max-w-[var(--demo-measure)] text-[var(--demo-muted)]">{section.body}</p>
            {section.cta ? <Action cta={section.cta} variant="primary" /> : null}
          </div>
        </SectionShell>
      );
  }
}

/* ------------------------------------------------------------------ */
/* Page frame                                                          */
/* ------------------------------------------------------------------ */

function Nav({ spec }: { spec: SiteSpec }) {
  return (
    <nav aria-label={spec.businessName} className="demo-sticky">
      <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-4 md:px-10">
        <a href={spec.route} className="font-[family-name:var(--demo-display)] text-base font-medium tracking-[-0.02em] text-[var(--demo-ink)] md:text-lg">
          {spec.businessName}
        </a>
        <ul className="order-3 flex w-full flex-wrap items-center gap-x-7 gap-y-1 text-[0.7rem] uppercase tracking-[0.18em] text-[var(--demo-muted)] md:order-none md:w-auto">
          {spec.nav.map((item) => (
            <li key={item.href}>
              <a href={item.href} className="demo-link-underline inline-flex min-h-11 items-center transition-colors duration-300 hover:text-[var(--demo-ink)]">
                {item.label}
              </a>
            </li>
          ))}
        </ul>
        {spec.navCta ? <Action cta={spec.navCta} variant="primary" /> : null}
      </div>
    </nav>
  );
}

export function DemoSitePage({ spec, path }: { spec: SiteSpec; path: string }) {
  const page = spec.pages.find((item) => item.path === path);
  if (!page) throw new Error(`The generated site has no page at "${path}"`);
  const copy = siteCopy(spec.locale as Locale);
  const style = designTokens(spec.design) as CSSProperties;

  return (
    <div
      dir={spec.direction}
      lang={spec.locale}
      style={style}
      className="demo-root relative min-h-screen bg-[var(--demo-bg)] font-[family-name:var(--demo-body)] text-[var(--demo-ink)] antialiased [text-wrap:pretty] selection:bg-[var(--demo-accent)] selection:text-[var(--demo-accent-ink)]"
    >
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={webFontHref(spec.design.typeSystem)} />
      <style dangerouslySetInnerHTML={{ __html: SITE_CSS }} />
      <div aria-hidden="true" className="demo-grain" />
      <a
        href="#demo-main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-[var(--demo-radius)] focus:bg-[var(--demo-accent)] focus:px-5 focus:py-3 focus:text-sm focus:font-semibold focus:text-[var(--demo-accent-ink)]"
      >
        {copy.skip}
      </a>
      <p className="border-b border-[var(--demo-rule)] bg-[var(--demo-surface)] px-5 py-2.5 text-center text-[0.7rem] leading-5 tracking-[0.02em] text-[var(--demo-muted)] md:px-10">
        {spec.demoDisclosure}
      </p>
      <Nav spec={spec} />
      <main id="demo-main" className="relative z-[2]">
        {page.sections.map((section, index) => (
          <SectionBody key={section.id} spec={spec} section={section} level={index === 0 ? 1 : 2} />
        ))}
      </main>
      <footer className="border-t border-[var(--demo-rule)] px-5 py-10 md:px-10">
        <div className="mx-auto grid w-full max-w-[1180px] gap-4 text-xs leading-6 text-[var(--demo-muted)] md:grid-cols-[1fr_auto] md:items-end">
          <p className="font-[family-name:var(--demo-display)] text-lg tracking-[-0.02em] text-[var(--demo-ink)]">{spec.businessName}</p>
          <p className="md:text-end">{spec.footerNote}</p>
          <p className="md:col-span-2">{spec.demoDisclosure}</p>
        </div>
      </footer>
    </div>
  );
}
