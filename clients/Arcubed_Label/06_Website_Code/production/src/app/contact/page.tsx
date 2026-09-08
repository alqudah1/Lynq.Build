// Contact — brand continuation, not a boxed form.
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
  const loco = bags.find((b) => b.name.trim().toLowerCase() === "loco");
  const shot = loco ? framesForColour(loco, "Burgundy")[0] ?? resolveMedia(loco)?.frame : null;

  return (
    <section className="ct">
      <div className="ct-copy">
        <p className="ed-kicker">Contact</p>
        <h1 className="ct-title">
          LET&rsquo;S MAKE<br />SOMETHING<br />YOURS.
        </h1>
        <p className="ct-topics">
          Custom orders · Colours &amp; yarns · Shipping · Ready for Delivery · An existing order
        </p>
        <ContactForm />
      </div>
      <div className="ct-media">
        {shot ? (
          <Image src={shot.photo} alt={altFor(loco!, "Burgundy")} width={1600}
                 height={Math.round(1600 / shot.ratio)} sizes="(max-width:860px) 100vw, 44vw" loading="eager" fetchPriority="high" />
        ) : null}
      </div>
    </section>
  );
}
