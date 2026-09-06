// About — brand story told through real product and texture photography.
// No invented founder biography, no fabricated history, no values cards.
import Image from "next/image";
import Link from "next/link";
import { getActiveBags } from "@/lib/repository";
import { resolveMedia, framesForColour, TEXTURES, altFor } from "@/lib/product-media";
import Reveal from "@/components/Reveal";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "About — Arcubed Label",
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
      <section className="ab-open">
        <p className="ed-kicker">Arcubed Label</p>
        <h1 className="ab-title">
          HAND<br />MADE.
        </h1>
        <p className="ab-lede">
          Crochet bags built around colour, texture and the fact that no two are ever quite the same.
        </p>
      </section>

      <Reveal className="ab-wide">
        <Image src={TEXTURES.chunky.src} alt="Close detail of chunky hand-crocheted stitchwork"
               width={1100} height={Math.round(1100 / TEXTURES.chunky.ratio)}
               sizes="100vw" className="ab-wide-img" />
      </Reveal>

      <section className="ab-two">
        <Reveal className="ab-two-copy">
          <h2 className="ab-h2">Made to order,<br />not made in advance.</h2>
          <p className="ab-p">
            Every Arcubed bag starts after you choose it. You pick the shape, the colour and the
            fittings, and it&rsquo;s crocheted for you in 3–5 business days.
          </p>
          <p className="ab-p">
            That&rsquo;s why the colours run the way they do — metallic ribbon yarn that catches
            light, matte cotton that holds a chunky stitch, and a fringe that only works because
            someone knotted it by hand.
          </p>
        </Reveal>
        <Reveal className="ab-two-img" delay={90}>
          {lunaShot ? (
            <Image src={lunaShot.photo} alt={altFor(luna!, "Red")} width={1600}
                   height={Math.round(1600 / lunaShot.ratio)} sizes="(max-width:860px) 92vw, 46vw" />
          ) : null}
        </Reveal>
      </section>

      <section className="ab-three">
        <Reveal className="ab-t1">
          <Image src={TEXTURES.metallic.src} alt="Close detail of metallic ribbon yarn"
                 width={1100} height={Math.round(1100 / TEXTURES.metallic.ratio)}
                 sizes="(max-width:860px) 92vw, 38vw" />
        </Reveal>
        <Reveal className="ab-t2" delay={80}>
          <p className="ab-big">FOUR SHAPES.<br />SIXTEEN<br />COLOURWAYS.</p>
        </Reveal>
        <Reveal className="ab-t3" delay={140}>
          {novaShot ? (
            <Image src={novaShot.photo} alt={altFor(nova!, "Silver & Gold")} width={1600}
                   height={Math.round(1600 / novaShot.ratio)} sizes="(max-width:860px) 92vw, 38vw" />
          ) : null}
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
