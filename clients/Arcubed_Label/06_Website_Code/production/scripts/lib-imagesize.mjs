// True pixel dimensions from a file header. No image library, no dependency.
//
// Lifted out of audit-image-detail.mjs so the gallery test can measure the
// same way the detail audit does. It exists because naturalWidth cannot be
// trusted: under a deviceScaleFactor override the browser reports it in CSS
// pixels, so a 1170px response reads back as 390 and an under-resolved image
// scores as perfect. The only reliable number is the one in the bytes.

/** Pixel dimensions straight from the file header. PNG, WebP and JPEG. */
export function imageSize(buf) {
  // PNG
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47)
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  // WebP: RIFF....WEBP
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const fmt = buf.toString("ascii", 12, 16);
    if (fmt === "VP8X") return { w: (buf.readUIntLE(24, 3) & 0xffffff) + 1, h: (buf.readUIntLE(27, 3) & 0xffffff) + 1 };
    if (fmt === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (fmt === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  // JPEG: walk the segments to a start-of-frame
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return { w: 0, h: 0 };
}

const seen = new Map();

/** Re-fetch a URL the browser chose and read its REAL dimensions. Cached. */
export async function realDims(url) {
  if (seen.has(url)) return seen.get(url);
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const d = { ...imageSize(buf), bytes: buf.length };
  seen.set(url, d);
  return d;
}
