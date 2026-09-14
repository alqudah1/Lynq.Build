// About — brand story told through real product and texture photography.
// No invented founder biography, no fabricated history, no values cards.
import Image from "next/image";
import Link from "next/link";
import { getActiveBags } from "@/lib/repository";
import { resolveMedia, framesForColour, tileSrc, altFor } from "@/lib/product-media";
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

  // THE OPENING OBJECT.
  //
  // A metallic ribbon macro used to sit here, and it answered the wrong
  // question: a page that opens "HAND MADE." should show what Arcubed makes,
  // not a swatch of what it is made from. It also repeated the kind of image
  // the homepage already uses twice.
  //
  // Mini Luna in Black, compared on the actual pink field against Mini Luna
  // Gold and Silver & Gold, Nova Black, Nova Gold and Nova Rose Gold. Nova is
  // a wide flat clutch with a hand slot rather than an arch, so its
  // silhouette does not read as a bag at a glance; the warm metallics sit too
  // close to pink in value. Black on pink is the highest-contrast pairing in
  // the system and the arch is the most legible shape in the catalogue.
  //
  // DSC04873 by frameId, not the first frame: DSC04872 carries a matte
  // artefact inside the arch. Same selection the homepage makes.
  const blackFrames = luna ? framesForColour(luna, "Black") : [];
  const openShot =
    blackFrames.find((f) => f.frameId === "DSC04873") ?? blackFrames[0] ?? null;
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
        {/* No caption. The three facts directly above already say hand
            crocheted, made to order, Amman — a caption here would repeat them
            to fill space. */}
        {openShot && luna ? (
          <figure className="ab-obj">
            <Image
              src={tileSrc(openShot)}
              alt={altFor(luna, "Black")}
              width={1500}
              height={Math.round(1500 / openShot.ratio)}
              sizes="(max-width: 859px) 88vw, 54vw"
              preload
            />
          </figure>
        ) : null}
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
