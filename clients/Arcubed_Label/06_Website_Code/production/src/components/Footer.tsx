import Link from "next/link";
import FooterGroup from "./FooterGroup";
import { faqAnchor } from "@/lib/faq-anchors";

// Editorial footer: the wordmark IS the graphic, links are typographic.
// No decorative image. A gold material crop used to sit in the top right
// corner; it was unrelated to anything else on the page and read as a stray
// swatch, so the wordmark now carries the whole width on its own.
//
// THIS IS A NAVIGATION FOOTER, NOT A POLICY PAGE.
//
// The Orders and shipping column used to print four full sentences here:
// production time, next-day delivery, the Amman and outside-Amman rates, and
// worldwide shipping. All four are true and all four already have their own
// answers in the FAQ, so the footer was restating the FAQ in body copy at the
// bottom of every route. On a phone, stacked under two more columns, that is
// what made the whole thing read as one long document.
//
// Every group is a set of links now, and the shipping links point at the FAQ
// group that answers them rather than repeating the answer. Nothing is lost:
// the facts live in the FAQ, which is where someone reading a footer link
// called "Delivery and rates" expects to end up.
//
// Server component on purpose. Only the disclosure needs state, so that lives
// in FooterGroup and the copyright year stays rendered on the server, where
// it cannot disagree with the client's clock.
export default function Footer() {
  return (
    <footer className="ft">
      <p className="ft-mark" aria-hidden="true">ARCUBED</p>

      <div className="ft-cols">
        <FooterGroup title="Shop">
          <Link href="/shop">All bags</Link>
          <Link href="/ready-for-delivery">Ready for Delivery</Link>
        </FooterGroup>

        <FooterGroup title="Orders and shipping">
          <Link href={`/faq#${faqAnchor("Ordering and making")}`}>Made to order</Link>
          <Link href={`/faq#${faqAnchor("Shipping")}`}>Delivery and rates</Link>
          <Link href={`/faq#${faqAnchor("Shipping")}`}>Worldwide shipping</Link>
          <Link href={`/faq#${faqAnchor("Material, care and returns")}`}>
            Returns and exchanges
          </Link>
        </FooterGroup>

        <FooterGroup title="Arcubed">
          <Link href="/about">About</Link>
          <Link href="/faq">FAQ</Link>
          <Link href="/contact">Contact</Link>
          {/* Only routes that exist are linked. Instagram is the one external
              destination the client has confirmed. */}
          <a href="https://instagram.com/arcubedlabel" target="_blank" rel="noreferrer">
            Instagram
          </a>
        </FooterGroup>
      </div>

      <p className="ft-legal">
        © {new Date().getFullYear()} Arcubed Label · Hand-crocheted in Jordan
      </p>
    </footer>
  );
}
