# Open Questions — BYOOT

Everything below must be obtained from the client before build starts.
Nothing here is answered yet.

## Listings data
- Which feed powers the ~43,000 listings: MLS, IDX, CREA DDF, a third-party
  aggregator API, or a database the client controls? Name the exact source.
- Under what agreement? Get the actual licence/data agreement document, not
  a paraphrase.
- Feed credentials (API keys, IDX/DDF access, whatever the source requires).
- Brokerage identification required for attribution/display compliance
  under that agreement.
- Any display rules, caching limits, or retention restrictions tied to the
  feed (e.g. "photos may not be cached beyond N days," "must show listing
  brokerage on every card") — get these in writing, don't infer them.

## Assets
- Real photography/video for brand and marketing use (not listing photos,
  which come from the feed).
- Brand assets: logo source files, any existing brand guide, color/type
  direction if one already exists.

## Decisions
- Who signs off on design direction on the client side — a name, not a
  role.

## Tracking / migration
- Confirm intent for the Facebook Pixel (`945117611453011`) currently live
  in production: carry it forward as-is, or replace it — and with what.

## Still to add as the audit proceeds
This list will grow once `BYOOT_AUDIT.md` is unblocked and the codebase
audit surfaces concrete gaps (env vars needing real values, third-party
services requiring new credentials, etc.).
