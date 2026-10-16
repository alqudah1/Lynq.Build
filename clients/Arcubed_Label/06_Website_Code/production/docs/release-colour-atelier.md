# Release checklist: Colour Atelier + colour workflow

Prepared 2026-10-15. Production (arcubed.shop) is unchanged until Mustafa
approves the release. The review build is at https://arcubed-review.vercel.app.

## What ships

| | Where | Status |
|---|---|---|
| Colour Atelier as the product page (all four bags) | /product/[slug] | built, tested, on review |
| Real colours only, recoloured on each bag's locked photograph; Silver & Gold shown in its own photograph | product page | built, tested |
| Rand's photographs of the chosen colour beneath the studio | product page | built, tested |
| Add to cart / edit from cart / phone buy bar | product page, cart | built, tested |
| Recoloured thumbnails for colours with no photograph (cart, checkout, confirmation) | cart, checkout, /order | built, tested (local) |
| Colour workflow: add, photograph, measure, calibrate, preview, review, approve, supplier, publish, on/off | /admin/colours | built, tested (local database) |
| Client demo (unchanged, review-only, 404 on production) | /atelier-preview | live on review |
| Admin studio + technical comparison (unchanged) | /admin/colour-lab | live on review |

Unchanged: prices, sizes, accessories, strap-or-chain rule, checkout, Cash
on Delivery (CliQ stays off), shipping, orders, admin orders, catalogue data.

## Awaiting approval

1. **Mustafa: release the product-page Atelier to arcubed.shop.**
2. **Mustafa: apply one database migration** (only needed for the colour
   workflow; the product page works without it).
3. **Rand: supplier colours** (see "Needed from Rand").

## Database change (one migration, not applied anywhere but the local test copy)

`supabase/migrations/20261015180000_colour_workflow.sql`:

- adds `public.colour_candidates` (RLS on, no policies, service role only)
- adds `publish_colour_candidate(uuid, uuid[])` and
  `set_product_colour_active(uuid, uuid, boolean)` (service role only)
- changes nothing that exists; safe while the shop is live

Tested: all 21 migrations apply from scratch in order (PGlite + PostgREST
14). The public role cannot read the table or call the functions. The full
workflow and an order of a published colour were run end to end against
that copy.

Apply (the ledger is mismatched, so **never `supabase db push`**):

```
cd clients/Arcubed_Label/06_Website_Code/production
supabase db query --linked -f supabase/migrations/20261015180000_colour_workflow.sql
supabase migration repair --status applied 20261015180000
```

Until it is applied, /admin/colours shows "Not switched on yet" and nothing
can change what the shop sells.

## Release steps

```
# from a checkout of the approved commit (a detached worktree is fine)
cd clients/Arcubed_Label/06_Website_Code/production
npm ci && npx tsc --noEmit && npm run lint && npm run build
vercel deploy --prod --yes
vercel alias set <new deployment URL> arcubed-preview.vercel.app
vercel inspect arcubed.shop                 # must show the new deployment id
vercel inspect arcubed-preview.vercel.app
```

Then on arcubed.shop: open each product page, change colour, add to cart, open
the cart and checkout (do not submit), check /admin/orders and /admin/colours
load. /atelier-preview must return "not found" on arcubed.shop.

## Rollback

```
vercel alias set <previous production deployment URL> arcubed.shop
vercel alias set <previous production deployment URL> arcubed-preview.vercel.app
```

The previous production deployment today is `dpl_EychWL86o9JFgWXNYBHPX1wUYRZa`.
The migration does not need rolling back (nothing reads the new table except
/admin/colours). If it must go:
`drop function public.publish_colour_candidate(uuid, uuid[]); drop function public.set_product_colour_active(uuid, uuid, boolean); drop table public.colour_candidates; drop function public.colour_candidates_touch();`
Colours already published stay in the catalogue as ordinary colours.

## Product and colour rules (enforced in code and database)

- Customers see and can order **only active catalogue colours** of each bag
  (`product_colours.active`); checkout re-checks on the server.
- Experimental preview colours never appear on the shop.
- A new colour is orderable only after: photograph measured → approved (named
  approver) → Rand's supplier confirmed → published to chosen bags.
- A colour goes only on bags of its own yarn material, and only where the
  bag's photograph can show it (Loco: nothing lighter than L* 45).
- Two-tone colours are not created through the workflow (one yarn per photo).
- Prices come only from the catalogue: a colour never changes the price.

## Needed from Rand

For each new supplier yarn:

1. a clear photograph of the yarn (daylight or the studio lights, a few cm of
   plain yarn filling most of the frame, no filter)
2. the colour's name as customers should see it
3. the yarn's material: metallic raffia (Nova, Mini Luna), matte cord (Vault),
   fringe cord (Loco), or say if it's a new material (a new material needs a
   photograph of a bag made in it)
4. which bags it should be offered on
5. confirmation that the supplier can provide it (and the supplier / yarn code)
6. her approval of the preview, which can be done in /admin/colours
