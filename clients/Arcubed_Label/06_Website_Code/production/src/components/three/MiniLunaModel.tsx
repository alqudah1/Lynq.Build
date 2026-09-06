"use client";

// Mini Luna, built rather than loaded. DEV ONLY until reviewed against the
// frames — see src/lib/three/models/mini-luna.ts for what each dimension is
// worth, and /dev/mini-luna for the side-by-side against the photography.

import { useMemo } from "react";
import * as THREE from "three";
import {
  bodyGeometry,
  rimGeometry,
  handleGeometry,
  displaceCrochet,
  MINI_LUNA_PARAMS,
} from "@/lib/three/models/mini-luna";
import { crochetMaps, METALLIC_FINISH, MATTE_FINISH } from "@/lib/three/models/crochet-texture";

export interface MiniLunaColourway {
  name: string;
  /** Measured off the archive photography by scripts/measure-colour.mjs. */
  primary: string;
  /** Set only for the two-tone colourway; drives alternating rounds. */
  secondary: string | null;
  metallic: boolean;
}

/**
 * Mini Luna's five colourways. Hexes are MEASURED, not chosen: each is the
 * median of the lit half of that colourway's own frame (scripts/measure-colour.mjs).
 *
 * Silver & Gold carries both colours because it is worked as alternating
 * rounds across body and handle — confirmed by comparing DSC04870 against the
 * single-colour DSC04874.
 */
export const MINI_LUNA_COLOURWAYS: MiniLunaColourway[] = [
  { name: "Red", primary: "#be2f2c", secondary: null, metallic: true },
  { name: "Silver", primary: "#a2a5a5", secondary: null, metallic: true },
  { name: "Gold", primary: "#d6b572", secondary: null, metallic: true },
  { name: "Black", primary: "#14181a", secondary: null, metallic: false },
  { name: "Silver & Gold", primary: "#a2a5a5", secondary: "#d6b572", metallic: true },
];

const ROUNDS = MINI_LUNA_PARAMS.bodyRounds.value;
/** Stitches around the body, counted off DSC05774's front face and doubled. */
const COLS = 24;

// Stitch SIZE must be constant across the bag — a crochet round is the same
// physical thickness whether it is going around the body or along the handle.
// So each part's texture repeat is computed from its real dimensions rather
// than left at 1, which would stretch a whole 34x9 sheet over a thin tube.
const RIM_PERIMETER = Math.PI * (1.5 * (0.5 + MINI_LUNA_PARAMS.bodyDepth.value / 2)
  - Math.sqrt(0.5 * MINI_LUNA_PARAMS.bodyDepth.value / 2));
const STITCH_PITCH = RIM_PERIMETER / COLS;
const ROUND_PITCH = MINI_LUNA_PARAMS.bodyHeight.value / ROUNDS;

/** Repeats for a tube: (around its circumference, along its length). */
function tubeRepeat(radius: number, length: number): [number, number] {
  // Rounded to whole stitches so the pattern meets itself instead of seaming.
  const around = Math.max(1, Math.round((2 * Math.PI * radius) / STITCH_PITCH));
  const along = Math.max(1, Math.round(length / ROUND_PITCH));
  return [around / COLS, along / ROUNDS];
}

// Semi-ellipse arc length of the handle, Ramanujan's approximation on the half.
const HANDLE_ARC = (() => {
  const hs = MINI_LUNA_PARAMS.handleSpan.value / 2;
  const hr = MINI_LUNA_PARAMS.handleRise.value + MINI_LUNA_PARAMS.handleRootDrop.value;
  return (Math.PI * (3 * (hs + hr) - Math.sqrt((3 * hs + hr) * (hs + 3 * hr)))) / 2;
})();

/**
 * Repeats shared by the displacement and the maps, so both tile the stitch
 * sheet identically. Returned fresh each call rather than held in a module
 * constant: the arrays are handed to code that configures textures, and a
 * shared mutable array at module scope is exactly what should not be passed
 * around for that.
 */
function stitchRepeats(): Record<"body" | "rim" | "handle", [number, number]> {
  return {
    body: [1, 1],
    // The rim's UVs are unswapped (see rimGeometry), so its axes are the other
    // way round from the handle's: stitches run along the tube, rounds wrap it.
    rim: [
      Math.round(RIM_PERIMETER / STITCH_PITCH) / COLS,
      Math.max(1, Math.round((2 * Math.PI * MINI_LUNA_PARAMS.rimRadius.value) / ROUND_PITCH)) / ROUNDS,
    ],
    handle: tubeRepeat(MINI_LUNA_PARAMS.handleRadius.value, HANDLE_ARC),
  };
}

export default function MiniLunaModel({ colourway }: { colourway: MiniLunaColourway }) {
  const geo = useMemo(() => {
    const amp = STITCH_PITCH * 0.32;
    const REPEATS = stitchRepeats();
    return {
      // v is height above the base, so this fades the relief out over the
      // bottom few percent where the rings converge on a point.
      body: displaceCrochet(bodyGeometry(), COLS, ROUNDS, REPEATS.body, amp, (_u, v) =>
        Math.min(1, Math.max(0, v / 0.16))
      ),
      rim: displaceCrochet(rimGeometry(), COLS, ROUNDS, REPEATS.rim, amp),
      handle: displaceCrochet(handleGeometry(), COLS, ROUNDS, REPEATS.handle, amp),
    };
  }, []);

  // One set of maps per colourway. Each part then gets its own clones with a
  // different repeat, so stitch SIZE stays constant across body, rim and
  // handle instead of stretching to fit whatever UVs each part happens to
  // have — the tubes' UVs run along the tube and need many more repeats than
  // the body's single wrap.
  const parts = useMemo(() => {
    const REPEATS = stitchRepeats();
    const base = crochetMaps(colourway.primary, colourway.secondary, COLS, ROUNDS);
    const forPart = (rx: number, ry: number) => {
      const out: Record<string, THREE.Texture> = {};
      for (const [k, t] of Object.entries(base)) {
        const c = t.clone();
        c.wrapS = c.wrapT = THREE.RepeatWrapping;
        c.repeat.set(rx, ry);
        c.needsUpdate = true;
        out[k] = c;
      }
      return out as { color: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture };
    };
    const [bx, by] = REPEATS.body;
    const [rx, ry] = REPEATS.rim;
    const [hx, hy] = REPEATS.handle;
    return { body: forPart(bx, by), rim: forPart(rx, ry), handle: forPart(hx, hy) };
  }, [colourway]);

  const finish = colourway.metallic ? METALLIC_FINISH : MATTE_FINISH;

  return (
    <group name="mini_luna">
      <mesh name="bag_body_primary" geometry={geo.body}>
        <meshStandardMaterial
          map={parts.body.color}
          normalMap={parts.body.normal}
          roughnessMap={parts.body.roughness}
          normalScale={new THREE.Vector2(1.2, 1.2)}
          side={THREE.DoubleSide}
          {...finish}
        />
      </mesh>
      <mesh name="bag_rim" geometry={geo.rim}>
        <meshStandardMaterial
          map={parts.rim.color}
          normalMap={parts.rim.normal}
          roughnessMap={parts.rim.roughness}
          normalScale={new THREE.Vector2(1, 1)}
          {...finish}
        />
      </mesh>
      <mesh name="handle" geometry={geo.handle}>
        <meshStandardMaterial
          map={parts.handle.color}
          normalMap={parts.handle.normal}
          roughnessMap={parts.handle.roughness}
          normalScale={new THREE.Vector2(1.1, 1.1)}
          {...finish}
        />
      </mesh>
    </group>
  );
}
