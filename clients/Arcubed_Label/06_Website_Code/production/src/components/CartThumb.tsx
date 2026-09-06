"use client";

import Image from "next/image";
import type { CartLine } from "@/lib/types";
import { mediaForSnapshot } from "@/lib/product-media";

// Cart imagery comes from the SAME canonical product+colour map the storefront
// uses (src/lib/media-manifest.ts) — there is no second mapping system, so
// "Nova Black" in the cart is the black Nova and never a generic thumbnail.
// The illustrated BagArt placeholder is not used here at all.
export default function CartThumb({ line }: { line: CartLine }) {
  const frame =
    line.kind === "made_to_order"
      ? mediaForSnapshot(line.snapshot.bagSlug, line.snapshot.bagName, line.snapshot.colourName)
      : mediaForSnapshot(null, line.snapshot.productName, line.snapshot.colourName);

  // A Ready piece may carry its own photograph of that exact physical bag,
  // which beats catalogue media for it.
  const readyImage = line.kind === "ready_for_delivery" ? line.snapshot.imageUrl : null;

  if (readyImage) {
    // eslint-disable-next-line @next/next/no-img-element -- upload host not fixed yet
    return <img src={readyImage} alt="" width={200} height={200} />;
  }
  if (!frame) return <div className="cart-thumb-placeholder" aria-hidden="true" />;
  return (
    <Image src={frame.photoSmall} alt="" width={200}
           height={Math.round(200 / frame.ratio)} sizes="88px" />
  );
}
