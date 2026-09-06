import Link from "next/link";
import Image from "next/image";

export default function Footer() {
  return (
    <footer className="site-footer">
      <Image
        className="footer-logo"
        src="/brand/arcubed-wordmark-navy.png"
        alt="Arcubed Label"
        width={1116}
        height={298}
      />
      <p className="muted">Your new favourite bag.</p>
      <nav className="footer-links">
        <Link href="/shop">Shop</Link>
        <Link href="/ready-for-delivery">Ready for Delivery</Link>
        <Link href="/about">About</Link>
        <Link href="/faq">FAQ</Link>
        <Link href="/contact">Contact</Link>
      </nav>
    </footer>
  );
}
