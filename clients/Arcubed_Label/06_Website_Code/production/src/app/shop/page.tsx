// Shop — editorial catalogue, real photography only.
import Link from "next/link";
import Image from "next/image";
import { getActiveBags } from "@/lib/repository";
import { money } from "@/lib/pricing";
import { resolveMedia, framesForColour, altFor, photographedColours, cutSrc } from "@/lib/product-media";
import Reveal from "@/components/Reveal";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Shop — Arcubed Label",
  description: "Four hand-crocheted shapes, made to order in your colour.",
};

// Deliberate per-product rhythm: different field, crop and scale, so the page
// reads as a catalogue rather than four identical cards.
const LAYOUT: Record<string, { cls: string; colour: string }> = {
  nova: { cls: "sx-a", colour: "Gold" },
  vault: { cls: "sx-b", colour: "Brown" },
  "mini-luna": { cls: "sx-c", colour: "Red" },
  loco: { cls: "sx-d", colour: "Brown" },
};

export default async function ShopPage() {
  const bags = await getActiveBags();

  return (
    <>
      <section className="sx-head">
        <p className="ed-kicker">The collection</p>
        <h1 className="sx-title">SHOP</h1>
        <p className="sx-sub">
          Four shapes, hand-crocheted to order. Choose your colour and your fittings — nothing is
          made before you pick it.
        </p>
      </section>

      <section className="sx-grid">
        {bags.map((bag, i) => {
          const cfg = LAYOUT[bag.slug] ?? { cls: "sx-a", colour: bag.colours[0]?.name ?? "" };
          const media = resolveMedia(bag, cfg.colour);
          const shots = framesForColour(bag, cfg.colour);
          const alt = shots[1];
          const colourCount = photographedColours(bag).length;
          return (
            <Reveal as="article" key={bag.id} className={`sx-item ${cfg.cls}`} delay={i * 80}>
              <Link href={`/product/${bag.slug}`} className="sx-link">
                {/* Cut-outs float on the colour field so the field is part of
                    the composition. Loco's cut-out failed QA (backdrop between
                    fringe strands), so it keeps its framed photograph. */}
                <span className={`sx-media${media?.frame.cutOk ? " sx-media-cut" : ""}`}>
                  {media ? (
                    <Image
                      className="sx-img sx-img-1"
                      src={media.frame.cutOk ? cutSrc(media.frame) : media.frame.photo}
                      alt={altFor(bag, media.shownColour, media.exactColour)}
                      width={1600}
                      height={Math.round(1600 / media.frame.ratio)}
                      sizes="(max-width: 860px) 92vw, 46vw"
                      priority={i < 2}
                    />
                  ) : null}
                  {/* Hover reveal uses a REAL second photograph of the same
                      colourway, never a simulated one. */}
                  {alt ? (
                    <Image
                      className="sx-img sx-img-2"
                      src={alt.cutOk ? cutSrc(alt) : alt.photo}
                      alt=""
                      aria-hidden="true"
                      width={1600}
                      height={Math.round(1600 / alt.ratio)}
                      sizes="(max-width: 860px) 92vw, 46vw"
                    />
                  ) : null}
                </span>
                <span className="sx-name">{bag.name}</span>
                <span className="sx-meta">
                  <span>{colourCount} colourway{colourCount === 1 ? "" : "s"}</span>
                  <span className="sx-price">From {money(bag.basePrice)}</span>
                </span>
              </Link>
            </Reveal>
          );
        })}
      </section>
    </>
  );
}
