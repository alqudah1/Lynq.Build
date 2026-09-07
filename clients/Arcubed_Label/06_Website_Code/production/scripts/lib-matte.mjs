// The object matte, shared by the standard build and the high-resolution
// rebuild so both derive alpha the same way.
//
// Directional on purpose: against Arcubed's lit studio seamless the product is
// always DARKER and/or MORE SATURATED than the backdrop, never brighter. An
// absolute deviation test keeps backdrop highlights and leaves a pale box
// behind the bag.

export async function objectMatte(file, w, h, data, channels) {
  const alpha = Buffer.alloc(w * h);
  const m = Math.max(4, Math.round(w * 0.06));
  const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const sat = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);
  for (let y = 0; y < h; y++) {
    const L = [[], [], []], R = [[], [], []];
    for (let x = 0; x < m; x++) {
      const li = (y * w + x) * channels, ri = (y * w + (w - 1 - x)) * channels;
      for (let c = 0; c < 3; c++) { L[c].push(data[li + c]); R[c].push(data[ri + c]); }
    }
    const lbg = [med(L[0]), med(L[1]), med(L[2])];
    const rbg = [med(R[0]), med(R[1]), med(R[2])];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      const f = x / (w - 1);
      const b0 = lbg[0] + (rbg[0] - lbg[0]) * f;
      const b1 = lbg[1] + (rbg[1] - lbg[1]) * f;
      const b2 = lbg[2] + (rbg[2] - lbg[2]) * f;
      // Directional: objects are darker and/or more saturated than the lit
      // seamless, never brighter. An absolute deviation keeps backdrop
      // highlights and leaves a pale box behind the bag.
      const d = Math.max(lum(b0, b1, b2) - lum(data[i], data[i+1], data[i+2]),
                         (sat(data[i], data[i+1], data[i+2]) - sat(b0, b1, b2)) * 1.25);
      alpha[y * w + x] = d <= 10 ? 0 : d >= 28 ? 255 : Math.round(((d - 10) / 18) * 255);
    }
  }
  return alpha;
}
