# BYOOT Transformation Plan

Inputs: `BYOOT_AUDIT.md`, `clients/BYOOT/01_Client_Info/BYOOT_DATA_CONSTRAINTS.md`, `LYNQ_ENGINEERING_STANDARD.md` (B.1, Part F). Decisions already made (scope, placement, live-production constraint, no signed agreements) are treated as fixed inputs here, not re-argued.

**Register note, per your instruction not to split the difference:** this is written primarily as a build-decision document — technical, direct, assumes you're the reader. Sections D and F are the two places a client would plausibly see this material directly; both carry an explicit **Client framing:** callout where the internal and client-facing versions of a point genuinely differ. Everywhere else, one register.

---

## A. Target architecture

**Framework: Next.js (App Router) + TypeScript.** Not a best-practices default — the audit's Section D/H finding is specific: `PropertyDetail` (the ~43k-page surface) is client-rendered off a shared SPA shell with no JSON-LD and no server-delivered meta tags, and the audit names this as the biggest concrete Core Web Vitals/SEO risk in the current build. Next.js with SSG/ISR on listing pages fixes exactly that finding, not a hypothetical one. It also matches `platform/`'s stack, which is what makes Part F's "copy the patterns" instruction cheap instead of a translation exercise.

**Data layer: Postgres on Neon, Drizzle ORM.** Same reasoning — this is what the code being copied (auth/authz/http/audit/rate-limit) is written against. A different ORM/DB means rewriting the copied code, not reusing it.

**Where the TRREB/PropTx ingest lives:** a dedicated sync module (`src/lib/listings-sync/`), not a chain of ad hoc serverless functions. The audit's git log for the old system is unusually informative here — `trebb-reconcile` alone has ~10 commits fixing chunk sizing, statement timeouts, resumability, and write idempotency. That's not bad engineering, that's the real shape of the problem: **a single sync pass cannot reliably reach 43k rows inside one serverless invocation's wall-clock limit, and a naive retry can double-write or skip rows.** Design for that from day one instead of rediscovering it:
- **Incremental sync** — frequent (e.g. every 15-30 min), small pages, `ModificationTimestamp`-ordered, cheap.
- **Full reconcile** — less frequent, chunked, with a persisted cursor (a `sync_cursor` table, not an in-memory position) so a timeout resumes instead of restarting, and a `last_seen_active_at` sweep to catch listings the incremental pass silently missed (this exact pattern already exists in the old system for a reason — keep the reason, rebuild the implementation cleaner).
- **Alerting on failure** — the audit found none in the old system (`console.error` only). This is a cheap, concrete fix to build in from the start, not a phase-6 nice-to-have.

**IDX/VOW separation — at the data layer, not a flag:**
- `listings` — IDX-eligible fields only (active/pending/sold-status-without-price-history, respecting `InternetEntireListingDisplayYN`/`InternetAddressDisplayYN`). Publicly queryable.
- `listings_vow` — sold price, sold date, list-price history, historical DOM. FK to `listings.id`. **Never queried directly by a route, component, or AI tool.** The only access path is a single service function (`getVowData(userId, listingId)`) that checks session + a `bona_fide_consumer_ack_at` timestamp on the user record before running any SQL, and Postgres RLS on `listings_vow` itself as a second, independent enforcement layer — so a bug in the service function doesn't become a compliance incident. This is the same shape as `platform/`'s `requireTenantScopedResource`: scope in the query, never fetch-then-check. Full detail in Section C.

**Search infrastructure:** Postgres full-text + structured filters for the base case — at 43k rows, a dedicated search service (Algolia/Meilisearch/Typesense) is infrastructure the constraint "solo operator" doesn't justify yet. Add `pgvector` in the same Neon instance as a second retrieval path for semantic matching over listing description + structured facts — this is the concrete step from "AI parses your query into filters" (what the audit confirmed the old system actually does) to "AI understands what you're looking for," without standing up a separate vector database. **Embeddings are computed only over `listings` (IDX tier), never `listings_vow`** — per the constraints doc's explicit warning that an undifferentiated vector store leaks VOW content into public results. If a comps/evaluation feature needs to reason over sold data (mirroring the old `generate-evaluation` function), that's a separate, small, server-only embedding scope never exposed to the public search UI.

