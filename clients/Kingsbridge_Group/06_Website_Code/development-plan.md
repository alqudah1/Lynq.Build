# Kingsbridge Group — Internal Implementation Brief

Status: full site built (Home, Services, Projects, About, Contact) and refined for
client presentation. Color system finalized to exact client-approved hex values
(§5). Contact inquiry taxonomy expanded to 7 paths (§ below). Homepage + global
foundation implemented.
Repo convention confirmed: static HTML/CSS/JS per client (no build step), deployed as-is
via Vercel (see root `vercel.json`, `cleanUrls: true`). No shared cross-client component
library exists — each client site is self-contained under `clients/CLIENT_NAME/`.
Kingsbridge follows that isolation model exactly (own css/js/partials, nothing shared
with other clients or the root portfolio site).

## 0b. Hero rebuild — cinematic scroll story (this round)
Homepage hero (`#hero-story`) replaced the old static hero entirely. Desktop
(min-width 900px, motion allowed): a 600vh pinned scroll story, GSAP +
ScrollTrigger (loaded via CDN, only on `index.html`), 5 stages crossfading
via scroll-scrub with a persistent headline ("Where vision becomes timeless
spaces."), CREATE·BUILD·MANAGE tag, and the two CTA buttons staying fixed
throughout:
1. **Vision** — architectural blueprint (elevation, then floor plan; same
   SVG line-draw technique as the intro sequence, extended)
2. **Design** — hero-estate.jpg (reads as a 3D visualization render)
3. **Build** — build-construction.jpg (Ken Burns pan stands in for footage)
4. **Completion** — office-glass.jpg (finished property)
5. **Management** — manage-apartments.jpg (maintained/operated building)

Mobile and `prefers-reduced-motion`: CSS fallback collapses to a single
static frame (stage 2's photo) at normal hero height — no GSAP, no pin, no
scroll hijack, full content immediately accessible. See `initHeroStory()` in
`experience.js` and the `HERO STORY` block in `experience.css`.

**Found and fixed during QA**: the overlay copy (`.hero-story-copy`) was
initially a sibling of the sticky track rather than nested inside it, so its
`position:absolute; bottom:0` resolved against the full 6000px section
instead of the 100vh sticky viewport — pushed the entire headline/CTA off
-screen for most of the scroll. Fixed by nesting it inside
`.hero-story-track`.

## 0a. Final luxury polish round (previous round)
- **Blueprint-to-photo intro**: homepage intro sequence now draws a minimal
  architectural line-art house (SVG, `stroke-dashoffset` draw-in) before the
  logo appears, then dissolves into the real hero photo — "blueprint becoming
  a finished home." Session-gated like before; fully skipped under
  `prefers-reduced-motion`. See `.intro-veil .blueprint` in `experience.css`.
- **Page transitions**: veil timing extended (~420ms) with a scale-in on the
  icon mark so it reads as a logo reveal rather than a flash.
- **Custom cursor accent**: a small gold ring follows the pointer and scales
  on links/buttons, desktop pointer devices only (`hover:hover` and
  `pointer:fine`), off under reduced motion and on touch. See
  `initCustomCursor()` in `experience.js`.
- **Nav renamed**: "Projects" → "Concept Collection" in header + footer +
  mobile menu (URL stays `/projects/` — no redirects needed).
- **Property Management elevated**: a new full-bleed cinematic panel
  (`#property-management`, reusing the `.cinema-panel` pattern from the
  portfolio) now opens the section with the same visual weight as
  Create/Build, before the detailed breakdown (`#pm-detail`) below it.

## 0. Photography — licensed stock, standing in for real assets
Every `.ph-photo` across the site (hero, Create/Build/Manage, Property
Management, Services, all 6 Concept Collection entries, About) now renders a
real photo instead of a CSS-gradient placeholder — sourced from Unsplash
(free commercial license, no attribution required) since no real Kingsbridge
photography/video exists yet. Files live in `assets/img/photography/`.
Chosen deliberately for **anonymity**: no identifiable real building, no
readable street signs or landmarks (one photo was cropped and another
blurred specifically to remove legible signage), nothing that could be
mistaken for a specific real property Kingsbridge doesn't own. These are
mood/reference imagery for the "concept" framing, not claims of real
completed work — consistent with the existing "Concept Collection" honesty
rule (§ Projects). **Replace with real photography before public launch**;
until then, do not caption or present any of these as an actual Kingsbridge
property. See `07_Feedback/Client_Presentation/client-assets-needed.md` for
the specific shot list still needed from the client.

## 1. Site architecture
```
/                    Home
/services            Hub: Development & Homes · Design · Property Management
/projects            Portfolio index (data-driven)
/projects/project    Project template (reads ?slug=, renders from projects-data.js)
/about               Story, 20+ years, legacy/family positioning
/contact             7-path inquiry: build-home / renovate / residential-management /
                     commercial-management / mixed-use / development / general
```
Dedicated sub-pages per service (e.g. `/services/custom-homes`) are a natural Phase 2
once real project/service content exists — the hub is structured so it can split into
sub-pages later without changing IA.

## 2. Homepage section order
1. Header (transparent-over-hero → solid on scroll, mobile menu)
2. Hero — full-bleed image, "Built for generations.", two primary CTAs
3. Positioning statement (short editorial pull-quote)
4. Two Paths split — the core hierarchy device (Build/Transform vs Manage)
5. Credibility strip — 20+ years, restrained numerals, not dashboard-style stat cards
6. Services overview — three grouped categories, links to /services
7. Featured Projects — large-image teasers, links to /projects
8. Philosophy / legacy narrative
9. Service area — Toronto/GTA + Hamilton, Niagara, Guelph, London
10. Inquiry CTA band → /contact
11. Footer

## 3. Design direction
Luxury editorial/architectural. Full-bleed photography, generous negative space, hairline
rules instead of card shadows, sharp-to-barely-rounded corners (2–4px), asymmetric
layout moments (the two-path split, offset image/text blocks) instead of centered
template rhythm. Motion limited to fade/slide-on-scroll and 1px underline hovers —
no parallax gimmicks, no bounce easing, no gradients.

## 4. Typography
- Display serif (headlines only): **Libre Caslon Display** — classic, architectural,
  hospitality-grade authority. Reads "legacy," not "startup."
- Body/nav/UI: **Inter** — clean, neutral, highly legible at small sizes for nav/labels/forms.
This pairing intentionally avoids Fraunces (already used for Arcubed Label) so client
brand identities stay visually distinct from each other.

## 5. Color system — FINALIZED (client-approved exact values)
**"Modern Estate Luxury": deep charcoal / warm ivory / brushed bronze / stone beige.**
Bronze used sparingly (labels, hovers, small marks only) so it reads as material/
craftsmanship, not the black-and-gold luxury-real-estate cliché.
```
--ink:        #161616   deep charcoal (text, dark sections, header/footer)
--charcoal:   #232120   secondary dark surface
--ivory:      #F5F1E8   warm ivory — main backgrounds, light sections, cards
--stone:      #C8BBA6   stone beige — secondary backgrounds, subtle accents
--bronze:     #A67C52   brushed bronze — logo accent, borders, small highlights
--bronze-deep #7C5D3E   darkened bronze for AA-safe text on light backgrounds
```
Contrast-verified (WCAG AA): bronze-on-ink 4.85:1, bronze-deep-on-ivory 5.33:1,
ink-on-ivory 16.05:1. `.service-group` hover state overridden to `--ink` text
(bronze-deep-on-stone falls to 3.18:1, below AA at label size).

## 6. Logo — APPROVED and integrated
Client-approved KB Monogram (square-framed gold "K" mark, "KINGSBRIDGE GROUP"
wordmark, "CREATE · BUILD · MANAGE" tagline). Source file received
(`02_Branding/Codex Image Aug 18, 2026, 05_09_38 PM.png`) and processed —
never hand-traced or recomposed, only transparency-keyed and, for the dark
variant, recolored (black wordmark → ivory) so it reads on dark surfaces;
the gold mark itself was never touched.

Generated assets in `assets/img/logo/`:
- `kingsbridge-logo-light-bg.png` — full lockup, original colors, transparent bg
- `kingsbridge-logo-dark-bg.png` — full lockup, wordmark recolored ivory, transparent bg
- `kingsbridge-icon.png` — mark only (gold K in square), transparent bg

Integrated into:
- `partials/header.html` / `partials/footer.html` — icon crop + existing
  CSS-typeset wordmark (the full vertical lockup doesn't fit a nav bar;
  icon + type is the standard compact treatment and doesn't alter the mark)
- `.intro-veil` (index.html) — full dark-bg lockup, fade + scale reveal,
  gold line beneath (see `experience.css`)
- Page-transition veil (all pages) — icon mark, quick fade, ~280ms
- `assets/img/favicon.ico` / `favicon-16/32/48/64/180/192/512.png` /
  `apple-touch-icon.png` — generated from the icon crop on an obsidian
  rounded-square backing for legibility at tab size
- `assets/img/og-image.jpg` — dark-bg lockup composited on the brand gradient

## 7. Reusable component plan
Given no build step, "components" are consistent markup blocks sharing one CSS file,
plus a lightweight JS partial-loader so header/footer aren't hand-duplicated per page:
- `assets/css/tokens.css` — color/type/spacing custom properties
- `assets/css/base.css` — reset, typography, layout primitives, motion utilities
- `assets/css/components.css` — header, mobile menu, buttons, section-header pattern,
  two-path split, stat strip, service groups, project cards, philosophy block,
  CTA band, footer
- `assets/js/include.js` — fetches `partials/header.html` / `partials/footer.html` into
  every page (single source of truth for nav/footer edits)
- `assets/js/main.js` — scroll header state, mobile menu toggle, scroll-reveal, active
  nav highlighting
- `assets/js/projects-data.js` — the projects data model (below), consumed by
  `/projects` and `/projects/project`

## 8. Data/content model
```js
// Project
{ slug, title, location, propertyType, scope, status, year, summary, description,
  heroImage, gallery: [] }

// Service group (static, curated — not data-driven)
{ groupName, groupSlug, intro, services: [{ name, description }] }
```
Projects are data-driven now (JS array) specifically so the index/detail template can
later point at a real API/CMS without touching markup — see §10.

## 9. Route structure
`/`, `/services/`, `/projects/`, `/projects/project/?slug=`, `/about/`, `/contact/`.
`cleanUrls: true` in the existing root `vercel.json` only applies to the root deploy;
Kingsbridge's own folder structure keeps `index.html` per directory so it works
identically whether served from this repo's Vercel project or split out later.

## 10. Future portal / property-management integration
Marketing site stays fully static and public — no auth here. When a client/owner
portal is needed, build it as a **separate authenticated app**, following this repo's
existing precedent (`platform/` is already a Next.js app with real auth/DB for LYNQ
Office). Link to it from the marketing site as "Client Login" once it exists; never
embed portal logic into the static site. Planned feature breakdown (not built yet):

- **Property owners:** Properties, Documents, Reports, Maintenance Requests, Communication
- **Homeowners (build/renovate clients):** Renovation Progress, Project Timeline, Photos, Approvals
- **Internal (Kingsbridge staff):** Leads, CRM, Projects, Maintenance, Clients, Reporting
- **AI features:** Website assistant, property inquiry assistant, lead qualification

The contact form should post to a serverless function under `api/` (or a simple mail
relay short-term) with an inquiry-type field that already matches these future CRM
lead categories — build-home / renovate / residential-management /
commercial-management / mixed-use / development / general — so wiring it into LYNQ
Office CRM later is additive, not a rewrite. Project data already being modeled as
structured JS objects (§8) means migrating to a real database is a data-source swap,
not a redesign.

## 11. Assets/content still needed from client
- Real photography/video: hero exterior, interiors, renovation before/after,
  completed developments, managed-property exteriors, a family/team portrait
  for About, and a short muted background clip for the homepage hero
- 4–6 flagship projects with real location/scope/type/year/status
- Company history detail for About (founding story, names to feature, milestones)
- Licenses/insurance/certifications if they should appear as trust markers
- Confirmed service-area list (exact cities/regions)
- Contact routing (phone/email per inquiry type, office address if applicable)
- Testimonials/client quotes, if available
- **Live production domain** — sitemap.xml, robots.txt, and every canonical/
  OG/Twitter meta tag currently use the placeholder `https://www.kingsbridgegroup.ca`.
  Swap this for the real domain before launch (single find-and-replace across
  the 6 page `<head>` blocks + `sitemap.xml` + `robots.txt`).

## 12. Implementation order
1. Repo/convention inspection ✓
2. Client folder scaffold (01–08) ✓
3. Design tokens + base + components CSS ✓
4. Shared header/footer partials + include.js loader ✓
5. Homepage — all 11 sections, premium placeholder photography (styled gradient/photo
   placeholders, never mislabeled as real) and positioning-accurate copy ✓
6. Nav/mobile menu/scroll interactions ✓
7. Lightweight on-brand stub pages for Services/Projects/About/Contact so nav never
   dead-ends, full build deferred to next round ✓
8. *(next round, not built yet)* full Services, Projects (data-driven), About, Contact
   pages; real client assets once received
