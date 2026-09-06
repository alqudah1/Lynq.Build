// Arcubed Label — frontend prototype shell.
// Local/mock state only. No backend, no Stripe, no auth, no admin.

var App = {
  state: {
    page: 'home',
    currentBagId: null,
    editingLineId: null,
    cart: [],          // { lineId, bagId, colourId, sizeId, strapId, handleId, addonIds[], qty, unitPrice }
    cartDrawerOpen: false
  },

  go: function (page, bagId) {
    this.state.page = page;
    this.state.currentBagId = bagId || null;
    this.state.editingLineId = null;
    this.state.cartDrawerOpen = false;
    window.scrollTo(0, 0);
    this.render();
  },

  editLine: function (lineId) {
    var line = this.state.cart.filter(function (l) { return l.lineId === lineId; })[0];
    if (!line) return;
    this.state.page = 'product';
    this.state.currentBagId = line.bagId;
    this.state.editingLineId = lineId;
    this.state.cartDrawerOpen = false;
    window.scrollTo(0, 0);
    this.render();
  },

  removeLine: function (lineId) {
    this.state.cart = this.state.cart.filter(function (l) { return l.lineId !== lineId; });
    this.render();
    showUndoToast('Removed from bag.');
  },

  addOrUpdateLine: function (line) {
    if (this.state.editingLineId) {
      this.state.cart = this.state.cart.map(function (l) {
        return l.lineId === App.state.editingLineId ? line : l;
      });
    } else {
      this.state.cart.push(line);
    }
    this.state.editingLineId = null;
    this.go('cart');
  },

  toggleCartDrawer: function (force) {
    this.state.cartDrawerOpen = typeof force === 'boolean' ? force : !this.state.cartDrawerOpen;
    renderCartDrawer();
    renderHeaderBadge();
  },

  render: function () {
    var app = document.getElementById('app');
    if (this.state.page === 'home') app.innerHTML = renderHome();
    else if (this.state.page === 'shop') app.innerHTML = renderShop();
    else if (this.state.page === 'product') renderProductPage(app, getBag(this.state.currentBagId));
    else if (this.state.page === 'cart') app.innerHTML = renderCartPage();
    renderHeaderBadge();
    renderCartDrawer();
    bindNavLinks();
  }
};

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function money(n) { return '$' + n.toFixed(0); }
function uid() { return 'l' + Math.random().toString(36).slice(2, 9); }

function defaultSelectionFor(bag) {
  return {
    colourId: bag.colourIds[0],
    sizeId: bag.sizes[0].id,
    strapId: bag.straps ? bag.straps[0].id : null,
    handleId: bag.handles ? bag.handles[0].id : null,
    addonIds: []
  };
}

function computeUnitPrice(bag, sel) {
  var total = bag.basePrice;
  var size = (bag.sizes || []).filter(function (s) { return s.id === sel.sizeId; })[0];
  if (size) total += size.priceDelta;
  var strap = (bag.straps || []).filter(function (s) { return s.id === sel.strapId; })[0];
  if (strap) total += strap.priceDelta;
  var handle = (bag.handles || []).filter(function (h) { return h.id === sel.handleId; })[0];
  if (handle) total += handle.priceDelta;
  (sel.addonIds || []).forEach(function (id) {
    var a = (bag.addons || []).filter(function (x) { return x.id === id; })[0];
    if (a) total += a.priceDelta;
  });
  return total;
}

function optionSummary(bag, sel) {
  var parts = [];
  var colour = getColour(sel.colourId);
  parts.push('Colour: ' + colour.name);
  var size = (bag.sizes || []).filter(function (s) { return s.id === sel.sizeId; })[0];
  if (size) parts.push('Size: ' + size.label);
  var strap = (bag.straps || []).filter(function (s) { return s.id === sel.strapId; })[0];
  if (strap) parts.push('Strap: ' + strap.label);
  var handle = (bag.handles || []).filter(function (h) { return h.id === sel.handleId; })[0];
  if (handle) parts.push('Handle: ' + handle.label);
  (sel.addonIds || []).forEach(function (id) {
    var a = (bag.addons || []).filter(function (x) { return x.id === id; })[0];
    if (a) parts.push('+' + a.label);
  });
  return parts;
}

