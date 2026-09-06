# Arcubed Label — Frontend Prototype

Visual/UX prototype only. For internal + client review before real build.

**In scope:** Home, Shop, Product/Customizer, Cart. Mock product data
(`js/data.js`). Local in-memory state only — refreshing the page resets the cart.

**Not in scope (by design, not yet built):** Stripe/real checkout, accounts,
admin dashboard, backend/database, real product photography.

**Placeholder art:** the bag "photos" are generated SVG illustrations
(`js/art.js`) that recolor/reshape instantly, standing in for the real
layered-photography approach from the architecture doc until the client's
product shoot happens.

**Run it:** open `index.html` directly, or serve the folder
(`python3 -m http.server` from this directory) and visit it in a browser.
