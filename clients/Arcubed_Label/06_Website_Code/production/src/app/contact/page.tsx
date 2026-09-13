// Contact — brand continuation, not a boxed form.
//
// It used to be one column of copy with the form hanging off the bottom of
// it, and a photograph filling the other half: a heading, a form and a
// picture, which is the layout every contact page has. The page is split by
// JOB now. The left is Arcubed talking — who this is, what to write about,
// where the work actually lives — on the brand field, closing on one clean
// photograph. The right is the customer's side of the conversation and
// carries nothing but the form.
import Image from "next/image";
import { getActiveBags } from "@/lib/repository";
import { framesForColour, resolveMedia, altFor } from "@/lib/product-media";
import ContactForm from "./ContactForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Contact",
  description: "Questions about a custom order, colours, shipping or an existing order.",
};

export default async function ContactPage() {
  const bags = await getActiveBags();
  // Mini Luna in Silver, not the Burgundy Loco that was here. The old panel
  // was 0.55 aspect against a 1.51 photograph, so cover threw away 63% of the
  // width and left a wall of fringe with no bag in it. This frame is one of
  // the cleanest in the archive (ground luminance 0.85), it is cool against
  // the pink field, and it is not the hero of any other page.
  const luna = bags.find((b) => b.name.trim().toLowerCase() === "mini luna");
  const shot = luna ? framesForColour(luna, "Silver")[0] ?? resolveMedia(luna)?.frame : null;

  return (
    <section className="ct">
      <div className="ct-brand">
        <p className="ed-kicker">Contact</p>
        <h1 className="ct-title">
          LET&rsquo;S MAKE<br />SOMETHING<br />YOURS.
        </h1>
        <p className="ct-topics">
          Custom orders · Colours &amp; yarns · Shipping · Ready for Delivery · An existing order
        </p>

        {/* Instagram lives out here rather than under the send button, so it
            is still on the page after the form has been replaced by its
            success state. */}
        <p className="ct-ig">
          Fastest reply is on Instagram.{" "}
          <a href="https://instagram.com/arcubedlabel" target="_blank" rel="noreferrer">
            @arcubedlabel
          </a>
        </p>

        {shot && luna ? (
          <figure className="ct-shot">
            <Image
              src={shot.photo}
              alt={altFor(luna, "Silver")}
              width={1400}
              height={Math.round(1400 / shot.ratio)}
              sizes="(max-width: 899px) 92vw, 38vw"
              loading="eager"
              fetchPriority="high"
            />
          </figure>
        ) : null}
      </div>

      <div className="ct-formcol">
        <ContactForm />
      </div>
    </section>
  );
}
