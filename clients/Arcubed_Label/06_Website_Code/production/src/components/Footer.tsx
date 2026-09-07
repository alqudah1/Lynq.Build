import Link from "next/link";
import Image from "next/image";
import { TEXTURES } from "@/lib/product-media";

// Editorial footer: the wordmark is the graphic, links are typographic.
export default function Footer() {
  return (
    <footer className="ft">
      {/* One real material crop, so the last thing on every page is the thing
          the brand actually makes. */}
      <figure className="ft-crop" aria-hidden="true">
        <Image src={TEXTURES.gold.src} alt="" width={1368} height={569} sizes="(max-width: 860px) 100vw, 34vw" />
      </figure>
      <p className="ft-mark" aria-hidden="true">ARCUBED</p>
      <div className="ft-cols">
        <nav className="ft-col" aria-label="Shop">
          <p className="ft-h">Shop</p>
          <Link href="/shop">All bags</Link>
          <Link href="/ready-for-delivery">Ready for Delivery</Link>
        </nav>
        <div className="ft-col">
          <p className="ft-h">Orders</p>
          <span>Made to order in 3 to 5 business days</span>
          <span>Ready for Delivery · Next-day delivery in Jordan</span>
          <span>Amman 3 JOD · Outside Amman 5 JOD</span>
          <span>Worldwide shipping, rate by destination</span>
        </div>
        <nav className="ft-col" aria-label="Arcubed">
          <p className="ft-h">Arcubed</p>
          <Link href="/about">About</Link>
          <Link href="/faq">FAQ</Link>
          <Link href="/contact">Contact</Link>
          {/* Only routes that exist are linked. Instagram is the one external
              destination the client has confirmed. */}
          <a href="https://instagram.com/arcubedlabel" target="_blank" rel="noreferrer">Instagram</a>
        </nav>
      </div>
      <p className="ft-legal">© {new Date().getFullYear()} Arcubed Label · Hand-crocheted in Jordan</p>
    </footer>
  );
}
