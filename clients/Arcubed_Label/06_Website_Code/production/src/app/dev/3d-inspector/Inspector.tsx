"use client";

// DEVELOPMENT ONLY. Load an arbitrary candidate GLB by URL, run it through
// the validator (src/lib/three/validate-model.ts) against a chosen
// product's contract, and view it live through the SAME BagViewer3D/
// Canvas3D/BagModel stack the real storefront uses — so what you see here
// is what a real customer would see once the file is linked, not a
// separate preview pipeline that could drift from production behavior.

import { useCallback, useMemo, useState } from "react";
import { Box3, Vector3, type Object3D, type Mesh, type MeshStandardMaterial } from "three";
import BagViewer3D from "@/components/three/BagViewer3D";
import { validateModel, type ValidationReport, type AssetKind } from "@/lib/three/validate-model";
import { BODY_NODE_NAMES, ATTACH_POINT_NAMES, type ProductKey } from "@/lib/three/model-contract";
import type { Model3DRef } from "@/lib/types";

const PRODUCTS: ProductKey[] = ["nova", "vault", "mini-luna", "loco"];
const KINDS: AssetKind[] = ["body", "strap", "chain", "handle"];

interface MaterialInfo {
  nodeName: string;
  type: string;
  colorHex: string | null;
  roughness: number | null;
  metalness: number | null;
}

interface SceneInspection {
  nodeNames: string[];
  dimensions: { x: number; y: number; z: number };
  materials: MaterialInfo[];
  attachPositions: Record<string, [number, number, number] | null>;
}

function inspectScene(object: Object3D): SceneInspection {
  const nodeNames: string[] = [];
  const materials: MaterialInfo[] = [];
  object.traverse((node) => {
    if (node.name) nodeNames.push(node.name);
    const mesh = node as Mesh;
    if ((mesh as unknown as { isMesh?: boolean }).isMesh && mesh.material && !Array.isArray(mesh.material)) {
      const mat = mesh.material as MeshStandardMaterial;
      materials.push({
        nodeName: node.name || "(unnamed)",
        type: mat.type,
        colorHex: "color" in mat ? `#${mat.color.getHexString()}` : null,
        roughness: "roughness" in mat ? mat.roughness : null,
        metalness: "metalness" in mat ? mat.metalness : null,
      });
    }
  });

  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());

  const attachPositions: Record<string, [number, number, number] | null> = {};
  for (const name of Object.values(ATTACH_POINT_NAMES)) {
    const attachNode = object.getObjectByName(name);
    if (attachNode) {
      const world = attachNode.getWorldPosition(new Vector3());
      attachPositions[name] = [world.x, world.y, world.z];
    } else {
      attachPositions[name] = null;
    }
  }

  return { nodeNames, dimensions: { x: size.x, y: size.y, z: size.z }, materials, attachPositions };
}

