# Arcubed Label — Customer-Facing UX Direction (Phase 1)

Status: design direction only. No code, no admin/backend. Builds on
`06_Website_Code/development-plan.md`.

Design language across all pages: warm neutral background (not stark white),
generous whitespace, large uncropped photography, soft/rounded swatches and
buttons, subtle crossfade/slide animation only (no bouncy/playful motion), no
dashboard chrome — no star ratings, sale badges, countdown timers, filter
sidebars, or table-like layouts. Text is short, single lines, editorial in tone.

---

## Home

**Order of sections:**
1. Full-bleed hero (lifestyle photo/video) — one short brand line, one CTA ("Shop the Collection")
2. Signature/bestseller bags — 3-4 large image-forward cards
3. "Made by hand" brand statement — one short line, maybe a process photo
4. Shop by style — big tappable photo tiles (Totes / Crossbody / Mini, etc.)
5. Instagram grid embed — social proof, "As seen on @arcubedlabel"
6. "Make it yours" customization teaser — one line + colour swatches, links into a bag
7. Minimal footer — nav, Instagram, contact, newsletter

**What the customer sees:** an editorial fashion page, not a storefront — photography does the talking, almost no paragraph copy anywhere.

**Interaction:** desktop hover on product cards reveals price + a second lifestyle shot; tapping a style tile jumps into Shop pre-filtered; Instagram tiles open a lightbox or link out.

**Mobile:** hero becomes one full-width image with text overlaid on the lower third; product strip becomes a horizontal swipe carousel; style tiles become a 2-column grid; Instagram becomes a horizontal scroll strip.

---

## Shop

**Order of sections:**
1. Small eyebrow title ("The Collection") — no heavy filter bar
2. Optional lightweight filter as text pills (style/size only) — not a sidebar
3. Product grid — large photography, 2 columns mobile / 3-4 desktop

**What the customer sees:** a lookbook-style grid. Each card shows a starting price ("From $X") and, if relevant, a small "customizable" mark — no sort dropdowns, no ratings.

**Interaction:** desktop hover cycles the card between the main shot and a lifestyle shot; tapping any card opens the Product/Customizer with that style pre-selected.

**Mobile:** 2-column grid, single static image per card (no hover-cycle — not needed on touch), tap opens the product page directly.

---

## Product / Customizer — the centerpiece

This is the page the whole experience is built around. It should feel like **playing with the actual bag**, not filling out a form: no numbered steps, no progress bar, no "Next" button. Everything is a tappable swatch or photo chip, and the image updates instantly.

**Layout:**
- **Desktop:** split screen — large sticky image on the left, a single continuous scrollable option panel on the right.
- **Mobile:** image pinned at the top (roughly half the viewport), option panel scrolls underneath it, so the bag is always visible while customizing.

**Order of sections in the option panel (all visible together, not gated behind steps):**
1. Bag name + one-line description + starting price
2. **Colour** — small swatch circles (not a dropdown), tap applies instantly, selected swatch gets a soft ring
3. **Size** — 2-3 pill buttons, tapping shows one short line of context under it (e.g. "Fits a 13" laptop") — no separate size chart page needed for something this simple
4. **Strap / handle** — small square photo thumbnails, not text labels, since this is a visual decision
5. **Add-ons** — toggle chips, each a tiny photo + name + "+$X", tap to add, tap again to remove; multiple can be selected at once
6. **Running total** — large, clear, ticks up/down with a small animation whenever something changes
7. **Add to Bag** — full-width primary button, sticky on mobile
8. Below the fold, collapsed by default: Materials & Care, Sizing details, Production time — kept out of the main flow so text never competes visually with the customization itself

**What happens when the customer interacts:**
- Tapping a colour swatch crossfades the main image in under 300ms — no page reload, no "preview" button.
- Tapping a strap/handle thumbnail swaps that layer on the image the same way.
- Toggling an add-on fades in a small overlay on the image if it's visually representable (e.g. a charm), and always updates the price immediately.
- A thin thumbnail strip under the main image (front / detail / back) lets the customer look closer — the front angle stays live/dynamic with their choices, other angles are static detail shots.
- If an option is unavailable for the current combination, it's shown disabled with a short inline note, never just removed — customers shouldn't wonder where an option went.

**Mobile behavior:** image pinned/visible at the top while the panel scrolls; a sticky bottom bar always shows the current total and the "Add to Bag" button, so the customer never has to scroll to check the price.

---

## Cart

**Order of sections:**
1. Small header ("Your Bag")
2. Line items — each shows the **actual customized thumbnail** (not a generic icon), style name, every selected option as one readable line ("Colour: Terracotta · Size: Medium · Strap: Braided · +Gold Charm"), price, quantity stepper, "Edit" and "Remove"
3. Order summary — subtotal, shipping estimate (or "calculated at checkout"), a repeated production-time reminder line, total
4. Full-width "Checkout" button
5. One small reassurance line under it ("Handmade to order · Ships in 2-3 weeks")

**What the customer sees:** their real, personalized bag — reinforcing that this is a made-for-them item, not a SKU.

**Interaction:** quantity changes recalculate instantly; "Edit" reopens the Customizer pre-filled with their exact selections; "Remove" shows a brief undo toast rather than deleting instantly.

**Mobile:** cart opens as a slide-over drawer from anywhere on the site (so adding to bag never forces a full navigation away) plus a dedicated full page for final review before checkout; sticky bottom "Checkout" bar.

---

## Checkout

**Order of sections:**
1. Order summary — same customized-thumbnail treatment as cart (product stays visible through the whole funnel); collapsible accordion on mobile, always-visible sidebar on desktop
2. Contact info
3. Shipping address
4. Shipping method (if more than one option exists)
5. Payment (Stripe)
6. Optional gift note / order note — one line, keeps the boutique feel
7. Final production-time + policy reminder directly above the pay button — last trust checkpoint before payment
8. "Place Order"

**What the customer sees:** a clean, single-column, payment-only flow. Quantity/option edits are locked here (send them back to Cart to edit) so checkout stays fast and simple.

**Interaction:** standard validation, address autocomplete if feasible; order summary is read-only.

**Mobile:** order summary collapses into a tappable "Order summary ▾" above the form so payment fields aren't pushed down the page; sticky "Pay" button.
