"use client";

// MODEL FIRST collection.
//
// The colourway wall presented every pairing as its own product, so a tile
// reading "Nova / Gold" implied Nova IS gold. A customer had no way to know
// from the grid that Nova comes in six colours. Here the MODEL is the subject
// and colour is a property of it: one block per shape, the count stated
// plainly, and every colourway present as a real photographic swatch.
//
// Swatches are photographs, never hex dots. Most Arcubed colours are metallics
// defined by sheen, so a flat circle either lies about the material or says
// nothing. Choosing one re-dresses the whole block — image, field colour and
// the link target — so exploring colour happens here rather than after a
// page load.

import { useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Bag } from "@/lib/types";
import { money } from "@/lib/pricing";
import { framesForColour, tileSrc, altFor } from "@/lib/product-media";
import { COLLECTION } from "@/lib/collection";
import { variantHref } from "@/lib/variant";

type Way = { colour: string; field: string; src: string; ratio: number; alt: string; href: string; photo: boolean };

export default function ModelCollection({ bags }: { bags: Bag[] }) {
  const bySlug = new Map(bags.map((b) => [b.slug, b]));

  // Grouped from the SAME verified list the wall uses, so the two can never
  // disagree about which colourways exist.
  const order: string[] = [];
  const grouped = new Map<string, { product: string; bag: Bag; ways: Way[] }>();
  for (const e of COLLECTION) {
    const bag = bySlug.get(e.slug);
    const frame = bag ? framesForColour(bag, e.colour)[0] : undefined;
    if (!bag || !frame) continue;
    if (!grouped.has(e.slug)) {
      grouped.set(e.slug, { product: e.product, bag, ways: [] });
      order.push(e.slug);
    }
    const photo = Boolean(e.forcePhoto) || !frame.cutOk;
    grouped.get(e.slug)!.ways.push({
      colour: e.colour,
      field: e.field,
      src: photo ? frame.photo : tileSrc(frame),
      ratio: frame.ratio,
      alt: altFor(bag, e.colour),
      href: variantHref(bag.slug, e.colour),
      photo,
    });
  }

  return (
    <ul className="mc">
      {order.map((slug) => {
        const g = grouped.get(slug)!;
        return <ModelBlock key={slug} product={g.product} bag={g.bag} ways={g.ways} />;
      })}
    </ul>
  );
}

function ModelBlock({ product, bag, ways }: { product: string; bag: Bag; ways: Way[] }) {
  const [i, setI] = useState(0);
  const on = ways[i];
  const n = ways.length;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Roving tabindex. Tab reaches the strip once and the arrows move inside it,
  // rather than every swatch being its own tab stop — with six colourways that
  // turned a single choice into six stops between the image and the link.
  // Focus moves, and each button's own onFocus selects it, so keyboard and
  // pointer end up in exactly the same state and the deep link follows.
  const move = (next: number) => {
    const k = (next + n) % n;
    setI(k);
    refs.current[k]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(i + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(i - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(n - 1);
        break;
      default:
        break;
    }
  };

  // The block carries its slug so the stylesheet can art-direct each model
  // rather than repeating one component four times. Frame proportion varies
  // by ROW (so the two blocks beside each other still align and the footer
  // meets a straight edge) and object scale varies by MODEL.
  return (
    <li className={`mc-block mc-${bag.slug}`}>
      <Link href={on.href} className="mc-stage" style={{ background: on.photo ? undefined : on.field }}>
        <Image
          key={on.colour}
          src={on.src}
          alt={on.alt}
          width={1400}
          height={Math.round(1400 / on.ratio)}
          // 92vw on a phone was resolving to a candidate narrower than the
          // rendered box once the per-model padding changed, which pushed the
          // Vault tile to a 1.13 upscale. 100vw picks the next candidate up.
          sizes="(max-width: 700px) 100vw, (max-width: 1080px) 48vw, 46vw"
          className={on.photo ? "mc-photo" : "mc-cut"}
        />
      </Link>

      <div className="mc-meta">
        <p className="mc-name">{product}</p>
        {/* The whole point of this block: the count is louder than the colour. */}
        <p className="mc-count">
          {n} {n === 1 ? "colour" : "colours"}
        </p>
        <p className="mc-price">{money(bag.basePrice)}</p>
      </div>

      <div className="mc-ways" role="group" aria-label={`${product} colours`} onKeyDown={onKeyDown}>
        {ways.map((w, k) => (
          <button
            key={w.colour}
            type="button"
            ref={(el) => { refs.current[k] = el; }}
            className={`mc-way${k === i ? " is-on" : ""}`}
            style={{ background: w.photo ? undefined : w.field }}
            aria-pressed={k === i}
            aria-label={`${product} in ${w.colour}`}
            tabIndex={k === i ? 0 : -1}
            onMouseEnter={() => setI(k)}
            onFocus={() => setI(k)}
            onClick={() => setI(k)}
          >
            <Image src={w.src} alt="" aria-hidden="true" width={280}
                   height={Math.round(280 / w.ratio)} sizes="72px" />
          </button>
        ))}
      </div>

      <p className="mc-foot">
        <span className="mc-shown">Shown in {on.colour}</span>
        <Link href={on.href} className="mc-view">
          View {product}
        </Link>
      </p>
    </li>
  );
}
