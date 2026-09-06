"use client";

// DEVELOPMENT ONLY. Renders the evidence-driven blockouts live so their
// silhouettes can be judged against the source photography. These are massing
// studies, not products: flat matte material, no yarn texture, no colourways.

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";
import { useMemo, useState } from "react";
import { BLOCKOUTS, EVIDENCE_LABEL, auditSpec, productionBlockers, type BlockoutSpec } from "@/lib/three/blockouts/evidence";
import { buildBlockout } from "@/lib/three/blockouts/geometry";
import { BODY_NODE_NAMES } from "@/lib/three/model-contract";

function Blockout({ spec }: { spec: BlockoutSpec }) {
  const { body, handle, fringeEnvelope } = useMemo(() => buildBlockout(spec), [spec]);
  const lift = -spec.heightRatio.value / 2;

  return (
    <group position={[0, lift, 0]}>
      {/* Node names mirror model-contract.ts so the blockout is contract-shaped
          even though it is never exported. */}
      <mesh name={BODY_NODE_NAMES.primaryBody} geometry={body} castShadow>
        <meshStandardMaterial color="#8d8378" roughness={0.85} metalness={0} />
      </mesh>
      {handle ? (
        <mesh name={BODY_NODE_NAMES.handle} geometry={handle} castShadow>
          <meshStandardMaterial color="#6f6459" roughness={0.85} metalness={0} />
        </mesh>
      ) : null}
      {fringeEnvelope ? (
        <mesh geometry={fringeEnvelope}>
          <meshBasicMaterial color="#a33" wireframe />
        </mesh>
      ) : null}
    </group>
  );
}

export default function BlockoutStage() {
  const keys = Object.keys(BLOCKOUTS) as BlockoutSpec["key"][];
  const [active, setActive] = useState<BlockoutSpec["key"]>("vault");
  const spec = BLOCKOUTS[active];
  const blockers = productionBlockers(spec);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 380px", gap: 20, alignItems: "start" }}>
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {keys.map((k) => (
            <button
              key={k}
              onClick={() => setActive(k)}
              style={{
                padding: "7px 14px",
                borderRadius: 999,
                border: "1px solid #143562",
                background: k === active ? "#143562" : "transparent",
                color: k === active ? "#ffe0fd" : "#143562",
                fontSize: 13,
              }}
            >
              {BLOCKOUTS[k].label}
            </button>
          ))}
        </div>
        <div style={{ height: 520, background: "#faf6f1", borderRadius: 16, overflow: "hidden" }}>
          <Canvas shadows camera={{ position: [0, 0.15, 2.1], fov: 40 }}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[2, 3, 2]} intensity={1.1} castShadow />
            <Blockout spec={spec} />
            <ContactShadows position={[0, -0.55, 0]} opacity={0.35} blur={2.4} scale={4} />
            <Environment preset="apartment" />
            <OrbitControls makeDefault enablePan={false} />
          </Canvas>
        </div>
      </div>

      <aside style={{ fontSize: 13, lineHeight: 1.5 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 17 }}>{spec.label}</h2>
        <p style={{ margin: "0 0 14px", color: "#a33", fontWeight: 600 }}>
          {blockers.length} field{blockers.length === 1 ? "" : "s"} blocking production
        </p>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <tbody>
            {auditSpec(spec).map((row) => (
              <tr key={row.field} style={{ borderTop: "1px solid #eae2d7" }}>
                <td style={{ padding: "6px 8px 6px 0", fontFamily: "ui-monospace, monospace", verticalAlign: "top", whiteSpace: "nowrap" }}>
                  {row.field}
                </td>
                <td style={{ padding: "6px 0", verticalAlign: "top" }}>
                  <span
                    style={{
                      color:
                        row.grade === "UNRESOLVED"
                          ? "#a33"
                          : row.grade === "APPROXIMATION_FOR_BLOCKOUT"
                            ? "#b07d2b"
                            : "#143562",
                      fontWeight: 600,
                      fontSize: 11,
                    }}
                  >
                    {EVIDENCE_LABEL[row.grade]}
                  </span>
                  <div style={{ color: "#6f665e", fontSize: 12 }}>{row.source}</div>
                  {row.note ? <div style={{ color: "#a33", fontSize: 12, marginTop: 3 }}>{row.note}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </aside>
    </div>
  );
}
