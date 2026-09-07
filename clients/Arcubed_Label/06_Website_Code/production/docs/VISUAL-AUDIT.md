# Visual audit

Reviewed in a real browser at 1440, 768 and 375, full-page, with the whole
customer journey seen side by side rather than page by page.

## The finding that explained most of it

The site had **no locked palette**. `--bg` was `#faf6f1` (cream), `--ink`
`#2e2a26` (warm brown-black), `--muted` `#8a8078` (warm grey), `--line`
`#eae2d7` (cream). Only the homepage and Shop overrode those to white. Every
other route inherited a warm neutral family, which is exactly why the site
read as several separately designed pages rather than one brand. The header,
shared by every route, carried the cream ground too.

Secondary: **three type families** were in play (Fraunces, Bodoni Moda, Inter)
with Fraunces and Bodoni doing the same job, and `--radius: 20px` gave
configurator and cart panels a generic ecommerce card silhouette.

## Grades, before

| Page | Grade | Why |
|---|---|---|
| Homepage hero | STRONG | Rebuilt in the previous pass and holding |
| Homepage story | ACCEPTABLE | Reads correctly at each scroll state |
| Homepage collection | **WEAK** | A flat four-up grid in a different language from Shop, and its tiles linked to the product WITHOUT the colourway |
| /shop | ACCEPTABLE | Good colour rhythm, but rows did not resolve so it read as masonry |
| /product/* | **REBUILD** | Small object in a 68vh box, watermark invisible at 9% opacity, cramped strip of pill chips underneath. A configurator card |
| /cart | **REBUILD** | 104px thumbnails, grey widget summary, right half of the page empty |
| /checkout | ACCEPTABLE | Structure fine, but on cream |
| /ready-for-delivery | ACCEPTABLE | Navy, pink, navy rhythm works |
| /about | **WEAK** | Cream ground, off-system |
| /faq | **WEAK** | Sparse; footer occupied half the page |
| /contact | **WEAK** | Cream ground |
| Footer | ACCEPTABLE | Wordmark strong, but three link columns read corporate |

## What was done

1. **Locked one colour system.** Navy `#143562`, pale pink `#FFE0FD`, white.
   Every token is now a brand colour or a navy-derived tint, so no page can
   drift into a neutral by inheriting a default. `--radius` is 0.
2. **Locked one type system.** Bodoni Moda as DISPLAY (`--font-head` now
   resolves to it, so the ~50 existing rules joined the system), Inter as
   BODY and UTILITY. Fraunces removed.
3. **Product page rebuilt** around the object: full pink stage, product at
   62vw, name set across it at 13% rather than hidden at 9%, one editorial buy
   band on white, square controls.
4. **Colour swatches became photographs** of the actual colourway instead of
   named boxes. Most Arcubed colours have no confirmed hex and the metallics
   are defined by sheen, not a flat value, so a chip was either uninformative
   or a guess.
5. **One collection grid** shared by Shop and homepage (`CollectionGrid`), so
   the two cannot drift. This also fixed the homepage tiles losing their
   colourway in the link.
6. **Shop rhythm rebuilt** so every tile in a row resolves to the same height
   (span and ratio chosen together) and heights vary between rows.
7. **Cart rebuilt** as two zones with large product images on pink fields.
8. **Footer** given a material crop set into the field edge.

## Grades, after

| Page | Grade |
|---|---|
| Homepage hero | STRONG |
| Homepage story | STRONG |
| Homepage collection | STRONG (identical to Shop by construction) |
| /shop | STRONG |
| /product/* | STRONG |
| /cart | STRONG |
| /checkout | ACCEPTABLE, see weaknesses |
| /ready-for-delivery | STRONG |
| /about | ACCEPTABLE |
| /faq | ACCEPTABLE, still the thinnest page |
| /contact | ACCEPTABLE |
| Footer | STRONG |

## Remaining weaknesses

- **FAQ is still thin.** Five accordion rows on white. It is on-system and
  legible, but it is the one page with no image and little to look at.
- **About and Contact are on-system rather than art-directed.** They inherited
  the palette fix; they were not composed from scratch.
- **The full-photograph tiles** (both Locos, Vault Brown) carry their studio
  cream, which sits differently from the coloured fields around them. This is
  deliberate under the media policy, but it is visible.
- **Checkout** is correct and on-system but is the least distinctive surface.
</content>
</invoke>
