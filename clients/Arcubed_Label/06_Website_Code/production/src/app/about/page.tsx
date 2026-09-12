// About — brand story told through real product and texture photography.
// No invented founder biography, no fabricated history, no values cards.
import Image from "next/image";
import Link from "next/link";
import { getActiveBags } from "@/lib/repository";
import { resolveMedia, framesForColour, altFor } from "@/lib/product-media";
import Reveal from "@/components/Reveal";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "About",
  description: "Hand-crocheted bags made to order, one stitch at a time.",
};

export default async function AboutPage() {
  const bags = await getActiveBags();
  const by = (n: string) => bags.find((b) => b.name.trim().toLowerCase() === n);
  const luna = by("mini luna");
  const nova = by("nova");
  const lunaShot = luna ? framesForColour(luna, "Red")[0] ?? resolveMedia(luna)?.frame : null;
  const novaShot = nova ? framesForColour(nova, "Silver & Gold")[0] ?? resolveMedia(nova)?.frame : null;

  return (
    <>
      {/* THE OPENING IS A FIELD, NOT A PAGE OF WHITE.
          About was the only page in the journey carrying no brand colour at
          all: navy type on white, then a full-bleed brown macro that read as
          carpet rather than as a bag. The section is the pink field now and
          the macro is inset within it, so the texture is a detail the page
          FRAMES instead of a band it happens to run into. */}
      <section className="ab-open">
        <div className="ab-open-head">
          <p className="ed-kicker">Arcubed Label</p>
          <h1 className="ab-title">
            HAND<br />MADE.
          </h1>
        </div>
        <div className="ab-open-r">
          <p className="ab-lede">
            Crochet bags built around colour, texture and the fact that no two are ever quite the same.
          </p>
          <ul className="ab-facts">
            <li>Hand crocheted</li>
            <li>Made to order</li>
            <li>Amman, Jordan</li>
          </ul>
        </div>
        <Reveal as="figure" className="ab-band">
          <Image src="/media/macro-chunky.webp" alt="Close detail of chunky hand-crocheted stitchwork"
                 width={2600} height={801}
                 // The band is inset inside the section padding now rather
                 // than bleeding past it, so it is narrower than the viewport.
                 sizes="(max-width: 860px) 92vw, 92vw" className="ab-band-img"
                 // This is the LCP element on /about and was loading at default
                 // priority behind everything else on the page.
                 preload />
          <figcaption className="ab-cap">Chunky cotton, worked by hand</figcaption>
        </Reveal>
      </section>

      {/* THE CREAM HAS TO LOOK CHOSEN.
          These are studio photographs on a warm seamless, and the seamless is
          not something to hide: tinting it would be a lie about the picture and
          cutting it out would put a floating PNG on the page. Setting each one
          inside a pink panel, inset unevenly and captioned in navy, makes the
          cream read as a photograph the page placed rather than as a
          background that leaked in. */}
      <section className="ab-two">
        <Reveal className="ab-two-copy">
          <h2 className="ab-h2">Made to order,<br />not made in advance.</h2>
          <p className="ab-p">
            Every Arcubed bag starts after you choose it. You pick the shape, the colour and the
            fittings, and it&rsquo;s crocheted for you in 3 to 5 business days.
          </p>
          <p className="ab-p">
            That&rsquo;s why the colours run the way they do. Metallic ribbon yarn that catches
            light, matte cotton that holds a chunky stitch, and a fringe that only works because
            someone knotted it by hand.
          </p>
        </Reveal>
        {lunaShot && luna ? (
          <Reveal as="figure" className="ab-plate ab-two-img" delay={90}>
            <Image src={lunaShot.photo} alt={altFor(luna, "Red")} width={1600}
                   height={Math.round(1600 / lunaShot.ratio)} sizes="(max-width:860px) 84vw, 42vw" />
            <figcaption className="ab-cap">{luna.name.trim()} in Red</figcaption>
          </Reveal>
        ) : null}
      </section>

      {/* Was a three-up of a texture crop, a centred headline and a second
          photograph, all at different sizes on different grounds: a contact
          sheet rather than a composition. Two elements now, and the picture
          leads on the opposite side to the section above so the page
          alternates instead of repeating. */}
      <section className="ab-split">
        {novaShot && nova ? (
          <Reveal as="figure" className="ab-plate ab-split-img">
            <Image src={novaShot.photo} alt={altFor(nova, "Silver & Gold")} width={1600}
                   height={Math.round(1600 / novaShot.ratio)} sizes="(max-width:860px) 84vw, 48vw" />
            <figcaption className="ab-cap">{nova.name.trim()} in Silver &amp; Gold</figcaption>
          </Reveal>
        ) : null}
        <Reveal className="ab-split-copy" delay={90}>
          <p className="ab-big">FOUR SHAPES.<br />SIXTEEN<br />COLOURWAYS.</p>
          <p className="ab-p">
            Four shapes, each crocheted in the colours it suits. Nothing is dyed to order and
            nothing is printed: the colour is the yarn.
          </p>
          <Link className="ed-link" href="/shop">See every colourway</Link>
        </Reveal>
      </section>

      <section className="ab-end">
        <Reveal>
          <p className="ab-end-line">Nothing here was made before you wanted it.</p>
          <Link className="ed-link" href="/shop">Shop the collection</Link>
        </Reveal>
      </section>
    </>
  );
}
