// Arcubed Label — Product / Customizer page.
// Deliberately NOT a full re-render on every tap: the shell is built once, then
// option taps mutate only the preview image, price and swatch states directly,
// so every interaction feels instant (<300ms crossfade) instead of repainting
// the page. This file owns that page's state while it's active.

function renderProductPage(container, bag) {
  if (!bag) {
    container.innerHTML = '<section class="section"><p>Bag not found.</p></section>';
    return;
  }

  var editingId = App.state.editingLineId;
  var existing = editingId ? App.state.cart.filter(function (l) { return l.lineId === editingId; })[0] : null;
  var selection = existing
    ? { colourId: existing.colourId, sizeId: existing.sizeId, strapId: existing.strapId, handleId: existing.handleId, addonIds: existing.addonIds.slice() }
    : defaultSelectionFor(bag);

  container.innerHTML = productShellHtml(bag, selection);
  wireProductInteractions(bag, selection);
  updatePrice(bag, selection);
}

function productShellHtml(bag, sel) {
  return (
    '<section class="product">' +
    '<div class="product-media">' +
    '<div class="media-frame" id="media-frame"><div class="bag-art-layer show">' + bagArtSVG(bag, sel) + '</div></div>' +
    '</div>' +

    '<div class="product-panel">' +
    '<p class="eyebrow">' + esc(bag.tagline) + '</p>' +
    '<h1>' + esc(bag.name) + '</h1>' +
    '<p class="price-inline" id="price-display">' + money(bag.basePrice) + '</p>' +

    '<div class="opt-group"><p class="opt-label">Colour</p><div class="swatch-row" id="colour-row">' +
    bag.colourIds.map(function (cid) {
      var c = getColour(cid);
      return '<button type="button" class="swatch' + (cid === sel.colourId ? ' selected' : '') + '" data-colour="' + cid + '" style="background:' + c.hex + '" aria-label="' + esc(c.name) + '" aria-pressed="' + (cid === sel.colourId) + '"></button>';
    }).join('') + '</div></div>' +

    '<div class="opt-group"><p class="opt-label">Size</p><div class="pill-row" id="size-row">' +
    bag.sizes.map(function (s) {
      return '<button type="button" class="pill' + (s.id === sel.sizeId ? ' selected' : '') + '" data-size="' + s.id + '" aria-pressed="' + (s.id === sel.sizeId) + '">' + esc(s.label) + '</button>';
    }).join('') + '</div><p class="opt-note" id="size-note">' + esc(sizeNote(bag, sel)) + '</p></div>' +

    (bag.straps ? '<div class="opt-group"><p class="opt-label">Strap</p><div class="thumb-row" id="strap-row">' +
      bag.straps.map(function (s) {
        return '<button type="button" class="thumb-chip' + (s.id === sel.strapId ? ' selected' : '') + '" data-strap="' + s.id + '" aria-pressed="' + (s.id === sel.strapId) + '">' +
          '<span class="thumb-art">' + bagArtSVG(bag, { colourId: sel.colourId, sizeId: sel.sizeId, strapId: s.id, addonIds: [] }) + '</span>' +
          '<span class="thumb-label">' + esc(s.label) + (s.priceDelta ? ' · +' + money(s.priceDelta) : '') + '</span></button>';
      }).join('') + '</div></div>' : '') +

    (bag.handles ? '<div class="opt-group"><p class="opt-label">Handle</p><div class="thumb-row" id="handle-row">' +
      bag.handles.map(function (h) {
        return '<button type="button" class="thumb-chip' + (h.id === sel.handleId ? ' selected' : '') + '" data-handle="' + h.id + '" aria-pressed="' + (h.id === sel.handleId) + '">' +
          '<span class="thumb-art">' + bagArtSVG(bag, { colourId: sel.colourId, sizeId: sel.sizeId, handleId: h.id, addonIds: [] }) + '</span>' +
          '<span class="thumb-label">' + esc(h.label) + (h.priceDelta ? ' · +' + money(h.priceDelta) : '') + '</span></button>';
      }).join('') + '</div></div>' : '') +

    (bag.addons ? '<div class="opt-group"><p class="opt-label">Add-ons</p><div class="chip-row" id="addon-row">' +
      bag.addons.map(function (a) {
        var active = sel.addonIds.indexOf(a.id) > -1;
        return '<button type="button" class="chip' + (active ? ' active' : '') + '" data-addon="' + a.id + '" aria-pressed="' + active + '">' +
          '<span>' + esc(a.label) + '</span><span class="chip-price">+' + money(a.priceDelta) + '</span></button>';
      }).join('') + '</div></div>' : '') +

    '<button class="btn btn-primary btn-block add-to-bag" id="add-to-bag-inline">' + (App.state.editingLineId ? 'Save Changes' : 'Add to Bag') + '</button>' +

    '<div class="accordion-group">' +
    '<details><summary>Materials &amp; Care</summary><p>100% cotton yarn, hand-crocheted. Spot clean, air dry.</p></details>' +
    '<details><summary>Sizing</summary><p>See dimensions under each size option above.</p></details>' +
    '<details><summary>Production time</summary><p>Handmade to order — usually ships in 2–3 weeks.</p></details>' +
    '</div>' +
    '</div>' +

    '<div class="sticky-bar">' +
    '<span class="sticky-price" id="sticky-price">' + money(bag.basePrice) + '</span>' +
    '<button class="btn btn-primary" id="add-to-bag-sticky">' + (App.state.editingLineId ? 'Save' : 'Add to Bag') + '</button>' +
    '</div>' +
    '</section>'
  );
}