function ReportPanel({ report }: { report: ValidationReport }) {
  return (
    <div className="inspector-report">
      <p className={`inspector-report-status${report.ok ? " ok" : " fail"}`}>
        {report.ok ? "✓ No blocking errors" : `✗ ${report.errors.length} blocking error(s)`}
      </p>
      {report.errors.length > 0 ? (
        <>
          <p className="inspector-report-heading">Errors</p>
          <ul>
            {report.errors.map((e, i) => (
              <li key={i} className="inspector-report-error">{e}</li>
            ))}
          </ul>
        </>
      ) : null}
      {report.warnings.length > 0 ? (
        <>
          <p className="inspector-report-heading">Warnings</p>
          <ul>
            {report.warnings.map((w, i) => (
              <li key={i} className="inspector-report-warning">{w}</li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="inspector-report-heading">Info</p>
      <ul>
        {report.info.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

export default function Inspector({
  devBodyUrl,
  devStrapUrl,
  devChainUrl,
}: {
  devBodyUrl?: string;
  devStrapUrl?: string;
  devChainUrl?: string;
}) {
  const [urlInput, setUrlInput] = useState("");
  const [kind, setKind] = useState<AssetKind>("body");
  const [product, setProduct] = useState<ProductKey>("nova");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [candidateUrl, setCandidateUrl] = useState<string | null>(null);
  const [primaryHex, setPrimaryHex] = useState("#143562");
  const [secondaryHex, setSecondaryHex] = useState<string | null>(null);
  const [attachDevStrap, setAttachDevStrap] = useState(true);
  const [attachDevChain, setAttachDevChain] = useState(true);
  const [inspection, setInspection] = useState<SceneInspection | null>(null);
  const [viewerKey, setViewerKey] = useState(0);

  const onSceneReady = useCallback((object: Object3D) => {
    setInspection(inspectScene(object));
  }, []);

  async function handleLoad() {
    const url = urlInput.trim();
    if (!url) return;
    setBusy(true);
    setLoadErr(null);
    setReport(null);
    setInspection(null);
    try {
      const r = await validateModel(url, kind, kind === "body" ? product : undefined);
      setReport(r);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Failed to load or parse this file.");
    } finally {
      setBusy(false);
    }
    setCandidateUrl(url);
    setViewerKey((k) => k + 1); // forces BagViewer3D to remount cleanly for a new candidate rather than diffing against the previous one
  }

  // Which body/strap/chain URLs actually feed the live viewer depends on
  // what kind of file is being inspected: a candidate BODY is viewed with
  // the dev placeholder strap/chain attached (to sanity-check attach
  // points exist), while a candidate STRAP/CHAIN is viewed attached onto
  // the dev placeholder BODY (to check the candidate's own alignment).
  const viewerBody: Model3DRef | null = useMemo(() => {
    if (!candidateUrl) return null;
    if (kind === "body") return { assetId: "inspector-candidate", glbUrl: candidateUrl, version: 0 };
    if (devBodyUrl) return { assetId: "inspector-dev-body", glbUrl: devBodyUrl, version: 0 };
    return null;
  }, [candidateUrl, kind, devBodyUrl]);

  const viewerStrap: Model3DRef | undefined = useMemo(() => {
    if (!candidateUrl) return undefined;
    if (kind === "strap") return { assetId: "inspector-candidate", glbUrl: candidateUrl, version: 0 };
    if (kind === "body" && attachDevStrap && devStrapUrl) return { assetId: "dev-strap", glbUrl: devStrapUrl, version: 0 };
    return undefined;
  }, [candidateUrl, kind, attachDevStrap, devStrapUrl]);

  const viewerChain: Model3DRef | undefined = useMemo(() => {
    if (!candidateUrl) return undefined;
    if (kind === "chain") return { assetId: "inspector-candidate", glbUrl: candidateUrl, version: 0 };
    if (kind === "body" && attachDevChain && devChainUrl) return { assetId: "dev-chain", glbUrl: devChainUrl, version: 0 };
    return undefined;
  }, [candidateUrl, kind, attachDevChain, devChainUrl]);

  return (
    <div className="inspector">
      <div className="inspector-controls">
        <label className="inspector-field">
          <span>Candidate GLB URL</span>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://... or /models/..."
          />
        </label>
        <label className="inspector-field">
          <span>Asset kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        {kind === "body" ? (
          <label className="inspector-field">
            <span>Validate against product</span>
            <select value={product} onChange={(e) => setProduct(e.target.value as ProductKey)}>
              {PRODUCTS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="button" className="btn btn-primary" onClick={handleLoad} disabled={busy || !urlInput.trim()}>
          {busy ? "Loading…" : "Load & Validate"}
        </button>
        {loadErr ? <p className="inspector-report-error">{loadErr}</p> : null}
      </div>

      {candidateUrl ? (
        <div className="inspector-body">
          <div className="inspector-viewer">
            {viewerBody ? (
              <BagViewer3D
                key={viewerKey}
                label="Inspector candidate"
                body={viewerBody}
                primaryColourHex={primaryHex}
                secondaryColourHex={secondaryHex}
                strap={viewerStrap}
                chain={viewerChain}
                onSceneReady={onSceneReady}
                fallback={<p className="page-copy">3D unavailable in this browser — falls back exactly as the real storefront would.</p>}
              />
            ) : (
              <p className="page-copy">
                No dev placeholder body available to attach this {kind} to — visual alignment check unavailable, validation results still apply above.
              </p>
            )}
          </div>

          <div className="inspector-side">
            <div className="opt-group">
              <p className="opt-label">Test colours</p>
              <label className="inspector-field">
                <span>Primary</span>
                <input type="color" value={primaryHex} onChange={(e) => setPrimaryHex(e.target.value)} />
              </label>
              <label className="inspector-field">
                <span>Secondary (two-tone)</span>
                <input
                  type="color"
                  value={secondaryHex ?? "#ffffff"}
                  onChange={(e) => setSecondaryHex(e.target.value)}
                />
                <button type="button" className="link-btn" onClick={() => setSecondaryHex(null)}>None</button>
              </label>
            </div>

            {kind === "body" ? (
              <div className="opt-group">
                <p className="opt-label">Attach dev components</p>
                <label className="inspector-checkbox">
                  <input type="checkbox" checked={attachDevStrap} onChange={(e) => setAttachDevStrap(e.target.checked)} />
                  <span>Dev strap at attach_strap</span>
                </label>
                <label className="inspector-checkbox">
                  <input type="checkbox" checked={attachDevChain} onChange={(e) => setAttachDevChain(e.target.checked)} />
                  <span>Dev chain at attach_chain</span>
                </label>
              </div>
            ) : null}

            {inspection ? (
              <>
                <div className="opt-group">
                  <p className="opt-label">Detected dimensions</p>
                  <p className="page-copy">
                    {inspection.dimensions.x.toFixed(3)} × {inspection.dimensions.y.toFixed(3)} × {inspection.dimensions.z.toFixed(3)} m
                  </p>
                </div>
                <div className="opt-group">
                  <p className="opt-label">Attach-point positions (world space)</p>
                  <ul className="inspector-list">
                    {Object.entries(inspection.attachPositions).map(([name, pos]) => (
                      <li key={name}>
                        <code>{name}</code>: {pos ? `[${pos.map((n) => n.toFixed(3)).join(", ")}]` : "not present"}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="opt-group">
                  <p className="opt-label">Detected materials</p>
                  <ul className="inspector-list">
                    {inspection.materials.map((m, i) => (
                      <li key={i}>
                        <code>{m.nodeName}</code> — {m.type}
                        {m.colorHex ? `, colour ${m.colorHex}` : ""}
                        {m.roughness !== null ? `, roughness ${m.roughness.toFixed(2)}` : ""}
                        {m.metalness !== null ? `, metalness ${m.metalness.toFixed(2)}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="opt-group">
                  <p className="opt-label">Node hierarchy (flat)</p>
                  <ul className="inspector-list inspector-node-list">
                    {inspection.nodeNames.map((n, i) => {
                      const isContractNode = ([BODY_NODE_NAMES.primaryBody, BODY_NODE_NAMES.secondaryBody, BODY_NODE_NAMES.handle, BODY_NODE_NAMES.hardware, ...Object.values(ATTACH_POINT_NAMES)] as string[]).includes(n);
                      return (
                        <li key={i} className={isContractNode ? "inspector-node-contract" : undefined}>
                          {n}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            ) : null}

            {report ? (
              <div className="opt-group">
                <p className="opt-label">Validation results</p>
                <ReportPanel report={report} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
