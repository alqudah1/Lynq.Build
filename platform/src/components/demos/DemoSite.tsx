import type { CSSProperties, ReactNode } from "react";
import { designTokens } from "@/lib/office/website/design";
import { siteCopy, type SiteCta, type SiteFact, type SiteSection, type SiteSpec } from "@/lib/office/website/spec";
import { DemoLeadForm } from "./DemoLeadForm";

/**
 * The LYNQ demo component system: one renderer for every generated
 * prospect website. Keeping the rendering here rather than in generated
 * TSX is what makes the site verifiable — the validator renders exactly
 * these components from exactly the spec that ships, so "the route renders"
 * and "the navigation resolves" are proven before anything is committed.
 *
 * Archetypes change structure, not just colour: the hero, the section
 * rhythm and the rules between sections all differ, so two prospects never
 * receive the same page wearing a different palette.
 */

function asset(spec: SiteSpec, id: string | null) {
  return id ? spec.assets.find((item) => item.id === id) ?? null : null;
}

function Picture({ src, alt, className, credit }: { src: string; alt: string; className?: string; credit?: string | null }) {
  return (
    <figure className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element -- approved public asset on an arbitrary third-party host; no loader configuration is added for prospect demos. */}
      <img src={src} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      {credit ? <figcaption className="mt-2 text-xs text-[var(--demo-muted)]">{credit}</figcaption> : null}
    </figure>
  );
}

