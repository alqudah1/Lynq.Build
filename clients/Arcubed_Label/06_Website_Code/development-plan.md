# Arcubed Label — Product & UX Architecture (Phase 1 Planning)

Status: architecture approved pending client review. No code written yet.

## 1. Site structure
Home · Shop/Collection · Product + Customizer · Cart · Checkout · Confirmation ·
Lookbook/Gallery · About/Story · FAQ · Contact · (Phase 2: Account/Order Tracking)

## 2. Customer journey
Instagram (UTM-tagged links) → Home/PDP → Shop → Product + Customize (style → size →
colour → pattern → strap/handle → add-ons → review) → Cart → Checkout → Confirmation.
Goal: digitize the trust/reassurance currently built through DM conversations —
clear visuals, clear price, clear production timeline, without feeling transactional.

## 3. Customization flow
Progressive, one decision at a time, sticky live preview + running price throughout.
Steps are per-bag configurable — not every style has every option group.
1. Style (often pre-selected) 2. Size 3. Primary colour 4. Pattern/secondary colour
(if supported) 5. Strap/handle 6. Add-ons 7. Review + Add to Cart.

## 4-5. Visual mockup approach
Phase 1: layered 2D photo compositing, NOT 3D/WebGL.
- Photographed variants per strap/handle/add-on, composited over a base bag shot, OR
- Neutral-yarn base shot + colour applied via blend-mode/duotone overlay in-browser.
True 3D/WebGL deferred to Phase 2+ — high cost per new style (procedural yarn
shaders), questionable ROI at current order volume; layered photography gets ~80-90%
of the visual quality for a fraction of the cost and turnaround.

## 6. Pricing
totalPrice = basePrice + sum(selected option priceDeltas). Recalculated live client-side
at every step, re-validated server-side at checkout. Always visible, never a surprise.

## 7. Data structure
```
Bag: id, name, description, basePrice, baseImages[], availableSteps[]
  sizes[] / colours[] / patterns[] / straps[] / handles[] / addons[]
  each option: {id, name, priceDelta, image/swatch, compatibleWith[]}
CartItem/OrderLine: bagId, selected option ids, computedPrice, previewSnapshot
```
`availableSteps` per bag is what keeps the customizer clean per style instead of
one generic form with irrelevant fields.

## 8. Cart & checkout
Cart shows the configured bag (real thumbnail + selected options), not a generic SKU.
Guest checkout by default. Stripe. Production-time messaging repeated at checkout.

## 9. Shipping & orders
Flat-rate to start. Explicit "Made to order — ships in X-Y weeks" on PDP/cart/checkout/
confirmation. Status pipeline: Placed → Payment confirmed → In production → Ready to
ship → Shipped → Delivered. Tracking capture, customer email per stage (manual → later automated).

## 10. Admin
Internal-only, utilitarian. Orders list (filter by status) + order detail (customer info,
plain-language configuration, payment status via Stripe, manual production-status
dropdown, tracking, internal notes). Recommend Airtable or a lightweight table view for
Phase 1 rather than a full custom dashboard — ships in days, proves out real usage
before investing in custom admin tooling.

## 11. Needed from client before development
Full bag catalog (names/descriptions/current DM pricing) · photography plan/budget ·
exact customization matrix per bag style · pricing per option/add-on · materials/care/
sizing · brand assets (logo/colours/fonts/tone) + IG content rights · shipping &
return policy + real production lead times · Stripe account access · domain/hosting
preference · realistic production capacity (sets the lead-time promise shown to customers).

## 12. Phase 1 vs Phase 2
Phase 1: Home, Shop, PDP+2D customizer, Lookbook, About, FAQ, Contact, live pricing,
cart, Stripe checkout, confirmation + receipt email, lightweight admin, mobile-first,
no accounts.
Phase 2: accounts + order tracking portal, true 3D/WebGL viewer (if justified),
automated status emails/SMS, inventory management, loyalty/referral, wholesale/B2B,
deeper Instagram integration.

## Design philosophy (all phases)
Minimal, premium fashion/luxury feel, large imagery, mobile-first, smooth animations,
very little unnecessary text, product is always the focus — not an enterprise
dashboard or generic SaaS look.
