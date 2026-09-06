"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";
import { BackSide } from "three";
import MiniLunaModel, { MINI_LUNA_COLOURWAYS } from "@/components/three/MiniLunaModel";
import { reviewRows, MINI_LUNA_PARAMS } from "@/lib/three/models/mini-luna";

/** The frame each colourway is measured from, for the side-by-side. */
const REFERENCE: Record<string, string> = {
  Red: "DSC05774",
  Silver: "DSC04875",
  Gold: "DSC04874",
  Black: "DSC04872",
  "Silver & Gold": "DSC04870",
};

export default function MiniLunaStage() {
  const [i, setI] = useState(0);
  const cw = MINI_LUNA_COLOURWAYS[i];
  const open = reviewRows();

  return (
    <>
      <div className="chip-row" style={{ marginBottom: 20 }}>
        {MINI_LUNA_COLOURWAYS.map((c, n) => (
          <button key={c.name} type="button" className={`opt-chip${n === i ? " selected" : ""}`} onClick={() => setI(n)}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="ml-compare">
        <figure>
          <div className="ml-canvas">
            <Canvas dpr={[1, 2]} camera={{ fov: 32, position: [0, 0.25, 2.6] }} gl={{ antialias: true, alpha: true }}>
              <ambientLight intensity={0.42} />
              <directionalLight position={[2.4, 3.2, 2.2]} intensity={2.1} />
              <directionalLight position={[-2.6, 1.4, -1.8]} intensity={0.6} />
              <directionalLight position={[0, 1.2, 3.4]} intensity={0.7} />
              <Suspense fallback={null}>
                {/* Studio environment built in-scene rather than drei's
                    `preset`, which fetches an HDR from a CDN — an external
                    dependency the review page should not have, and one that
                    silently leaves metallic yarn unlit when it fails. */}
                <Environment resolution={128} environmentIntensity={0.6}>
                  <mesh scale={60}>
                    <sphereGeometry args={[1, 24, 24]} />
                    <meshBasicMaterial color="#efe9e1" side={BackSide} />
                  </mesh>
                  <mesh position={[0, 6, 4]} rotation={[-Math.PI / 3, 0, 0]} scale={[12, 12, 1]}>
                    <planeGeometry />
                    <meshBasicMaterial color="#ffffff" />
                  </mesh>
                  <mesh position={[-7, 1, -4]} rotation={[0, Math.PI / 3, 0]} scale={[8, 8, 1]}>
                    <planeGeometry />
                    <meshBasicMaterial color="#d8d2ca" />
                  </mesh>
                </Environment>
                <MiniLunaModel colourway={cw} />
                <ContactShadows position={[0, -MINI_LUNA_PARAMS.bodyHeight.value, 0]} opacity={0.4} scale={2.2} blur={2.2} far={0.6} />
              </Suspense>
              <OrbitControls makeDefault enablePan={false} minPolarAngle={Math.PI * 0.1} maxPolarAngle={Math.PI * 0.86} />
            </Canvas>
          </div>
          <figcaption>Generated model — {cw.name}</figcaption>
        </figure>
        <figure>
          <Image
            src={`/media/${REFERENCE[cw.name]}-cut-1200.webp`}
            alt={`Mini Luna in ${cw.name}, archive frame ${REFERENCE[cw.name]}`}
            width={1200} height={1035} className="ml-photo"
          />
          <figcaption>Archive photograph — {REFERENCE[cw.name]}</figcaption>
        </figure>
      </div>

      <h2 className="ml-h2">What this model is still guessing</h2>
      <p className="ml-note">
        {open.length} of {Object.keys(MINI_LUNA_PARAMS).length} parameters need a reviewer&rsquo;s eye —
        either they are not CONFIRMED, or they carry a note recording a correction or an open question.
        Until this list is short enough to accept, the model stays on this page and the storefront keeps
        showing photography.
      </p>
      <ul className="ml-open">
        {open.map((p) => (
          <li key={p.key}>
            <strong>{p.key}</strong> <span className={`ml-grade ml-${p.grade}`}>{p.grade.replace(/_/g, " ")}</span>
            <span className="ml-src">{p.source}</span>
            {p.note ? <span className="ml-note-row">{p.note}</span> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
