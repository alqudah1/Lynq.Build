# GLB Export Checklist

Run through this for every file — body, strap, chain, handle — before it
goes anywhere near `/dev/3d-test`.

## File format

- **`.glb`** (binary glTF 2.0), not `.gltf` + separate assets. One file per
  part, no external texture/bin references.
- `public.model_assets.format` supports `'glb'` or `'gltf'` — always use
  `glb` for anything actually shipped; `gltf` exists for debugging only.

## Compression: Draco

- **Draco geometry compression: yes, for every file.** The viewer already
  self-hosts a decoder at `/draco/` (`DRACO_DECODER_PATH` in
  `model-contract.ts`, pointed at by `useGLTF.setDecoderPath()` in
  `BagModel.tsx`) — no exporter configuration needed on the app side, just
  enable Draco compression in your export tool.
- Recommended Draco quantization (Blender's glTF exporter and most other
  tools expose these directly):
  - Position: 14 bits
  - Normal: 10 bits
  - Texture coordinate (UV): 12 bits
  - Generic (vertex colour, if used): 8 bits
- **Do not enable Meshopt instead of or alongside Draco for a first
  submission.** The viewer's decoder is Draco-only right now (see
  `docs/3d-assets.md`) — a Meshopt-only file will fail to load. Meshopt is
  noted in the architecture as a possible future addition, not currently
  wired up; do not rely on it.

## Textures

- Embed textures in the GLB (binary-embedded, not external file
  references) — this is Draco/glTF-binary default behavior in virtually
  every exporter, just confirm your tool isn't set to "external" mode.
- Texture compression: prefer **KTX2/Basis Universal** if your export
  pipeline supports it — meaningfully smaller downloads on mobile than raw
  PNG/JPEG. If KTX2 isn't available in your pipeline yet, plain
  PNG (for anything needing alpha) or JPEG (opaque colour maps) embedded in
  the GLB is an acceptable first pass — note in your handoff that KTX2 is a
  follow-up, don't block a usable first model on it.
- See each bag/component spec for texture resolution targets per material
  slot (`material-spec.md` covers what each channel needs; per-spec files
  give the actual pixel dimensions).

## Scale, orientation, pivot — verify before export, not after

- Real-world meter scale (1 unit = 1 meter) — see the README's scale note
  for why and for the current camera-framing caveat.
- Y-up (glTF standard). Most exporters (Blender's glTF exporter in
  particular) handle the Z-up→Y-up conversion automatically on export —
  confirm the exported file is actually Y-up by checking it in a neutral
  glTF viewer before calling it done, don't just trust the export dialog.
- Apply all transforms before export (no un-applied rotation/scale on any
  mesh) — an un-applied transform is a common source of a model that looks
  right in your DCC tool but wrong (skewed, wrongly scaled) once loaded via
  `useGLTF`.
- See each bag/component spec's "Origin/pivot requirements" section — pivot
  placement is part-specific (a strap's origin needs to align with the
  body's `attach_strap` node; a body's origin is generally center-ground).

## Node names — the part of this that will not silently degrade if wrong

Double-check every node name against `src/lib/three/model-contract.ts`
character-for-character before export — these are matched by exact string
equality at runtime (`scene.getObjectByName(...)`), not fuzzy-matched:

Body GLB node names:

```
bag_body_primary
bag_body_secondary   (two-tone products only)
handle                (baked-in handle, Nova only)
hardware
attach_strap
attach_chain
attach_handle          (only if a product needs a swappable handle — none do today)
```

Strap/chain/handle component GLB root node names:

```
strap
chain
handle                (swappable handle component, if ever needed)
```

A misnamed or missing node doesn't crash the viewer — `BagModel.tsx`
degrades silently for that one part (no colour applied to a missing
`bag_body_secondary`; `AttachedPart` logs a console warning and simply
doesn't attach if its expected root node name is wrong). That silence is
exactly why this checklist and `qa-checklist.md`'s node-name verification
step exist — a wrong name will not announce itself.

## Materials

- One material per colour-independent zone (`bag_body_primary` and
  `bag_body_secondary` must NOT share a material instance in the source
  file — the viewer clones scenes but expects the source materials to
  already be logically separate per zone).
- Follow `material-spec.md` for channel values per part type.
- No unused/orphaned materials embedded in the file — keep exports clean,
  each material actually assigned to a node that ships.

## Cameras and lights — do not embed

The viewer supplies its own camera and lighting (`Canvas3D.tsx`). **Do not
export any camera or light objects into the GLB** — see
`qa-checklist.md`'s "no embedded unnecessary cameras/lights" item. Most DCC
exporters have a checkbox to exclude these; confirm it's off before export.

## Polygon and texture budgets

See each bag/component spec for the specific target per part. General
methodology, all mobile-first (customers arriving from Instagram on
phones):

- Triangle counts are targets for a good balance of visual quality vs. load
  time/frame budget on a mid-tier phone (roughly iPhone 12 / Pixel 6 class
  hardware) — not hard technical ceilings the viewer enforces. Exceeding a
  target by a small margin for a genuinely necessary detail (e.g. real chain
  link geometry) is a judgment call, not a QA failure by itself; exceeding
  it by multiples is.
- Texture resolution targets assume KTX2/Basis compression where available;
  if shipping uncompressed PNG/JPEG as a first pass, stay at or below the
  target rather than compensating with a larger uncompressed texture.
- Total compressed file size target (geometry + textures, Draco-compressed,
  KTX2 textures where available): **under 3MB per body GLB**, **under
  1MB per strap/chain/handle component GLB**. These map to the "mobile
  performance target" line in each spec.

## Final pre-handoff check

- [ ] File is `.glb`, Draco-compressed, textures embedded
- [ ] Y-up, real-world meter scale, all transforms applied
- [ ] Every required node name present and spelled exactly per
      `model-contract.ts`
- [ ] No embedded cameras/lights
- [ ] Materials match `material-spec.md` for each part type
- [ ] File size within the target for its part type
- [ ] Loaded and visually checked in a neutral glTF viewer (not just your
      DCC tool's viewport) before handoff