**Caching:** the actual feed-refresh/caching-window rule is UNKNOWN (Assumption Register #8) — so cache conservatively and configurably rather than assume a number. Short ISR revalidation windows on listing pages (minutes, not hours), no long-lived CDN caching of listing data responses, and continue hotlinking feed photo URLs rather than re-hosting/caching them (re-hosting opens a *new* compliance question — a retention window for cached photos — that hotlinking sidesteps entirely). If load or a signed agreement later justifies an image pipeline, that's an explicit future decision, not a default.

---

## B. Migration + cutover strategy

**This is not a code migration — it's a rebuild informed by an audit, and the plan should say that plainly rather than imply continuity that doesn't exist.** The audit's own finding (Section G: different framework, no design tokens, hand-rolled routing despite `react-router-dom` being a dependency, zero tests) means there's very little in the old Vite/React codebase that survives a port unchanged. What's actually worth carrying forward is domain knowledge, not files: the property-type/style/status normalization maps, the sqft-range-backfill logic, the IDX display-flag handling. Copy those as small, individually-reviewed reference files with a comment noting their origin (repo + commit hash), not as a git merge.

**Git history is not preserved via merge/subtree.** Merging BYOOT's history into `lynq.build` would permanently entangle the two repos' commit graphs — directly against the placement decision's own "extractable later without untangling" constraint. The old repo (client's GitHub, and the `../byoot-audit/` clone made for the audit) stays as a separate, citable reference throughout the build. If provenance matters later, it's `git@github.com:faisalhamla/byoot.git` at commit `5061cad` — that's a durable enough pointer without merging anything.

**What happens to the client's repo:** nothing, until cutover. It keeps serving byoot.ca unmodified through every phase below. Post-cutover: kept intact and deployable for a defined rollback window (see below), then frozen/archival.

**Production stays uninterrupted because the new app never touches byoot.ca until an explicit DNS step.** Development happens against a separate Vercel project throughout.

**Correction (amended after review — see Assumption Register #4 for the full reasoning):** an earlier version of this plan treated "the new app's domain needs its own TRREB/PropTx registration" as a hard, schedule-blocking dependency for Phase 1. That was wrong, and specifically wrong in a way worth recording rather than quietly fixing: **cutover is a DNS repoint of the already-registered `byoot.ca` to new infrastructure — the registered URL never changes, so production needs no new registration at all.** The registration question only ever applied to *pre-cutover validation against real feed data on some other, non-production URL* — and on inspection, almost none of that validation actually requires a public URL in the first place (see Section C). Phase 1 is not blocked on Broker-of-Record URL registration. It never needed to be.

**Cutover, as an explicit, reversible step:**
1. **Pre-cutover gate:** new app fully built; sync correctness, VOW-gate logic, and load characteristics verified against real feed data via backend/API-level integration tests (no public URL required — see Section C); all in-scope flows pass a defined checklist; sync alerting confirmed live; public URL structure matches or 301s from the old site (see below).
2. **Lower the DNS TTL on byoot.ca a few days ahead of cutover** specifically so a rollback, if needed, propagates in minutes rather than being stuck behind a stale 24-hour TTL.
3. **Cutover = DNS repoint,** old Vercel project → new Vercel project. Nothing else changes at that instant.
4. **Rollback = DNS repoint back.** Clean and cheap *only* before meaningful user-generated data (new leads, new registrations, new CRM activity) accumulates in the new system. Define a **48-72 hour hypercare window** post-cutover where rollback is still treated as free; past that, a rollback becomes a data-reconciliation project, not a DNS flip, and should be named as such rather than assumed to stay simple indefinitely.

**What could go wrong, and how it's caught:**
- **Sync misbehaves against the real feed** (rate limits, credential mismatch, unexpected field shapes) — caught by the alerting built in Section A and by the pre-cutover backend integration tests (Section C), not by a client noticing stale listings.
- **DNS propagation inconsistency** (some visitors see old site, some see new, mixed session state) — caught by synthetic multi-region uptime checks run specifically during the cutover window, not just normal monitoring.
- **SEO regression from URL structure changes** — the current site's public routes (`/toronto`, `/oakville`, `/rent-*`, `/bungalows/*`, `/p/:slug`, etc. — see the audit's `vercel.json` breakdown) should be preserved 1:1 in the new app, with 301s for anything deliberately restructured. This is a hard requirement carried into the Phase 2 roadmap item below, not a nice-to-have.
- **Existing user credentials don't carry over** — the old system uses Supabase Auth directly; the new system uses `platform/`'s copied OAuth pattern. These are structurally different identity systems. See Assumption Register #5 — this needs a decision (forced re-registration vs. a bridge period) before cutover, not during it.

