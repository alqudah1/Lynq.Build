"use client";

// The colourway wall, shortened on a phone.
//
// Sixteen tiles is a 5713px page at 390, and the wall is the last thing on
// it: a customer who wants Nova in gold scrolls past fifteen bags they did
// not ask for to reach the end of the Shop. On a phone the wall opens on six
// and the rest are one tap away.
//
// SIX, not eight. CollectionGrid promotes a tile to full width only when the
// current two-column row is empty, so the visible set has to end on a
// complete row or the last tile sits beside a hole. Six is three clean pairs;
// eight would end on the promoted tile plus an orphan.
//
// The remaining tiles stay in the DOM and are hidden with CSS, so they are
// still in the served HTML for a crawler and still findable with the
// browser's own find-in-page. This is a display state, not pagination: there
// is no second request and nothing is fetched on expand. Their images are
// lazy by default, so hidden tiles cost markup and no bytes.
//
// Above 760px the button is display:none and every tile shows, because the
// twelve-column wall is not the thing that made the page long.

import { useId, useState } from "react";

export default function ColourwayReveal({
  children,
  total,
}: {
  children: React.ReactNode;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const hidden = Math.max(0, total - 6);

  return (
    <div className="cw-reveal" data-open={open ? "true" : "false"}>
      <div id={id}>{children}</div>
      {hidden > 0 ? (
        <button
          type="button"
          className="cw-more"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(true)}
          // Once the wall is open the control has nothing left to do, and a
          // "show less" that scrolls the customer back up the page is a worse
          // outcome than a button that simply retires.
          hidden={open}
        >
          View all {total} colourways
        </button>
      ) : null}
    </div>
  );
}
