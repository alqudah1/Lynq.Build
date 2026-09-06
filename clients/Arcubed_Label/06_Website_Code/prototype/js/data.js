// Arcubed Label — MOCK product data. Replace entirely once the real catalog arrives
// (see clients/Arcubed_Label/01_Client_Info for the WhatsApp intake list).

var COLOURS = [
  { id: 'terracotta', name: 'Terracotta', hex: '#C97B5A' },
  { id: 'sage', name: 'Sage', hex: '#8FA187' },
  { id: 'blush', name: 'Blush', hex: '#E8B4B8' },
  { id: 'cream', name: 'Cream', hex: '#EFE3D3' },
  { id: 'charcoal', name: 'Charcoal', hex: '#3B3630' },
  { id: 'mustard', name: 'Mustard', hex: '#D9A441' }
];

var BAGS = [
  {
    id: 'rosa-tote',
    name: 'Rosa Tote',
    tagline: 'Structured, roomy, everyday.',
    basePrice: 120,
    colourIds: ['terracotta', 'sage', 'blush', 'cream', 'charcoal', 'mustard'],
    sizes: [
      { id: 'sm', label: 'Small', note: 'Fits an iPad + essentials', priceDelta: 0 },
      { id: 'md', label: 'Medium', note: 'Fits a 13" laptop', priceDelta: 15 },
      { id: 'lg', label: 'Large', note: 'Everyday carry-all', priceDelta: 30 }
    ],
    straps: [
      { id: 'woven', label: 'Woven Strap', priceDelta: 0, art: 'woven' },
      { id: 'braided', label: 'Braided Strap', priceDelta: 12, art: 'braided' },
      { id: 'chain', label: 'Chain Strap', priceDelta: 18, art: 'chain' }
    ],
    addons: [
      { id: 'charm', label: 'Gold Charm', priceDelta: 8, art: 'charm' },
      { id: 'tassel', label: 'Tassel', priceDelta: 6, art: 'tassel' },
      { id: 'pouch', label: 'Zip Pouch', priceDelta: 15, art: 'pouch' },
      { id: 'monogram', label: 'Monogram', priceDelta: 10, art: 'monogram' }
    ]
  },
  {
    id: 'luna-crossbody',
    name: 'Luna Crossbody',
    tagline: 'Small, sculpted, hands-free.',
    basePrice: 95,
    colourIds: ['terracotta', 'blush', 'cream', 'charcoal', 'mustard'],
    sizes: [
      { id: 'sm', label: 'Small', note: 'Phone, cards, keys', priceDelta: 0 },
      { id: 'md', label: 'Medium', note: 'Adds room for sunglasses', priceDelta: 10 }
    ],
    straps: [
      { id: 'woven', label: 'Woven Strap', priceDelta: 0, art: 'woven' },
      { id: 'chain', label: 'Chain Strap', priceDelta: 18, art: 'chain' }
    ],
    addons: [
      { id: 'charm', label: 'Gold Charm', priceDelta: 8, art: 'charm' },
      { id: 'tassel', label: 'Tassel', priceDelta: 6, art: 'tassel' },
      { id: 'monogram', label: 'Monogram', priceDelta: 10, art: 'monogram' }
    ]
  },
  {
    id: 'mira-mini',
    name: 'Mira Mini Bag',
    tagline: 'A little colour, everywhere you go.',
    basePrice: 68,
    colourIds: ['blush', 'sage', 'mustard', 'terracotta'],
    sizes: [
      { id: 'xs', label: 'Extra Small', note: 'Just the essentials', priceDelta: 0 },
      { id: 'sm', label: 'Small', note: 'A little extra room', priceDelta: 8 }
    ],
    addons: [
      { id: 'charm', label: 'Gold Charm', priceDelta: 8, art: 'charm' },
      { id: 'tassel', label: 'Tassel', priceDelta: 6, art: 'tassel' }
    ]
  },
  {
    id: 'coco-market',
    name: 'Coco Market Bag',
    tagline: 'Oversized, breezy, market-ready.',
    basePrice: 140,
    colourIds: ['cream', 'sage', 'terracotta', 'charcoal'],
    sizes: [
      { id: 'md', label: 'Medium', note: 'A day at the market', priceDelta: 0 },
      { id: 'lg', label: 'Large', note: 'Beach + travel days', priceDelta: 20 }
    ],
    handles: [
      { id: 'short', label: 'Short Handle', priceDelta: 0, art: 'handleShort' },
      { id: 'long', label: 'Long Handle', priceDelta: 10, art: 'handleLong' }
    ],
    addons: [
      { id: 'pouch', label: 'Zip Pouch', priceDelta: 15, art: 'pouch' },
      { id: 'monogram', label: 'Monogram', priceDelta: 10, art: 'monogram' }
    ]
  }
];

function getBag(id) { return BAGS.filter(function (b) { return b.id === id; })[0] || null; }
function getColour(id) { return COLOURS.filter(function (c) { return c.id === id; })[0] || COLOURS[0]; }
