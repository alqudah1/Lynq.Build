# BYOOT — Listings Data Constraints (v2)

**Supersedes v1.** v1 assumed CREA DDF. The audit found otherwise: BYOOT runs on a
**direct TRREB feed via PropTx/AMPRE's RESO Web API**, with a separate VOW-tier path for
sold data. Different rulebook, different constraints. Discard v1.

**Status:** Compiled from public documentation. The client's signed agreements are not in
the repo and likely won't be available. Everything below is a working assumption until
those are read. Not legal advice — TRREB and the client's Broker of Record are the
authority.

## 1. What changed from v1, and why it matters

| | v1 assumption (CREA DDF) | Actual (TRREB/PropTx) |
|---|---|---|
| Attribution | "Powered by REALTOR.ca" logo mandatory | **Not applicable.** TRREB has its own disclaimer, which the site already renders |
| Photos | CREA watermarks mandatory | No CREA watermark requirement — **photography is ours to art-direct** |
| Sold data | Unavailable | **Available** via VOW tier — but registration-gated |
| AI rewriting listing text | DDF Rule 3(a) prohibits | TRREB rules govern instead; audit confirms the code doesn't do it anyway |

The headline: **the redesign has more visual freedom than v1 implied.** No mandatory
third-party logo on every card, no forced watermarks. Immersive photography is on the
table.

## 2. The three agreement tiers

- **IDX** — active listings, public, no visitor registration required.
- **VOW** — historical and sold data, **registered users only**.
- **DLA** — own listings only. Not what BYOOT is doing.

BYOOT's env vars (`TREBB_API_TOKEN` + `TREBB_VOW_TOKEN`) indicate both IDX and VOW are in
play. That split is architecturally load-bearing.

## 3. The VOW gate — the constraint most likely to be violated by a redesign

VOW data cannot be shown to an anonymous visitor. Access requires a registered user
verified as a **bona fide consumer** — someone with genuine interest in buying, selling,
or renting. The production pattern in Ontario (HouseSigma is the known example) is a
registration questionnaire plus explicit acknowledgment; users who decline the bona fide
consumer acknowledgment are cut off from VOW data.

Design consequences, hard walls not preferences:

- Sold prices, price history, and days-on-market are **behind a login**. Any hero
  treatment, comparison feature, or AI insight surfacing sold data on a public page is
  non-compliant regardless of how good it looks.
- The registration wall is a **designed moment**, not an afterthought — the biggest
  conversion event on the site and legally mandatory. Worth real design effort.
- AI search must know the current user's tier and **degrade gracefully**. An AI that
  mentions a sold comp to a logged-out visitor is a compliance failure emitted by a
  language model, the hardest kind to test for. Tier-awareness belongs in the retrieval
  layer, not the prompt.

**Verify in the current build:** is the VOW path actually gated behind auth today, and is
there a bona fide consumer acknowledgment? The audit confirmed a VOW path exists; it did
not confirm the gate.

## 4. Attribution gap found in the audit

The listing brokerage name is captured during sync but not displayed. Under TRREB IDX
rules, listing brokerage attribution on displayed listings is a standard requirement. The
TRREB disclaimer is rendered, so someone was paying attention to compliance — this looks
like an oversight rather than a decision.

→ Treat brokerage attribution as a **required element in listing card and detail layouts
from the first mockup.** Cheap now, ugly to retrofit after client approval. Confirm exact
wording against the signed agreement if it ever becomes available.

## 5. The registered-URL problem — a launch and workflow blocker

TRREB/PropTx agreements are **per-URL**. URLs must be live, properly identified, cannot be
duplicated across active agreements, and cannot be placeholder pages unless they disclose
brokerage name and address. All agreements are signed by the **Broker of Record**, not the
developer.

- **Vercel preview deployments serving live TRREB data are a problem.** Every PR preview
  is a new unregistered URL displaying MLS data. Resolve before the first preview deploy.
- Mitigations to evaluate: synthetic listing data in preview environments, IP/password
  protection on previews, or registering a staging domain on the agreement.
  Recommendation: **synthetic data in non-production environments** — sidesteps the
  question entirely and makes tests deterministic.
- Any domain change at launch requires the Broker of Record to file it. External
  dependency, external timeline. Find out early.

## 6. AI architecture guidance

The audit confirmed the existing AI is genuine — Claude Haiku tool-use parsing natural
language into structured filters, `PublicRemarks` stored as-is and never rewritten. Good
foundation, clean compliance position. Keep it.

- **Safe and expandable:** natural language → structured filters → semantic retrieval →
  display original listing content, ranked well. Intelligence lives in the matching.
- **Needs written permission before shipping:** AI-generated summaries or rewrites of
  listing descriptions. Current code doesn't do this; if the brief asks for it, get it in
  writing first.
- **Safest high-impact surface:** neighbourhood and area insights built from non-MLS data
  — census, transit, schools, amenities, walkability. Not derived from another brokerage's
  listing content, and genuinely useful.
- **Embeddings are derived data.** Whatever we index must be purgeable per-listing and in
  full, and must respect the IDX/VOW split — a single undifferentiated vector store over
  both tiers will leak VOW content into public results.

## 7. To obtain from the client — ranked

1. The signed TRREB/PropTx agreements, all tiers, in full
2. Broker of Record contact and confirmation of who can file URL changes
3. Confirmation of which URLs are currently registered
4. Written confirmation of what AI processing is permitted
5. Feed credentials and PropTx/AMPRE technical documentation
6. Brokerage identification details for attribution display

Sources: Repliers (TRREB/PropTx data agreement; DDF compliance), HouseSigma (TRREB VOW
restrictions), TRREB Competition Tribunal FAQs, NAR VOW policy, CREA DDF Policy and Rules.
