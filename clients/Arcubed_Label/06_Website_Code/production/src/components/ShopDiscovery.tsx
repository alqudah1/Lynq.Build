"use client";

import { useMemo, useState, type ReactNode } from "react";
import { COLLECTION } from "@/lib/collection";

/**
 * Shop entry layer.
 *
 * Arriving at sixteen tiles is a catalogue; arriving at a question is a shop.
 * Both rails are derived from the ACTUAL colourway list, so no category can
 * exist that has nothing behind it, and "All" is the default — the whole
 * collection stays visible and filtering is an invitation, not a gate.
 */
const SHAPES = ["Nova", "Vault", "Mini Luna", "Loco"] as const;

/** Colour rails match on the real colour NAMES, so "Gold" also finds Rose Gold
 *  and Silver & Gold. Nothing here is an invented family. */
const COLOURS = ["Gold", "Silver", "Black", "Brown", "Red", "Burgundy", "Olive"] as const;

export default function ShopDiscovery({ children }: { children: ReactNode }) {
  const [shape, setShape] = useState<string | null>(null);
  const [colour, setColour] = useState<string | null>(null);

  const counts = useMemo(() => {
    const s = new Map<string, number>();
    const c = new Map<string, number>();
    for (const e of COLLECTION) {
      s.set(e.product, (s.get(e.product) ?? 0) + 1);
      for (const k of COLOURS) if (e.colour.toLowerCase().includes(k.toLowerCase())) c.set(k, (c.get(k) ?? 0) + 1);
    }
    return { s, c };
  }, []);

  const shown = useMemo(
    () =>
      COLLECTION.filter(
        (e) =>
          (!shape || e.product === shape) &&
          (!colour || e.colour.toLowerCase().includes(colour.toLowerCase()))
      ).length,
    [shape, colour]
  );

  return (
    <>
      <div className="disc">
        <div className="disc-rail">
          <p className="disc-label">By shape</p>
          <div className="disc-opts">
            <button type="button" className={`disc-opt${!shape ? " is-on" : ""}`} onClick={() => setShape(null)}>
              All
            </button>
            {SHAPES.map((s) => (
              <button
                key={s}
                type="button"
                className={`disc-opt${shape === s ? " is-on" : ""}`}
                onClick={() => setShape(shape === s ? null : s)}
              >
                {s} <i>{counts.s.get(s) ?? 0}</i>
              </button>
            ))}
          </div>
        </div>

        <div className="disc-rail">
          <p className="disc-label">By colour</p>
          <div className="disc-opts">
            <button type="button" className={`disc-opt${!colour ? " is-on" : ""}`} onClick={() => setColour(null)}>
              All
            </button>
            {COLOURS.filter((c) => counts.c.get(c)).map((c) => (
              <button
                key={c}
                type="button"
                className={`disc-opt${colour === c ? " is-on" : ""}`}
                onClick={() => setColour(colour === c ? null : c)}
              >
                {c} <i>{counts.c.get(c)}</i>
              </button>
            ))}
          </div>
        </div>

        <p className="disc-count">
          {shown} {shown === 1 ? "piece" : "pieces"}
        </p>
      </div>

      {/* The grid is rendered by the server component and filtered here with a
          data attribute, so filtering costs no re-fetch and the full
          collection is always in the DOM. */}
      <div className="disc-grid" data-shape={shape ?? ""} data-colour={colour ?? ""}>
        {children}
      </div>
    </>
  );
}
