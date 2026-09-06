// DEV ONLY — 404s in production via src/proxy.ts. Nothing here is customer
// facing, and no GLB is written to public/models/ by any of it.

import dynamic from "next/dynamic";

const MiniLunaStage = dynamic(() => import("./MiniLunaStage"), {
  loading: () => <p className="ml-note">Loading the model…</p>,
});

export const metadata = { title: "Mini Luna — model review (dev)" };

export default function MiniLunaDevPage() {
  return (
    <main className="ml-page">
      <p className="eyebrow">Dev · model review</p>
      <h1 className="ml-h1">Mini Luna</h1>
      <p className="ml-lead">
        Geometry generated from the measured evidence, shown against the frame each colourway was
        measured from. This page exists to answer one question: is this the Arcubed bag, or is it a
        generic bag wearing its name? Until the answer is clearly the first, the storefront keeps
        showing photography.
      </p>
      <MiniLunaStage />
    </main>
  );
}