---

## C. Compliance by design

### The VOW gate

Covered structurally in Section A's data-layer split. To restate only the enforcement chain, since that's the part the brief specifically asked to be verifiable as "structurally incapable," not policy:

1. `listings_vow` is a separate table, never joined into a public query.
2. The only access path is `getVowData(userId, listingId)` — checks authenticated session, then checks `bona_fide_consumer_ack_at IS NOT NULL` on the user row. Either check failing returns nothing (not redacted data, not an error revealing the data exists).
3. Postgres RLS on `listings_vow` as an independent second gate, keyed to the same claim — so a bug in the service function is not a compliance incident by itself.
4. **The AI search tool never decides tier.** The calling route resolves the user's tier via the same auth/ack check *before* invoking the AI layer, and only passes VOW data into the model's context if that check already passed. The model cannot be prompted, jailbroken, or hallucinated into surfacing data it was never given — because for a logged-out or non-acknowledged user, that data was never fetched, full stop. This is the specific mechanism that satisfies "not in the prompt": the gate happens one layer below the AI, in ordinary application code, before the AI is ever invoked.
5. The registration/acknowledgment flow itself is a first-class designed screen (per the constraints doc's framing — the biggest conversion event on the site and a legal requirement at once), built in Phase 3, not bolted onto a signup form as a checkbox.

**Open item to verify before Phase 3 starts:** whether the *old* system's VOW path is actually gated today. The audit could confirm the VOW code path exists; it could not confirm the gate is enforced. If it isn't, that's a live compliance exposure on the current production site, independent of this rebuild's timeline, and worth telling the client now rather than waiting for Phase 3.

### Brokerage attribution

Made structurally hard to omit, not just documented as a requirement:
- `list_office_name` becomes a **required, non-optional field** on the query that populates any listing card/detail component — not an optional column that silently renders blank if null.
- The shared `ListingCard`/`ListingDetail` components (built once, in `components/ui`, per Part F's shared-primitives pattern) take `brokerageName: string` as a required prop. In TypeScript strict mode, omitting a required prop is a compile error — the component cannot render without it, which is the actual mechanism, not a style guideline someone can forget to follow on a new page.
- Applies everywhere a listing renders: search results, detail pages, AI search result cards, and any share/OG-style page (the equivalent of the old `/p/:slug` pattern).

### The preview-deploy problem

Evaluated the three options as asked:

| Option | Verdict |
|---|---|
| Synthetic/seeded data in all non-prod environments | **Recommended.** |
| Password/IP-protect preview deployments (Vercel Deployment Protection) | Recommended *in addition*, not instead — free, trivial to enable, closes the gap for the rare case a preview genuinely needs real-feed testing. |
| Register a staging domain on the agreement | Doesn't actually solve the problem: Vercel generates a unique URL per PR, not one fixed staging domain. Registering one domain doesn't cover the per-PR pattern unless you abandon per-PR previews entirely, which gives up the reason to have them. |

Recommendation: **synthetic data everywhere, and no registered staging domain at all** — this is a firmer recommendation than the first pass of this plan made, after re-examining what "validate against real data" actually requires (prompted by a direct challenge to Assumption #4; see that entry for the full reasoning). Breaking down the three things pre-cutover validation needs to cover:

- **Sync correctness against live feed shape** — a backend/ETL concern. The sync job pulls from AMPRE and writes to Postgres; nothing about verifying that is rendered to a human visitor. Fully testable via integration tests run against the real feed, in CI or locally, with zero public URL involved. TRREB's per-URL registration rule governs pages that *display* listing data to visitors — it has no bearing on a server-side job that never renders anything.
- **VOW gate behaviour with real tokens** — same reasoning. Whether `getVowData()` correctly withholds sold data for a non-acknowledged user and returns it for one who's acknowledged is an assertion against a function's return value, not a rendered page. Testable the same way, same zero public-URL footprint.
- **Load characteristics at 43k rows** — a query-layer concern, not a display concern. Load-testing tools (k6, Artillery, etc.) hit an API endpoint directly; they don't need a rendered listing card, they need the query underneath it to be under load. Testable against the real, feed-populated database without a single page render.

None of the three actually require a public, registered, human-browsable URL. The one genuine remaining gap is **visual QA against real-world-messy data shape** — null fields, unusually long descriptions, zero-photo listings, odd characters — the kind of edge case synthetic fixtures might not think to include. Two mitigations, in order: (1) deliberately seed the synthetic fixture set *with* those edge cases rather than only clean happy-path data, which closes most of the gap for free; (2) for whatever thin residual remains, treat it as part of the **48-72 hour hypercare window already defined in Section B**, on the real, already-registered `byoot.ca`, with rollback armed — rather than standing up a separate registered staging domain to chase a gap that's mostly closable another way. This costs nothing new (the hypercare window already exists) and never raises the registration question at all.

---

## D. Phased roadmap

Sequenced by dependency and by *uncertainty*, not by what's most visually impressive first — the sync pipeline and compliance gate are the two things most likely to blow up the schedule if left until late, so they're first.

**Client framing:** every phase below ends in something you can look at or click through, except Phase 0 — which produces a findings memo and an unblocked path forward, not a demo. That's deliberate: the riskiest unknown in this whole engagement is compliance access, not code, and it's cheaper to find out early than after months of building against a guess.

| Phase | Ships | Depends on | Effort band | Could block it |
|---|---|---|---|---|
| **0 — Compliance & access** | Findings memo: VOW-gate status on the live site, ideally the actual agreements | Broker of Record's availability | Days of active work, but calendar time depends entirely on the client/Broker | Broker of Record unresponsive or agreements genuinely unobtainable — see Assumption Register |
| **1 — Foundation: auth, data layer, real sync** | Password-protected internal view showing real synced listings running on the new architecture | **Not gated on Phase 0** (corrected — see Assumption Register #4′). Real-feed sync/VOW/load validation is backend-only and needs no domain registration, so this can start in parallel with Phase 0 rather than waiting on it | 2-3 weeks | Ordinary engineering risk only — the previously-flagged registration dependency didn't hold up |
| **2 — Public search + listing pages (IDX only)** | The first real client-facing milestone: browsable, branded search + listing detail, SSR/SSG, brokerage attribution live from the first build | Phase 1 | 2-4 weeks | Brand direction not finalized ("immersive" undefined — see Pushback #6) |
| **3 — VOW gate + registered-user flow** | Side-by-side logged-out vs. logged-in demo showing the gate working | Phase 1, ideally Phase 2 for UI polish | 1-2 weeks | Confirmation of whether old-system gate is currently enforced (Section C) |
| **4 — Agent CRM** | Agent login + core lead/contact/deal workflow, running in parallel with the old CRM | Phase 1 | **4-8+ weeks — genuinely unscoped, see Pushback #2** | Scope not yet negotiated with client; largest unknown in the entire plan |
| **5 — Telephony + e-sign** | Twilio voice/SMS and e-signature reconnected to the new system | Phase 1, partially parallel with Phase 4 | 2-4 weeks | Whether Faisign (in-house e-sign) is rebuilt or replaced — a real decision, not a given (Pushback #5) |
| **6 — Parallel-run + cutover** | Live cutover per Section B, plus the hypercare window | All of the above | 1-2 weeks active + 48-72h hypercare | Anything in Section B's "what could go wrong" list |

**Total, said plainly:** still 4-7+ months for a solo operator, with Phase 4 as the dominant unknown — the Assumption #4 correction doesn't shrink the engineering estimate for Phase 1 (2-3 weeks either way, same work). What it removes is a piece of *schedule risk*: Phase 1 was previously described as waiting on an external, unbounded-timeline dependency (Broker-of-Record URL registration) before it could reach its demo milestone; it no longer waits on anything external and can start immediately. So Phase 1's calendar start is earlier and more certain than the original plan implied, even though its duration once started is unchanged. This is a rebuilt platform, not a redesign — the timeline should read that way to the client from the start, not get discovered in month three.

---

## E. Assumption register

| # | Assumption | If wrong | Cost to correct |
|---|---|---|---|
| 1 | Feed is TRREB via PropTx/AMPRE, not CREA DDF or another aggregator | The entire IDX/VOW compliance design (Section C) is built against the wrong rulebook | High-impact but lowest-probability item here — this has the strongest evidence behind it of anything in this register (audit Section B: env var names, base URL, RESO field set, VOW-specific functions). The *pattern* (gate sensitive data at the data layer) stays good practice regardless; the specific rules would need re-deriving |
| 2 | The old system's VOW path is not confirmed to be properly gated today | If it already is, no harm — the new design is good practice either way. If it isn't, that's a live compliance exposure on production right now, independent of this rebuild | Low cost to the plan itself; potentially urgent for the client to know regardless of rebuild timeline |
| 3 | Synthetic preview data is an acceptable mitigation without explicit Broker-of-Record sign-off | The specific agreement may require something more particular we don't know about | Low — swap to Vercel Deployment Protection + one registered staging domain; no architecture or data-model change needed |
| 4 | **Superseded — see below.** ~~The new app's domain needs fresh TRREB/PropTx registration, separate from byoot.ca's existing one, before real-data testing~~ | — | — |
| 4′ | **Amended.** Corrected after direct challenge to the original #4 (kept here rather than silently edited, per instruction to record the reasoning either way). Two claims were bundled together in the original assumption, and they resolve differently: (a) *does production need re-registration at cutover* — **no.** Cutover is a DNS repoint of `byoot.ca` to new infrastructure; the registered URL is unchanged, so this part of the original framing was simply wrong, not a risk that needed hedging. (b) *does any real-data validation need a public, registered, non-production URL before cutover* — on inspection, **also no**, for the three concrete things pre-cutover validation actually needs to cover (sync correctness, VOW gate logic, load characteristics — see Section C): all three are backend/API-level concerns, testable with zero page rendering and zero public URL. The one genuine residual gap (visual QA against real-world-messy data shape) is closed by seeding synthetic fixtures with deliberate edge cases, with any thin remainder absorbed into the already-planned post-cutover hypercare window rather than a new registered domain. **Net effect: this is no longer a schedule risk at all, let alone the largest one** — it was a real question worth asking, but the answer removes it from the critical path rather than sitting on it. What *does* remain genuinely worth asking the Broker of Record about in Phase 0 (unrelated to the registration question) is the actual VOW-gate-enforcement status on the live site today (#2) and getting the real signed agreements (#1) | If a subdomain/path on `byoot.ca` is ever used for anything real-data-adjacent later and turns out to count as a distinct URL under the actual agreement, that's a narrow, cheap-to-resolve question at the time, not a standing risk to carry now | Effectively zero — the corrected design (synthetic data + backend-only real-data testing + hypercare) needed no new infrastructure or registration step to begin with |
| 5 | Existing user credentials (Supabase Auth) cannot cleanly carry over to the copied `platform/` OAuth pattern | If they can bridge, migration is simpler than planned. If not, every existing agent/renter/brokerage-manager account needs forced re-registration or a dual-auth bridge period | Real UX friction and support load concentrated in the hypercare window — not primarily an engineering cost |
| 6 | No mandatory REALTOR.ca logo / CREA watermark requirement under TRREB rules specifically (per the constraints doc) | A shipped design without those elements needs retrofitting across every listing template | Moderate if caught in Phase 2; expensive and client-visible if caught post-launch |
| 7 | Postgres full-text + pgvector is sufficient at 43k listings without a dedicated search service | Query latency/relevance under real usage proves inadequate | Moderate — a real infra addition mid-project, not catastrophic, but should be load-tested in Phase 2 rather than assumed indefinitely |
| 8 | Photo hotlinking (no re-hosting) remains an acceptable posture rather than a licensing violation | Need an image proxy/caching layer, which immediately raises the unresolved caching-retention-window question again | Moderate-to-high if discovered late — touches both architecture and an unresolved compliance question at once |

---

## F. What I'd push back on

1. **The realistic timeline (4-7+ months) is almost certainly longer than what "new brand + immersive front end + real AI search + rebuilt architecture" sounds like it should take, and that gap should be closed with the client now, not in month three.**
   **Client framing:** say directly that Phase 4 (the agent CRM) alone likely exceeds whatever timeline was implied by "redesign," because it's not a redesign — it's rebuilding a working brokerage back-office system, and that's genuinely large, independent of how well-run the engagement is.

2. **Scoping Phase 4 without first asking the client which CRM features their agents actually use daily is a mistake I'd avoid making even under schedule pressure.** The audit surfaced a lot of surface area — deals, tasks, off-market listings, agent applications, brokerage-manager views, a 5,757-line AI ops agent. Rebuilding all of it 1:1 is almost certainly the wrong amount of scope; some of it may be vestigial. This needs a short, direct client conversation before Phase 4 gets an estimate, not an assumption that everything found in the audit is everything that matters.

3. **Silently porting both voice-AI providers, both email paths, and both mapping stacks (Section G/E findings) would be scope creep the client probably isn't asking for and shouldn't pay for twice.** This is a client decision to force explicitly before Phase 5, not a default carried forward because it existed in the old system.

4. **Superseded by the Assumption #4 correction — recorded rather than deleted.** This item originally argued for resisting the urge to start Phase 1 before Phase 0 finished, on the belief that real-data sync work needed Broker-of-Record-granted domain registration first. That premise didn't hold up (Assumption Register #4′): Phase 1's real-feed validation is backend-only and needs no registered URL, so it isn't actually blocked on Phase 0 and the two can run in parallel. What's still worth watching, for a narrower reason: Phase 0's other output — confirming the feed is genuinely TRREB/PropTx (Assumption #1) and whether the old system's VOW gate is actually enforced today (Assumption #2) — should still land **before Phase 3 ships the VOW gate publicly**, since those two specifically would invalidate that phase's compliance design if wrong. That's a narrower, later gate than "don't start real engineering until Phase 0 closes."

5. **Inheriting the in-house e-signature product (Faisign) as "just part of the rebuild" deserves its own explicit line item, not silent inclusion.** Maintaining a bespoke e-sign product going forward is a meaningfully different commitment than integrating an off-the-shelf one (DocuSign, Dropbox Sign). That's a real cost/scope conversation with the client, not an assumption.

6. **"Immersive front end" and "real AI search" are marketing-register phrases, not specifications, and Phase 2 shouldn't start design work against them un-anchored.** Get 2-3 concrete reference points from the client before that phase begins — otherwise this is precisely the vague-adjective-without-a-reference problem that causes rework, and it's avoidable for the cost of one question.
