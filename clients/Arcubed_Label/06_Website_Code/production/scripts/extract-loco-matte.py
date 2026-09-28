#!/usr/bin/env python3
"""
LOCO'S CUT-OUTS, MATTED FROM THE 6000x4000 ORIGINALS.

WHY THIS EXISTS. build-media.mjs mattes on luminance alone. Loco is hundreds
of fringe strands over a lit seamless, and a luminance key keeps the floor
between the strands and the contact shadow under them: that is what put Loco
in REJECTED_CUTOUTS and left it shown as a framed photograph, a grey rectangle
sitting inside a coloured field. The client rejected that treatment twice.

WHAT MAKES THE DIFFERENCE. The backdrop is neutral (measured saturation 0.010
at the frame corners) and the yarn is strongly coloured (0.60 in the body), so
the matte is gated on CHROMA as well as luminance. Neutral pixels — seamless,
floor, contact shadow — go to zero whatever their brightness, which is what
luminance alone could not do. The rim is then unpremultiplied against the
backdrop colour fitted per channel across the frame, so no pale outline is
left on any field.

Nothing is generated, painted, reconstructed or blurred. Every pixel that
survives is a photographed pixel; the alpha channel decides what shows.

Run from the production directory (needs pillow + numpy):
    python3 scripts/extract-loco-matte.py
"""
from PIL import Image, ImageFilter, ImageOps
import numpy as np
import os

ORIGINALS = "../../03_Images"
OUT = "public/media"
FRAMES = ["DSC05765", "DSC05770", "DSC05772", "DSC05773"]

# Darker than the fitted backdrop by this much -> fully opaque; below the low
# mark -> fully transparent. Between them the edge is a real soft matte.
LUMA_LO, LUMA_HI = 58.0, 120.0
# Saturation gate. The seamless measures ~0.01 and the yarn ~0.6, but the
# threshold is set by the HARDEST case: brown Loco in shadow, whose 5th
# percentile saturation is 0.167. At 0.09 the shadowed seamless between the
# brown fringe still passed and landed as grey streaks on the mist tile
# (measured 3.3% of kept pixels neutral); at 0.14 that is 0.00% and the yarn
# is untouched.
SAT_LO, SAT_HI = 0.14, 0.26
# Darker than the backdrop by this much and the pixel is product whatever its
# hue: the seamless never gets near it.
DARK_KEEP_LO, DARK_KEEP_HI = 118.0, 140.0


def backdrop(plane: np.ndarray) -> np.ndarray:
    """Quadratic fit of the studio backdrop from the frame border only — the
    object never reaches the edge — so the lighting gradient is modelled."""
    H, W = plane.shape
    b = max(8, min(H, W) // 40)
    ys, xs, vs = [], [], []
    for sy, sx in [(slice(0, b), slice(None)), (slice(H - b, H), slice(None)),
                   (slice(None), slice(0, b)), (slice(None), slice(W - b, W))]:
        blk = plane[sy, sx]
        yy, xx = np.mgrid[sy.start or 0:(sy.stop or H), sx.start or 0:(sx.stop or W)]
        ys.append(yy.ravel()); xs.append(xx.ravel()); vs.append(blk.ravel())
    y = np.concatenate(ys).astype(np.float64); x = np.concatenate(xs).astype(np.float64)
    v = np.concatenate(vs).astype(np.float64)
    A = np.stack([np.ones_like(x), x, y, x * y, x * x, y * y], axis=1)
    c, *_ = np.linalg.lstsq(A, v, rcond=None)
    Y, X = np.mgrid[0:H, 0:W].astype(np.float64)
    return c[0] + c[1] * X + c[2] * Y + c[3] * X * Y + c[4] * X * X + c[5] * Y * Y


def matte(frame: str):
    im = ImageOps.exif_transpose(Image.open(f"{ORIGINALS}/{frame}.JPG")).convert("RGB")
    rgb = np.asarray(im, dtype=np.float32)
    L = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    BG_L = backdrop(L).astype(np.float32)
    drop = BG_L - L
    a_soft = np.clip((drop - LUMA_LO) / (LUMA_HI - LUMA_LO), 0.0, 1.0)
    mx, mn = rgb.max(2), rgb.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-3), 0.0)
    chroma = np.clip((sat - SAT_LO) / (SAT_HI - SAT_LO), 0.0, 1.0)

    # TWO WAYS TO BE PRODUCT, not one. Requiring chroma AND luminance tore the
    # brown frame apart: the yarn around the handle is nearly black (L~13) and
    # near-black pixels have no reliable hue, so the chroma gate punched holes
    # in the bag and left white chips behind. A pixel this dark cannot be the
    # lit seamless (L~164) even deep in shadow, so darkness alone is proof.
    #   near-black            -> keep, no chroma needed
    #   dark AND coloured     -> keep (the fringe, the lit body)
    #   mid-grey and neutral  -> drop (shadowed backdrop between the strands)
    a_dark = np.clip((drop - DARK_KEEP_LO) / (DARK_KEEP_HI - DARK_KEEP_LO), 0.0, 1.0)
    a = np.maximum(a_dark, a_soft * chroma)

    bg_rgb = np.clip(np.dstack([backdrop(rgb[..., k]).astype(np.float32) for k in range(3)]), 0, 255)
    fg = np.clip((rgb - (1.0 - a[..., None]) * bg_rgb) / np.maximum(a, 1e-3)[..., None], 0, 255)

    # TWO GUARDS ON THE UNPREMULTIPLY, both learned from the brown frame.
    # Dividing by a small alpha amplifies whatever the sensor recorded, so a
    # faint edge pixel resolves to near-white and the fringe came out flecked
    # with white chips on the mist tile.
    #   1. an alpha floor: below it the pixel is backdrop, not a soft edge
    #   2. a brightness ceiling: unpremultiplied yarn may not come out
    #      brighter than the pixel actually photographed. Yarn is never
    #      lighter than the seamless behind it.
    a = np.where(a < 0.12, 0.0, a)
    lum_in = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    lum_out = fg @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    ceiling = np.maximum(lum_in * 1.10, 1e-3)
    over = lum_out > ceiling
    scale_down = np.where(over, ceiling / np.maximum(lum_out, 1e-3), 1.0)
    fg = np.clip(fg * scale_down[..., None], 0, 255)

    img = Image.fromarray(np.dstack([fg, a * 255.0]).astype(np.uint8), "RGBA")
    img.putalpha(img.getchannel("A").filter(ImageFilter.MedianFilter(3)))  # speckle only
    img = img.crop(img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox())

    for width in (2600, 1200, 600):
        r = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
        # cut- and tile- are the same asset here: this matte is already
        # field-safe (no shadow, rim unmixed), which is exactly what
        # build-tile-cutouts.mjs produces for the other models.
        for kind in ("cut", "tile"):
            r.save(f"{OUT}/{frame}-{kind}-{width}.webp", quality=92, method=6)
    return img.size


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    for f in FRAMES:
        w, h = matte(f)
        print(f"{f}: {w}x{h}  ratio {w / h:.4f}")
