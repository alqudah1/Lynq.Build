# Client Brief — BYOOT

**Status: PRE-AUDIT.** Everything below is observed from the live production
site (byoot.ca), not client-confirmed. Nothing here should be treated as
verified fact until the client confirms it directly or the codebase audit
(`BYOOT_AUDIT.md`, currently blocked pending repo access) verifies it.

## Client
BYOOT — Ontario real estate listings platform (byoot.ca)

## Live tagline
"Where Every House Becomes Home"

## Claimed scale
43,000+ Ontario listings

## Stated coverage
- Durham Region
- Hamilton
- Kitchener-Waterloo
- Niagara

## Current "AI-powered search"
The live site markets an "AI-powered search." What this actually means
technically (real model/embeddings vs. keyword filtering with AI branding)
is unverified — the codebase audit will trace the actual code path and
report bluntly.

## Tracking currently live in production
Facebook Pixel, ID `945117611453011`. This must be either preserved or
deliberately, explicitly replaced during migration — not silently dropped.

## Engagement scope
Full transformation:
- New brand
- Immersive front end
- Real AI search (as opposed to whatever the current implementation turns
  out to be)
- Rebuilt architecture

## Classification note
Per `LYNQ_ENGINEERING_STANDARD.md` B.1, BYOOT classifies as a **real
product** (user-facing data platform at scale, not a static brochure site)
— not a standard LYNQ static client site. See
`06_Website_Code/README.md` in this client folder for what that means for
where the code will actually live.

## Open items
See `open-questions.md` in this folder for everything still needed from the
client before build starts.
