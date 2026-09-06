import Link from "next/link";
import Image from "next/image";
import type { Bag } from "@/lib/types";
import { money } from "@/lib/pricing";
import { resolveMedia, altFor } from "@/lib/product-media";

// Real photography only. The illustrated placeholder is not the Arcubed
// identity and must never represent a product that has been photographed.
export default function ProductCard({ bag, colour }: { bag: Bag; colour?: string }) {
  const media = resolveMedia(bag, colour ?? bag.colours[0]?.name);
  return (
    <Link className="pcard" href={`/product/${bag.slug}`}>
      <span className="pcard-media">
        {media ? (
          <Image
            src={media.frame.photo}
            alt={altFor(bag, media.shownColour, media.exactColour)}
            width={1600}
            height={Math.round(1600 / media.frame.ratio)}
            sizes="(max-width: 860px) 92vw, 44vw"
          />
        ) : null}
      </span>
      <span className="pcard-name">{bag.name}</span>
      <span className="pcard-meta">
        <span>{bag.tagline}</span>
        <span className="pcard-price">From {money(bag.basePrice)}</span>
      </span>
    </Link>
  );
}
