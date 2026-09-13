"use client";

// One footer group, collapsible on a phone and always open above it.
//
// The footer used to print every group's contents at once. On a phone that is
// eleven lines of navy body copy in a column, four of them full sentences of
// shipping policy, and the client's words for it were that it reads as one
// big paragraph: she asked for sections to press instead.
//
// The disclosure is CSS-driven rather than conditional rendering, and that is
// deliberate. Rendering the panel only when `open` would mean the desktop
// footer depended on React state matching the viewport, which is a hydration
// mismatch waiting to happen and leaves the content missing entirely if the
// media query is ever wrong. Here the panel is always in the DOM: the phone
// hides it with a media query, and above 700px both the button and that rule
// stop applying, so every group is simply open with no JavaScript involved.
//
// The header is a real <button> with aria-expanded and aria-controls, not a
// div with a click handler, so it is reachable by keyboard and announced as a
// disclosure. Because the button is display:none on desktop it leaves the
// accessibility tree there too, which is correct: nothing is collapsible.

import { useId, useState } from "react";

export default function FooterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="ft-group">
      {/* The desktop heading. Hidden on a phone, where the button below is
          the heading, so the label is never announced twice. */}
      <p className="ft-h">{title}</p>

      <button
        type="button"
        className="ft-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{title}</span>
        {/* Drawn, not typed: a glyph would inherit the font's own metrics and
            sit off the optical centre of the row. aria-hidden because
            aria-expanded already carries the state. */}
        <span className="ft-pm" data-open={open ? "true" : "false"} aria-hidden="true" />
      </button>

      {/* Keeps .ft-col so the existing link typography and hover rule
          apply unchanged; .ft-panel only adds the disclosure behaviour. */}
      <div id={id} className="ft-col ft-panel" data-open={open ? "true" : "false"}>
        {children}
      </div>
    </div>
  );
}