function Action({ cta, variant }: { cta: SiteCta; variant: "primary" | "secondary" }) {
  const external = cta.kind === "external";
  const className =
    variant === "primary"
      ? "inline-flex min-h-12 items-center rounded-[var(--demo-radius)] bg-[var(--demo-accent)] px-7 text-sm font-semibold text-[var(--demo-accent-ink)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--demo-ink)]"
      : "inline-flex min-h-12 items-center rounded-[var(--demo-radius)] border border-[color-mix(in_srgb,var(--demo-ink)_28%,transparent)] px-7 text-sm font-semibold text-[var(--demo-ink)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--demo-accent)]";
  return (
    <a href={cta.href} className={className} {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
      {cta.label}
    </a>
  );
}

function FactList({ facts }: { facts: SiteFact[] }) {
  if (facts.length === 0) return null;
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {facts.map((item) => (
        <div key={`${item.evidenceKey}-${item.label}`} className="grid gap-1">
          <dt className="text-xs uppercase tracking-[0.18em] text-[var(--demo-muted)]">{item.label}</dt>
          <dd className="text-base text-[var(--demo-ink)]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionShell({ id, labelledBy, children, tone }: { id: string; labelledBy: string; children: ReactNode; tone?: "surface" }) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={`px-5 py-[var(--demo-section)] md:px-10 ${tone === "surface" ? "bg-[var(--demo-surface)]" : ""}`}
    >
      <div className="mx-auto w-full max-w-[1240px]">{children}</div>
    </section>
  );
}

type HeadingLevel = 1 | 2 | 3;

function Heading({ id, level, children, className }: { id: string; level: HeadingLevel; children: ReactNode; className?: string }) {
  const Tag = `h${level}` as const;
  return (
    <Tag id={id} className={className ?? "text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-[var(--demo-ink)] md:text-6xl"}>
      {children}
    </Tag>
  );
}

/**
 * A section's own heading may be the page's h1 (the first section) or an
 * h2. Headings nested inside it must follow by exactly one level, or a
 * screen reader's outline gains a hole — which is what `heading-order`
 * catches and what the validator now proves for every generated page.
 */
function subLevel(level: HeadingLevel): HeadingLevel {
  return level === 1 ? 2 : 3;
}

function SubHeading({ level, children, className }: { level: HeadingLevel; children: ReactNode; className?: string }) {
  const Tag = `h${subLevel(level)}` as const;
  return <Tag className={className}>{children}</Tag>;
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function Hero({ spec, section, level }: { spec: SiteSpec; section: Extract<SiteSection, { kind: "hero" }>; level: HeadingLevel }) {
  const image = asset(spec, section.assetId);
  const headingId = `${section.id}-heading`;
  const layout = spec.design.layout;
  const eyebrow = (
    <p className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.26em] text-[var(--demo-accent)]">
      <span aria-hidden="true" className="h-px w-8 bg-current" />
      {section.eyebrow}
    </p>
  );
  const actions = (
    <div className="flex flex-wrap gap-3">
      {section.primaryCta ? <Action cta={section.primaryCta} variant="primary" /> : null}
      {section.secondaryCta ? <Action cta={section.secondaryCta} variant="secondary" /> : null}
    </div>
  );

  if (layout === "gallery-immersive" && image) {
    return (
      <section id={section.id} aria-labelledby={headingId} className="relative isolate overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <Picture src={image.url} alt={image.alt} className="h-full w-full" />
        </div>
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--demo-bg)_45%,transparent)_0%,var(--demo-bg)_96%)]" />
        <div className="mx-auto flex min-h-[80svh] w-full max-w-[1240px] flex-col justify-end gap-8 px-5 py-[var(--demo-section)] md:px-10">
          {eyebrow}
          <Heading id={headingId} level={level} className="max-w-4xl text-5xl font-semibold leading-[0.95] tracking-[-0.045em] text-[var(--demo-ink)] md:text-8xl">
            {section.heading}
          </Heading>
          <p className="max-w-[var(--demo-measure)] text-lg leading-8 text-[var(--demo-ink)]">{section.subhead}</p>
          {actions}
          <FactList facts={section.facts} />
        </div>
      </section>
    );
  }

  if (layout === "warm-minimal") {
    return (
      <section id={section.id} aria-labelledby={headingId} className="px-5 py-[var(--demo-section)] text-center md:px-10">
        <div className="mx-auto grid w-full max-w-[900px] justify-items-center gap-8">
          {eyebrow}
          <Heading id={headingId} level={level} className="text-5xl font-semibold leading-[1] tracking-[-0.04em] text-[var(--demo-ink)] md:text-7xl">
            {section.heading}
          </Heading>
          <p className="max-w-[var(--demo-measure)] text-lg leading-8 text-[var(--demo-muted)]">{section.subhead}</p>
          {actions}
          {image ? <Picture src={image.url} alt={image.alt} credit={image.credit} className="mt-4 aspect-[16/7] w-full overflow-hidden rounded-[var(--demo-radius)]" /> : null}
          <FactList facts={section.facts} />
        </div>
      </section>
    );
  }

  if (layout === "market-grid") {
    return (
      <section id={section.id} aria-labelledby={headingId} className="px-5 py-[var(--demo-section)] md:px-10">
        <div className="mx-auto grid w-full max-w-[1240px] gap-10">
          <div className="grid gap-6">
            {eyebrow}
            <Heading id={headingId} level={level} className="max-w-3xl text-5xl font-semibold leading-[0.98] tracking-[-0.04em] text-[var(--demo-ink)] md:text-7xl">
              {section.heading}
            </Heading>
            <p className="max-w-[var(--demo-measure)] text-lg leading-8 text-[var(--demo-muted)]">{section.subhead}</p>
            {actions}
          </div>
          <div className="grid gap-px overflow-hidden rounded-[var(--demo-radius)] bg-[color-mix(in_srgb,var(--demo-ink)_14%,transparent)] sm:grid-cols-2">
            {image ? <Picture src={image.url} alt={image.alt} className="aspect-[4/3] w-full bg-[var(--demo-surface)]" /> : null}
            <div className="bg-[var(--demo-surface)] p-6">
              <FactList facts={section.facts} />
            </div>
          </div>
        </div>
      </section>
    );
  }

  // editorial-split and counter-forward share a two-column frame; the
  // counter variant leads with the actions rather than the image.
  const counter = layout === "counter-forward";
  return (
    <section id={section.id} aria-labelledby={headingId} className="px-5 py-[var(--demo-section)] md:px-10">
      <div className={`mx-auto grid w-full max-w-[1240px] items-center gap-10 lg:gap-16 ${image ? "lg:grid-cols-2" : ""}`}>
        <div className="grid gap-7">
          {eyebrow}
          <Heading id={headingId} level={level} className="text-5xl font-semibold leading-[0.98] tracking-[-0.04em] text-[var(--demo-ink)] md:text-7xl">
            {section.heading}
          </Heading>
          <p className="max-w-[var(--demo-measure)] text-lg leading-8 text-[var(--demo-muted)]">{section.subhead}</p>
          {actions}
          {counter ? <FactList facts={section.facts} /> : null}
        </div>
        {image ? (
          <Picture
            src={image.url}
            alt={image.alt}
            credit={image.credit}
            className={`w-full overflow-hidden rounded-[var(--demo-radius)] ${counter ? "aspect-square" : "aspect-[4/5]"}`}
          />
        ) : null}
        {counter ? null : <div className="lg:col-span-2"><FactList facts={section.facts} /></div>}
      </div>
    </section>
  );
}

