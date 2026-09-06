# Material Pipeline — Yarn/Crochet, Metallic Yarn, Chain/Hardware

Shared by every body, strap, chain, and handle spec in this package. The
viewer (`BagModel.tsx`) uses standard Three.js `MeshStandardMaterial`
(metallic-roughness PBR) — every material below must be authored against
that model, not a custom shader, so it recolors correctly at runtime
(`material.color.set(hex)` is called directly on each named zone's
material).

**None of this exists yet.** The current dev placeholder uses flat,
deliberately-fake vertex colours with no texture work at all, specifically
so nobody mistakes it for a material study. Nothing below should be read as
"here is Arcubed's material" — it's the pipeline spec for producing one.

## Why "plastic crochet" happens (and how this avoids it)

A glossy, plastic look is almost always one or more of:

1. **Roughness too low.** A yarn surface is diffuse and matte-ish with
   micro-highlights, not a smooth reflective surface. Any roughness value
   below roughly **0.55** on a body material reads as plastic, full stop.
2. **No normal map.** A flat-shaded surface with only a base colour has no
   surface information for light to catch — it looks like injection-molded
   plastic regardless of the roughness value. Crochet's stitch structure
   *is* the material's visual identity; it must exist as real surface detail,
   not implied by the base colour texture alone.
3. **Metalness applied to non-metal parts.** `metalness` above ~0.05–0.1
   on a yarn material starts looking like a coated/painted plastic. Regular
   yarn body materials should have metalness at or near **0**.
4. **Base colour texture with baked-in fake shading.** A base/albedo map
   that already has highlights or ambient occlusion painted into it will
   look wrong under the viewer's actual lighting (three-point + `Environment`
   `apartment` preset) — keep albedo flat colour information only; let
   roughness/normal/AO do the shading work.

## Regular yarn body materials (Vault, Loco, and Nova/Mini Luna's primary
## and secondary zones where not metallic)

| Channel | Requirement |
|---|---|
| **Albedo/base colour** | Flat, unlit colour information only (no baked shadows/highlights/AO). This is what gets recoloured at runtime via `material.color` — so the *texture* should be a neutral, textured-but-colourless (or very desaturated) stitch pattern, and the actual hue comes from the material's `color` property being multiplied against it. If the texture itself carries strong colour, runtime recolouring will look wrong (tinted rather than replaced). |
| **Normal/bump** | Required. Real stitch-scale detail — individual loop/knot structure, not just a generic fabric weave. Should read clearly at the viewer's typical framing distance (~1.4–4.5 units, see README's camera note) without appearing noisy up close during zoom. |
| **Roughness** | 0.6–0.85 typical for cotton/acrylic yarn. Use a roughness *map* if the yarn has any sheen variation (e.g. between stitches and gaps) rather than a single flat value, for a believable non-uniform matte look. |
| **Metalness** | 0.0. Do not use metalness to fake sheen on regular yarn — that's what roughness variation and a subtle specular response are for. |
| **AO (optional)** | A baked or procedural ambient occlusion map in stitch crevices adds real depth cheaply — recommended, not required for a first pass. Multiply into the base colour map's alpha or a separate AO channel per your export pipeline; do not bake AO as darkening directly into the albedo colour that gets runtime-recoloured (see the albedo note above). |
| **Weave/stitch scale** | Model the normal map's texel density so one crochet stitch is legibly a few pixels across at the texture resolution target in `export-checklist.md` — too coarse and stitches disappear into mush, too fine and they alias/shimmer under the viewer's capped DPR. |

## Metallic yarn (Gold / Silver / Rose Gold colourways) — a *separate*
## approach from regular yarn

Metallic-thread yarn is still yarn — it must not become a smooth chrome
sphere. The failure mode here is the opposite direction from "plastic": go
too far toward `metalness = 1` with low roughness and it stops reading as
fabric entirely.

| Channel | Requirement |
|---|---|
| **Albedo/base colour** | Same flat/runtime-recolourable requirement as regular yarn above. |
| **Normal/bump** | Same stitch-scale detail requirement as regular yarn — the knit structure must survive being metallic. |
| **Roughness** | 0.35–0.55 — noticeably lower than regular yarn (more reflective highlights) but still well above a "polished metal" roughness (which would be closer to 0.05–0.2). This is the key number that keeps metallic yarn from becoming chrome. |
| **Metalness** | 0.4–0.7, not 1.0. A blended/partial metalness reads as "thread with metallic fiber content," which is what these colourways actually are; full metalness reads as a solid metal object. |
| **Environment response** | The viewer's `<Environment preset="apartment">` supplies the reflections metallic materials need — test metallic-yarn materials specifically in `/dev/3d-test` under that environment, not in an isolated authoring-tool viewport with different lighting, since the two will look meaningfully different. |

Treat this as a distinct material preset from regular yarn (different
roughness/metalness defaults), not a slider tweak on the same one — get both
presets right once and every metallic colourway reuses the same approach.

## Chains and hardware — real metal PBR, not yarn rules at all

`hardware` (clasps/buckles/rivets) and chain component GLBs (see
`chain-spec.md`) are not fabric and should not follow any of the yarn
guidance above.

| Channel | Requirement |
|---|---|
| **Albedo/base colour** | The metal's actual colour (brass/gold-tone, silver/steel-tone, etc.) — flat, no baked lighting. |
| **Roughness** | 0.15–0.35 for a "fine jewelry/hardware" finish — polished but not mirror. Push toward the lower end for a bright polished clasp, higher for a brushed/matte hardware finish if that's the real product's look once photographed. |
| **Metalness** | 0.9–1.0. Hardware and chain links are real metal — full or near-full metalness is correct here, unlike yarn. |
| **Normal/bump** | Optional but recommended for chain links (subtle wear/machining detail) — hardware pieces are usually small enough on screen that a normal map matters less than getting roughness/metalness right. |
| **Geometry vs. texture for chain link detail** | Prefer real link-to-link geometry (see `chain-spec.md`'s polygon budget) over trying to fake individual links with a texture on a tube — chains read as fake almost immediately when the geometry doesn't actually articulate. |

## Quick reference table

| Material | Roughness | Metalness | Normal map |
|---|---|---|---|
| Regular yarn (body) | 0.6–0.85 | 0.0 | Required, stitch-scale |
| Metallic yarn (Gold/Silver/Rose Gold) | 0.35–0.55 | 0.4–0.7 | Required, stitch-scale |
| Hardware / chain | 0.15–0.35 | 0.9–1.0 | Optional |

## Testing materials in `/dev/3d-test`

The dev rig applies whatever hex the selected dev colour carries directly to
`material.color` on `bag_body_primary`/`bag_body_secondary` — it does not
yet exercise a real texture/normal/roughness pipeline (no `material_ref`
resolution exists client-side yet, see `../3d-assets.md`'s colour-priority
section). To actually evaluate a textured material as authored, load the
candidate GLB directly in a standalone Three.js/glTF viewer (e.g.
`https://gltf-viewer.donmccurdy.com/` or your DCC tool's glTF preview) under
comparable lighting (one strong key light + soft fill + a neutral
environment) before considering it final — `/dev/3d-test` proves the
*rigging* (nodes, attach points, colour-swap wiring), not final material
fidelity.