function sizeNote(bag, sel) {
  var s = bag.sizes.filter(function (x) { return x.id === sel.sizeId; })[0];
  return s ? s.note : '';
}

function wireProductInteractions(bag, selection) {
  var colourRow = document.getElementById('colour-row');
  if (colourRow) colourRow.onclick = function (e) {
    var btn = e.target.closest('[data-colour]');
    if (!btn) return;
    selection.colourId = btn.getAttribute('data-colour');
    setSelected(colourRow, '[data-colour]', btn);
    refreshDependentArt(bag, selection);
    updatePreview(bag, selection);
  };

  var sizeRow = document.getElementById('size-row');
  if (sizeRow) sizeRow.onclick = function (e) {
    var btn = e.target.closest('[data-size]');
    if (!btn) return;
    selection.sizeId = btn.getAttribute('data-size');
    setSelected(sizeRow, '[data-size]', btn);
    document.getElementById('size-note').textContent = sizeNote(bag, selection);
    updatePrice(bag, selection);
  };

  var strapRow = document.getElementById('strap-row');
  if (strapRow) strapRow.onclick = function (e) {
    var btn = e.target.closest('[data-strap]');
    if (!btn) return;
    selection.strapId = btn.getAttribute('data-strap');
    setSelected(strapRow, '[data-strap]', btn);
    updatePreview(bag, selection);
  };

  var handleRow = document.getElementById('handle-row');
  if (handleRow) handleRow.onclick = function (e) {
    var btn = e.target.closest('[data-handle]');
    if (!btn) return;
    selection.handleId = btn.getAttribute('data-handle');
    setSelected(handleRow, '[data-handle]', btn);
    updatePreview(bag, selection);
  };

  var addonRow = document.getElementById('addon-row');
  if (addonRow) addonRow.onclick = function (e) {
    var btn = e.target.closest('[data-addon]');
    if (!btn) return;
    var id = btn.getAttribute('data-addon');
    var idx = selection.addonIds.indexOf(id);
    if (idx > -1) selection.addonIds.splice(idx, 1); else selection.addonIds.push(id);
    btn.classList.toggle('active');
    btn.setAttribute('aria-pressed', btn.classList.contains('active'));
    updatePreview(bag, selection);
  };

  var addInline = document.getElementById('add-to-bag-inline');
  var addSticky = document.getElementById('add-to-bag-sticky');
  var doAdd = function () { addToBag(bag, selection); };
  if (addInline) addInline.onclick = doAdd;
  if (addSticky) addSticky.onclick = doAdd;
}

function setSelected(row, selector, activeBtn) {
  row.querySelectorAll(selector).forEach(function (el) {
    var on = el === activeBtn;
    el.classList.toggle('selected', on);
    el.setAttribute('aria-pressed', on);
  });
}

// Strap/handle thumbnails preview the chosen colour too, so they need repainting
// (not crossfading — they're small, static swatch-style chips) whenever colour changes.
function refreshDependentArt(bag, selection) {
  ['strap-row', 'handle-row'].forEach(function (rowId) {
    var row = document.getElementById(rowId);
    if (!row) return;
    row.querySelectorAll('.thumb-chip').forEach(function (chip) {
      var optId = chip.getAttribute('data-strap') || chip.getAttribute('data-handle');
      var artSel = { colourId: selection.colourId, sizeId: selection.sizeId, addonIds: [] };
      if (chip.hasAttribute('data-strap')) artSel.strapId = optId; else artSel.handleId = optId;
      chip.querySelector('.thumb-art').innerHTML = bagArtSVG(bag, artSel);
    });
  });
}

function updatePreview(bag, sel) {
  var frame = document.getElementById('media-frame');
  if (!frame) return;
  var layer = document.createElement('div');
  layer.className = 'bag-art-layer';
  layer.innerHTML = bagArtSVG(bag, sel);
  frame.appendChild(layer);
  requestAnimationFrame(function () { layer.classList.add('show'); });
  var old = frame.querySelectorAll('.bag-art-layer');
  if (old.length > 1) {
    old[0].classList.remove('show');
    setTimeout(function () { if (old[0].parentNode) old[0].parentNode.removeChild(old[0]); }, 300);
  }
  updatePrice(bag, sel);
}

function updatePrice(bag, sel) {
  var price = computeUnitPrice(bag, sel);
  ['price-display', 'sticky-price'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = money(price);
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  });
}

function addToBag(bag, selection) {
  var price = computeUnitPrice(bag, selection);
  var line = {
    lineId: App.state.editingLineId || uid(),
    bagId: bag.id,
    colourId: selection.colourId,
    sizeId: selection.sizeId,
    strapId: selection.strapId || null,
    handleId: selection.handleId || null,
    addonIds: selection.addonIds.slice(),
    qty: 1,
    unitPrice: price
  };
  App.addOrUpdateLine(line);
  showUndoToast(App.state.editingLineId ? 'Bag updated.' : 'Added to your bag.');
}
