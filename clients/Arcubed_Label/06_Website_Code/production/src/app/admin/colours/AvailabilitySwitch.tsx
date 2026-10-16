"use client";

import { useState, useTransition } from "react";
import { setColourAvailability } from "./actions";

export default function AvailabilitySwitch({ productId, colourId, active, label }: { productId: string; colourId: string; active: boolean; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toggle = () => {
    const next = !active;
    if (!window.confirm(next ? `Put ${label} back on sale?` : `Take ${label} off sale? Customers will no longer see or order it.`)) return;
    start(async () => {
      const r = await setColourAvailability(productId, colourId, next);
      setError(r.ok ? null : r.error);
    });
  };
  return (
    <span className="cw-switch-wrap">
      <button type="button" className={`cw-switch${active ? " is-on" : ""}`} role="switch" aria-checked={active} aria-label={label} disabled={pending} onClick={toggle}>
        <span>{active ? "On sale" : "Off"}</span>
      </button>
      {error ? <span className="adm-error" role="alert">{error}</span> : null}
    </span>
  );
}