function optionTagsHtml(bag, sel) {
  return optionSummary(bag, sel).map(function (p) { return '<span class="tag">' + esc(p) + '</span>'; }).join('');
}

function showUndoToast(msg) {
  var t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(function () { t.classList.add('show'); });
  setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 250); }, 1800);
}

function bindNavLinks() {
  document.querySelectorAll('[data-go]').forEach(function (el) {
    el.onclick = function (e) {
      e.preventDefault();
      App.go(el.getAttribute('data-go'), el.getAttribute('data-bag'));
    };
  });
}

/* ---------------- HEADER / CART DRAWER ---------------- */

function renderHeaderBadge() {
  var badge = document.getElementById('cart-badge');
  if (!badge) return;
  var count = App.state.cart.reduce(function (n, l) { return n + l.qty; }, 0);
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function renderCartDrawer() {
  var root = document.getElementById('cart-drawer-root');
  if (!root) return;
  var open = App.state.cartDrawerOpen;
  var lines = App.state.cart;
  var subtotal = lines.reduce(function (n, l) { return n + l.unitPrice * l.qty; }, 0);

  root.innerHTML =
    '<div class="drawer-overlay' + (open ? ' show' : '') + '" data-close-drawer></div>' +
    '<aside class="cart-drawer' + (open ? ' open' : '') + '" aria-hidden="' + (!open) + '">' +
    '<div class="drawer-head"><span>Your Bag</span><button class="icon-btn" data-close-drawer aria-label="Close">×</button></div>' +
    (lines.length === 0
      ? '<p class="drawer-empty">Nothing here yet — go find your bag.</p>'
      : '<div class="drawer-lines">' + lines.map(drawerLineHtml).join('') + '</div>' +
        '<div class="drawer-foot"><div class="drawer-subtotal"><span>Subtotal</span><strong>' + money(subtotal) + '</strong></div>' +
        '<button class="btn btn-primary btn-block" data-go="cart" data-close-drawer>View Bag</button></div>')
    +
    '</aside>';

  root.querySelectorAll('[data-close-drawer]').forEach(function (el) {
    el.onclick = function (e) {
      if (el.hasAttribute('data-go')) { e.preventDefault(); App.go('cart'); }
      App.toggleCartDrawer(false);
    };
  });
}

function drawerLineHtml(l) {
  var bag = getBag(l.bagId);
  return '<div class="drawer-line">' +
    '<div class="drawer-thumb">' + bagArtSVG(bag, l) + '</div>' +
    '<div class="drawer-line-body"><p class="drawer-line-name">' + esc(bag.name) + '</p>' +
    '<p class="drawer-line-opt">' + esc(optionSummary(bag, l).slice(0, 2).join(' · ')) + '</p>' +
    '<p class="drawer-line-price">' + money(l.unitPrice) + '</p></div></div>';
}

/* ---------------- HOME ---------------- */

function renderHome() {
  var featured = BAGS.slice(0, 3);
  return (
    '<section class="hero">' +
    '<div class="hero-art">' + bagArtSVG(BAGS[0], defaultSelectionFor(BAGS[0])) + '</div>' +
    '<div class="hero-copy">' +
    '<p class="eyebrow">Handmade in small batches</p>' +
    '<h1>Carry something made for you.</h1>' +
    '<a class="btn btn-primary" href="#" data-go="shop">Shop the Collection</a>' +
    '</div></section>' +

    '<section class="section">' +
    '<div class="strip">' + featured.map(bagCardHtml).join('') + '</div>' +
    '</section>' +

    '<section class="section band">' +
    '<p class="band-line">Every piece is crocheted by hand, one stitch at a time — no two are exactly alike.</p>' +
    '</section>' +

    '<section class="section">' +
    '<p class="eyebrow center">Shop by style</p>' +
    '<div class="tile-grid">' +
    BAGS.map(function (b) {
      return '<a class="tile" href="#" data-go="product" data-bag="' + b.id + '">' +
        '<div class="tile-art">' + bagArtSVG(b, defaultSelectionFor(b)) + '</div>' +
        '<p class="tile-name">' + esc(b.name) + '</p></a>';
    }).join('') +
    '</div></section>' +

    '<section class="section ig-section">' +
    '<p class="eyebrow center">As seen on @arcubedlabel</p>' +
    '<div class="ig-strip">' + [0, 1, 2, 3, 4].map(function (i) {
      var b = BAGS[i % BAGS.length];
      return '<div class="ig-tile">' + bagArtSVG(b, defaultSelectionFor(b)) + '</div>';
    }).join('') + '</div></section>' +

    '<section class="section teaser">' +
    '<p class="eyebrow">Make it yours</p>' +
    '<h2>Choose your colour, your straps, your details.</h2>' +
    '<div class="teaser-swatches">' + COLOURS.map(function (c) {
      return '<span class="swatch-dot" style="background:' + c.hex + '"></span>';
    }).join('') + '</div>' +
    '<a class="btn btn-outline" href="#" data-go="shop">Start Customizing</a>' +
    '</section>'
  );
}

function bagCardHtml(b) {
  var sel = defaultSelectionFor(b);
  return '<a class="card" href="#" data-go="product" data-bag="' + b.id + '">' +
    '<div class="card-art">' + bagArtSVG(b, sel) + '</div>' +
    '<p class="card-name">' + esc(b.name) + '</p>' +
    '<p class="card-price">From ' + money(b.basePrice) + '</p></a>';
}

/* ---------------- SHOP ---------------- */

function renderShop() {
  return (
    '<section class="section shop-head"><p class="eyebrow center">The Collection</p><h1 class="center">Every bag, made to order.</h1></section>' +
    '<section class="section"><div class="grid">' + BAGS.map(bagCardHtml).join('') + '</div></section>'
  );
}

/* ---------------- CART ---------------- */

function renderCartPage() {
  var lines = App.state.cart;
  var subtotal = lines.reduce(function (n, l) { return n + l.unitPrice * l.qty; }, 0);
  if (lines.length === 0) {
    return '<section class="section empty-state"><p class="eyebrow center">Your Bag</p>' +
      '<h2 class="center">Nothing here yet.</h2>' +
      '<div class="center"><a class="btn btn-primary" href="#" data-go="shop">Shop the Collection</a></div></section>';
  }
  return (
    '<section class="section cart-page"><p class="eyebrow">Your Bag</p>' +
    '<p class="cart-lede">Made exactly the way you designed it.</p>' +
    '<div class="cart-lines">' + lines.map(cartLineHtml).join('') + '</div>' +
    '<div class="cart-summary">' +
    '<div class="row"><span>Subtotal</span><strong>' + money(subtotal) + '</strong></div>' +
    '<div class="row muted"><span>Shipping</span><span>Calculated at checkout</span></div>' +
    '<p class="reassure">Handmade to order · Ships in 2–3 weeks</p>' +
    '<button class="btn btn-primary btn-block" id="checkout-btn">Checkout</button>' +
    '</div></section>'
  );
}

function cartLineHtml(l) {
  var bag = getBag(l.bagId);
  return '<div class="cart-line">' +
    '<div class="cart-thumb">' + bagArtSVG(bag, l) + '</div>' +
    '<div class="cart-line-body">' +
    '<p class="cart-line-name">' + esc(bag.name) + '</p>' +
    '<div class="cart-line-opt">' + optionTagsHtml(bag, l) + '</div>' +
    '<p class="cart-line-price">' + money(l.unitPrice) + '</p>' +
    '<div class="cart-line-actions">' +
    '<button class="link-btn" data-edit="' + l.lineId + '">Edit</button>' +
    '<button class="link-btn" data-remove="' + l.lineId + '">Remove</button>' +
    '</div></div></div>';
}

document.addEventListener('click', function (e) {
  var editBtn = e.target.closest && e.target.closest('[data-edit]');
  var removeBtn = e.target.closest && e.target.closest('[data-remove]');
  var checkoutBtn = e.target.closest && e.target.closest('#checkout-btn');
  if (editBtn) App.editLine(editBtn.getAttribute('data-edit'));
  if (removeBtn) App.removeLine(removeBtn.getAttribute('data-remove'));
  if (checkoutBtn) showUndoToast('Checkout is on its way — thank you for your patience.');
});

document.addEventListener('DOMContentLoaded', function () {
  App.render();
  var cartIcon = document.getElementById('cart-icon-btn');
  if (cartIcon) cartIcon.onclick = function () { App.toggleCartDrawer(); };
});