function SectionBody({ spec, section, level }: { spec: SiteSpec; section: SiteSection; level: HeadingLevel }) {
  const headingId = `${section.id}-heading`;
  switch (section.kind) {
    case "hero":
      return <Hero spec={spec} section={section} level={level} />;
    case "story": {
      const image = asset(spec, section.assetId);
      return (
        <SectionShell id={section.id} labelledBy={headingId}>
          <div className={`grid gap-10 ${image ? "lg:grid-cols-[1.1fr_0.9fr] lg:gap-16" : ""}`}>
            <div className="grid content-start gap-6">
              <p className="text-xs uppercase tracking-[0.26em] text-[var(--demo-accent)]">{section.eyebrow}</p>
              <Heading id={headingId} level={level}>{section.heading}</Heading>
              {section.paragraphs.map((paragraph, index) => (
                <p key={index} className="max-w-[var(--demo-measure)] text-base leading-8 text-[var(--demo-muted)] md:text-lg">
                  {paragraph}
                </p>
              ))}
            </div>
            {image ? <Picture src={image.url} alt={image.alt} credit={image.credit} className="aspect-[3/4] w-full overflow-hidden rounded-[var(--demo-radius)]" /> : null}
          </div>
        </SectionShell>
      );
    }
    case "highlights":
      return (
        <SectionShell id={section.id} labelledBy={headingId} tone="surface">
          <div className="grid gap-10">
            <div className="grid gap-4">
              <Heading id={headingId} level={level}>{section.heading}</Heading>
              {section.intro ? <p className="max-w-[var(--demo-measure)] text-base leading-8 text-[var(--demo-muted)]">{section.intro}</p> : null}
            </div>
            <ul className="grid gap-[var(--demo-gap)] sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map((item) => (
                <li key={item.title} className="grid content-start gap-3 border-t border-[color-mix(in_srgb,var(--demo-ink)_18%,transparent)] pt-6">
                  <SubHeading level={level} className="text-xl font-semibold text-[var(--demo-ink)]">{item.title}</SubHeading>
                  <p className="text-sm leading-7 text-[var(--demo-muted)]">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </SectionShell>
      );
    case "services":
      return (
        <SectionShell id={section.id} labelledBy={headingId}>
          <div className="grid gap-8">
            <Heading id={headingId} level={level}>{section.heading}</Heading>
            <ul className="grid gap-[var(--demo-gap)] sm:grid-cols-2">
              {section.items.map((item) => (
                <li key={item.capability} className="grid content-start gap-2 rounded-[var(--demo-radius)] border border-[color-mix(in_srgb,var(--demo-ink)_16%,transparent)] p-6">
                  <SubHeading level={level} className="text-lg font-semibold text-[var(--demo-ink)]">{item.label}</SubHeading>
                  {item.detail ? <p className="text-sm leading-7 text-[var(--demo-muted)]">{item.detail}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </SectionShell>
      );
    case "menu":
      return (
        <SectionShell id={section.id} labelledBy={headingId}>
          <div className="grid gap-10">
            <div className="grid gap-4">
              <Heading id={headingId} level={level}>{section.heading}</Heading>
              {section.intro ? <p className="max-w-[var(--demo-measure)] text-base leading-8 text-[var(--demo-muted)]">{section.intro}</p> : null}
            </div>
            <div className="grid gap-12 lg:grid-cols-2">
              {section.categories.map((category) => (
                <div key={category.name} className="grid content-start gap-5">
                  <SubHeading level={level} className="text-2xl font-semibold text-[var(--demo-ink)]">{category.name}</SubHeading>
                  {category.description ? <p className="text-sm leading-7 text-[var(--demo-muted)]">{category.description}</p> : null}
                  <ul className="grid gap-4">
                    {category.items.map((item) => (
                      <li key={item.name} className="grid gap-1 border-t border-[color-mix(in_srgb,var(--demo-ink)_14%,transparent)] pt-4">
                        <p className="flex flex-wrap items-baseline justify-between gap-3">
                          <span className="text-base font-medium text-[var(--demo-ink)]">{item.name}</span>
                          {item.price ? <span className="text-sm text-[var(--demo-muted)]">{item.price}</span> : null}
                        </p>
                        {item.description ? <p className="text-sm leading-7 text-[var(--demo-muted)]">{item.description}</p> : null}
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
          <div className="grid gap-8">
            <Heading id={headingId} level={level}>{section.heading}</Heading>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.assetIds.map((id) => {
                const image = asset(spec, id);
                return image ? (
                  <li key={id}>
                    <Picture src={image.url} alt={image.alt} credit={image.credit} className="aspect-[4/3] w-full overflow-hidden rounded-[var(--demo-radius)]" />
                  </li>
                ) : null;
              })}
            </ul>
          </div>
        </SectionShell>
      );
    case "proof":
      return (
        <SectionShell id={section.id} labelledBy={headingId} tone="surface">
          <div className="grid gap-8">
            <Heading id={headingId} level={level}>{section.heading}</Heading>
            <FactList facts={section.facts} />
            {section.sourceUrl ? (
              <p className="text-xs text-[var(--demo-muted)]">
                <a href={section.sourceUrl} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                  {section.sourceUrl}
                </a>
              </p>
            ) : null}
          </div>
        </SectionShell>
      );
    case "visit": {
      const copy = siteCopy(spec.locale);
      return (
        <SectionShell id={section.id} labelledBy={headingId}>
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="grid content-start gap-6">
              <Heading id={headingId} level={level}>{section.heading}</Heading>
              {section.intro ? <p className="max-w-[var(--demo-measure)] text-base leading-8 text-[var(--demo-muted)]">{section.intro}</p> : null}
              <FactList facts={section.facts} />
              <div className="flex flex-wrap gap-3">
                {section.actions.map((action, index) => (
                  <Action key={action.href} cta={action} variant={index === 0 ? "primary" : "secondary"} />
                ))}
              </div>
            </div>
            <div className="grid content-start gap-4">
              <SubHeading level={level} className="text-xs uppercase tracking-[0.2em] text-[var(--demo-muted)]">{copy.hours}</SubHeading>
              {section.hours.length > 0 ? (
                <dl className="grid">
                  {section.hours.map((row) => (
                    <div key={row.evidenceKey} className="flex items-center justify-between gap-6 border-t border-[color-mix(in_srgb,var(--demo-ink)_14%,transparent)] py-3 text-sm">
                      <dt className="font-medium text-[var(--demo-ink)]">{row.day}</dt>
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
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <div className="grid content-start gap-6">
              <Heading id={headingId} level={level}>{section.heading}</Heading>
              {section.intro ? <p className="max-w-[var(--demo-measure)] text-base leading-8 text-[var(--demo-muted)]">{section.intro}</p> : null}
              {section.channels.length > 0 ? (
                <ul className="grid gap-3">
                  {section.channels.map((channel) => (
                    <li key={channel.href}>
                      <a
                        href={channel.href}
                        className="text-base text-[var(--demo-ink)] underline underline-offset-4"
                        {...(channel.kind === "external" ? { target: "_blank", rel: "noreferrer noopener" } : {})}
                      >
                        {channel.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {section.form ? <DemoLeadForm form={section.form} idPrefix={`${section.id}-form`} locale={spec.locale} /> : null}
          </div>
        </SectionShell>
      );
    case "closing":
      return (
        <SectionShell id={section.id} labelledBy={headingId}>
          <div className="grid justify-items-center gap-6 text-center">
            <Heading id={headingId} level={level}>{section.heading}</Heading>
            <p className="max-w-[var(--demo-measure)] text-base leading-8 text-[var(--demo-muted)]">{section.body}</p>
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
  const home = spec.route;
  return (
    <nav aria-label={spec.businessName} className="border-b border-[color-mix(in_srgb,var(--demo-ink)_14%,transparent)]">
      <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-4 px-5 py-4 md:px-10">
        <a href={home} className="text-sm font-semibold tracking-[-0.01em] text-[var(--demo-ink)]">
          {spec.businessName}
        </a>
        <ul className="flex flex-wrap items-center gap-5 text-xs uppercase tracking-[0.18em] text-[var(--demo-muted)]">
          {spec.nav.map((item) => (
            <li key={item.href}>
              <a href={item.href} className="min-h-11 leading-[2.75rem] text-[var(--demo-muted)] hover:text-[var(--demo-ink)]">
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
  const copy = siteCopy(spec.locale);
  const style = designTokens(spec.design) as CSSProperties;

  return (
    <div
      dir={spec.direction}
      lang={spec.locale}
      style={style}
      className="min-h-screen bg-[var(--demo-bg)] font-[family-name:var(--demo-body)] text-[var(--demo-ink)] [&_h1]:font-[family-name:var(--demo-display)] [&_h2]:font-[family-name:var(--demo-display)]"
    >
      <a
        href="#demo-main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-[var(--demo-radius)] focus:bg-[var(--demo-accent)] focus:px-5 focus:py-3 focus:text-sm focus:text-[var(--demo-accent-ink)]"
      >
        {copy.skip}
      </a>
      <p className="bg-[var(--demo-surface)] px-5 py-2 text-center text-xs leading-6 text-[var(--demo-muted)] md:px-10">{spec.demoDisclosure}</p>
      <Nav spec={spec} />
      <main id="demo-main">
        {page.sections.map((section, index) => (
          <SectionBody key={section.id} spec={spec} section={section} level={index === 0 ? 1 : 2} />
        ))}
      </main>
      <footer className="border-t border-[color-mix(in_srgb,var(--demo-ink)_14%,transparent)] px-5 py-8 md:px-10">
        <div className="mx-auto grid w-full max-w-[1240px] gap-3 text-xs leading-6 text-[var(--demo-muted)]">
          <p>{spec.footerNote}</p>
          <p>{spec.demoDisclosure}</p>
        </div>
      </footer>
    </div>
  );
}
