import Link from "next/link";
import type { Bag } from "@/lib/types";
import { defaultSelectionFor, toRenderInput, resolveProductImages, money } from "@/lib/pricing";
import BagArt from "./BagArt";

// REAL-PHOTO FALLBACK RULE: real photography beats BagArt whenever it
// exists for the bag's own default colourway — see
// motion-and-art-direction.md. Second-image hover reveal only activates
// when a real second (gallery) shot actually exists for that colourway;
// it never simulates one.
export default function ProductCard({ bag }: { bag: Bag }) {
  const sel = defaultSelectionFor(bag);
  const images = resolveProductImages(bag, sel);
  const [primary, secondary] = images;

  return (
    <Link className="card" href={`/product/${bag.slug}`}>
      <div className="card-art">
        {primary ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- real photo host isn't fixed yet, see CartLineItem.tsx's note */}
            <img className="card-art-primary" src={primary.url} alt={bag.name} loading="lazy" decoding="async" />
            {secondary ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="card-art-secondary" src={secondary.url} alt="" aria-hidden="true" loading="lazy" decoding="async" />
            ) : null}
          </>
        ) : (
          <BagArt input={toRenderInput(bag, sel)} />
        )}
      </div>
      <p className="card-name">{bag.name}</p>
      <p className="card-price">From {money(bag.basePrice)}</p>
    </Link>
  );
}
