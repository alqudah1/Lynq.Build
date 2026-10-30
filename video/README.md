# Reels studio

This folder makes the rendered reels for the LYNQ and CodeIt plans, using [Remotion](https://www.remotion.dev). Remotion's free licence covers teams of 3 or fewer.

Nothing is screen recorded or AI generated. Every frame is drawn from React components:
- LYNQ reels use real client screenshots.
- CodeIt reels use the same Pip drawing as the CodeIt cards (`platform/src/lib/social-os/codeit-formats.ts`).

```bash
cd video
npm install
python3 scripts/music.py public/sfx                # original music beds, synthesised from scratch (no samples)
ffmpeg -i public/sfx/codeit-bed.wav -b:a 160k public/sfx/codeit-bed.mp3   # same for lynq-bed
./scripts/render-all.sh pip-ep1 lynq-housedeals    # renders to out/ and copies into platform/src/assets/reels
node scripts/stills.mjs pip-ep3 /tmp 1,5,9         # quick stills for review
```

To use a reel, name its file with `videoFile` in `platform/src/lib/social-os/week-plans.ts`. The plan loader uploads the file once and attaches it to the reel.

| File | What it does |
|---|---|
| `src/kit.tsx` | Fonts, springs, word-by-word captions, sound effects |
| `src/LynqCase.tsx` | LYNQ case reels (real site screenshots scrolling in a phone) |
| `src/pip-kit.tsx`, `src/PipSeries.tsx` | CodeIt's "Pip builds a game", five episodes |
| `public/sfx` | Sound effects (made with ffmpeg) and music beds (`scripts/music.py`) |
| `remotion.config.ts` | Points at the pre-installed headless Chromium. Change the path for your machine, or remove the line to let Remotion download one. |
