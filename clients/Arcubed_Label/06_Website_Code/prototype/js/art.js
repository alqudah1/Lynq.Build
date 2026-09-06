// Arcubed Label — PLACEHOLDER bag illustration generator.
// Stands in for real product photography until the client's shoot happens.
// Phase 1 build will replace this with the layered-photo-compositing approach
// from the architecture doc (see 06_Website_Code/development-plan.md, section 4-5).

function shade(hex, amt) {
  var n = parseInt(hex.slice(1), 16);
  var r = Math.min(255, Math.max(0, (n >> 16) + amt));
  var g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  var b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function strapArt(kind, dark) {
  if (kind === 'braided') {
    return '<path d="M96,96 C96,40 140,18 160,18 C180,18 224,40 224,96" fill="none" stroke="' + dark + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="2 10"/>' +
      '<path d="M96,96 C96,40 140,18 160,18 C180,18 224,40 224,96" fill="none" stroke="' + dark + '" stroke-width="3" stroke-linecap="round"/>';
  }
  if (kind === 'chain') {
    return '<path d="M96,96 C96,40 140,14 160,14 C180,14 224,40 224,96" fill="none" stroke="' + dark + '" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 9"/>';
  }
  return '<path d="M96,96 C96,44 138,22 160,22 C182,22 224,44 224,96" fill="none" stroke="' + dark + '" stroke-width="6" stroke-linecap="round"/>';
}

function handleArt(kind, dark) {
  var lift = kind === 'handleLong' ? 34 : 14;
  return '<path d="M120,96 C120,' + (96 - lift - 26) + ' 128,' + (96 - lift - 40) + ' 140,' + (96 - lift - 40) + '" fill="none" stroke="' + dark + '" stroke-width="7" stroke-linecap="round"/>' +
    '<path d="M200,96 C200,' + (96 - lift - 26) + ' 192,' + (96 - lift - 40) + ' 180,' + (96 - lift - 40) + '" fill="none" stroke="' + dark + '" stroke-width="7" stroke-linecap="round"/>';
}

function addonArt(id, dark, gold) {
  if (id === 'charm') return '<circle cx="222" cy="230" r="7" fill="none" stroke="' + gold + '" stroke-width="3"/><line x1="222" y1="222" x2="222" y2="212" stroke="' + gold + '" stroke-width="3"/>';
  if (id === 'tassel') return ['150', '160', '170', '180'].map(function (x) {
    return '<line x1="' + x + '" y1="300" x2="' + x + '" y2="322" stroke="' + dark + '" stroke-width="3" stroke-linecap="round"/>';
  }).join('');
  if (id === 'pouch') return '<rect x="230" y="180" width="30" height="24" rx="5" fill="none" stroke="' + dark + '" stroke-width="3"/>';
  if (id === 'monogram') return '<text x="160" y="205" font-family="Fraunces, Georgia, serif" font-size="26" fill="' + dark + '" text-anchor="middle" opacity="0.65">A</text>';
  return '';
}

// Builds one full preview SVG for a bag + its current selection.
function bagArtSVG(bag, selection) {
  var colour = getColour(selection.colourId);
  var hex = colour.hex;
  var dark = shade(hex, -55);
  var gold = '#B8860B';
  var strap = (bag.straps || []).filter(function (s) { return s.id === selection.strapId; })[0];
  var handle = (bag.handles || []).filter(function (h) { return h.id === selection.handleId; })[0];
  var addonIds = selection.addonIds || [];

  var strapSvg = strap ? strapArt(strap.art, dark) : (handle ? handleArt(handle.art, dark) : '');
  var addonSvg = addonIds.map(function (id) { return addonArt(id, dark, gold); }).join('');

  var body = 'M64,150 C64,116 82,92 116,92 L204,92 C238,92 256,116 256,150 L266,304 C266,326 244,340 218,340 L102,340 C76,340 54,326 54,304 Z';

  return (
    '<svg viewBox="0 0 320 360" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + bag.name + ' preview">' +
    '<defs>' +
    '<pattern id="stitch" width="14" height="14" patternUnits="userSpaceOnUse">' +
    '<circle cx="3" cy="3" r="1.4" fill="' + dark + '" opacity="0.16"/>' +
    '</pattern>' +
    '<clipPath id="bagClip"><path d="' + body + '"/></clipPath>' +
    '</defs>' +
    strapSvg +
    '<path d="' + body + '" fill="' + hex + '"/>' +
    '<rect x="40" y="80" width="240" height="270" fill="url(#stitch)" clip-path="url(#bagClip)"/>' +
    '<path d="' + body + '" fill="none" stroke="' + dark + '" stroke-width="2" opacity="0.5"/>' +
    addonSvg +
    '</svg>'
  );
}
