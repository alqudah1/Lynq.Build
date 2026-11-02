import React from "react";
import { Audio, Easing, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Sequence } from "remotion";

export const FONTS = `
@font-face { font-family: "Inter Light"; src: url(${staticFile("fonts/Inter-Light.otf")}); }
@font-face { font-family: "Inter SemiBold"; src: url(${staticFile("fonts/Inter-SemiBold.otf")}); }
@font-face { font-family: "Baloo 2"; src: url(${staticFile("fonts/Baloo2.ttf")}); font-weight: 400 800; }
@font-face { font-family: "Nunito"; src: url(${staticFile("fonts/Nunito.ttf")}); font-weight: 200 1000; }
@font-face { font-family: "JetBrains Mono"; src: url(${staticFile("fonts/JetBrainsMono.ttf")}); font-weight: 100 800; }
`;
const AR = "U+0600-06FF, U+0750-077F, U+0870-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200E, U+2010-2011, U+204F, U+2E41";
const FACES: [string, string, string?, string?][] = [
  ["Inter Light", "fonts/Inter-Light.otf"], ["Inter SemiBold", "fonts/Inter-SemiBold.otf"], ["Baloo 2", "fonts/Baloo2.ttf", "400 800"], ["Nunito", "fonts/Nunito.ttf", "200 1000"], ["JetBrains Mono", "fonts/JetBrainsMono.ttf", "100 800"], ["Outfit Bold", "fonts/Outfit-Bold.ttf"], ["Outfit Regular", "fonts/Outfit-Regular.ttf"],
  // IBM Plex Sans Arabic (SIL Open Font License, see fonts/PlexArabic-OFL.txt), for the Arabic cuts.
  ["IBM Plex Sans Arabic", "fonts/PlexArabic-400-arabic.woff2", undefined, AR], ["IBM Plex Sans Arabic", "fonts/PlexArabic-400-latin.woff2"],
  ["IBM Plex Sans Arabic SemiBold", "fonts/PlexArabic-600-arabic.woff2", undefined, AR], ["IBM Plex Sans Arabic SemiBold", "fonts/PlexArabic-600-latin.woff2"],
  // Baloo Bhaijaan 2 (SIL Open Font License, see fonts/BalooBhaijaan2-OFL.txt), the Arabic sibling of Baloo 2, for Pip.
  ["Baloo Bhaijaan 2", "fonts/BalooBhaijaan2-700-arabic.woff2", "700", AR], ["Baloo Bhaijaan 2", "fonts/BalooBhaijaan2-700-latin.woff2", "700"],
];
let fontsLoaded: Promise<unknown> | null = null;
/** Loads the bundled fonts before the first frame is captured. */
export const Fonts: React.FC = () => {
  const [handle] = React.useState(() => delayRender("fonts"));
  React.useEffect(() => {
    fontsLoaded ??= Promise.all(FACES.map(([family, file, weight, unicodeRange]) => new FontFace(family, `url(${staticFile(file)})`, { ...(weight ? { weight } : {}), ...(unicodeRange ? { unicodeRange } : {}) }).load().then((f) => document.fonts.add(f))));
    fontsLoaded.then(() => continueRender(handle), () => continueRender(handle));
  }, [handle]);
  return null;
};

export const useT = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { frame, fps, s: frame / fps };
};

/** Spring from 0 to 1 starting at second `at`. */
export const useSpringAt = (at: number, cfg: { damping?: number; stiffness?: number; mass?: number } = {}) => {
  const { frame, fps } = useT();
  return spring({ frame: frame - Math.round(at * fps), fps, config: { damping: cfg.damping ?? 14, stiffness: cfg.stiffness ?? 160, mass: cfg.mass ?? 0.7 } });
};

export const ramp = (s: number, a: number, b: number, from = 0, to = 1, ease = Easing.bezier(0.33, 1, 0.68, 1)) =>
  interpolate(s, [a, b], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });

/** One sound effect at second `at`. */
export const Sfx: React.FC<{ at: number; src: string; volume?: number }> = ({ at, src, volume = 1 }) => {
  const { fps } = useVideoConfig();
  return (
    <Sequence from={Math.round(at * fps)} durationInFrames={Math.round(fps * 1.2)} layout="none">
      <Audio src={staticFile(`sfx/${src}`)} volume={volume} />
    </Sequence>
  );
};

/**
 * Words that pop in one at a time from second `at` (TikTok-style captions).
 * `accent` words get the accent colour.
 */
export const Words: React.FC<{ text: string; at: number; every?: number; size: number; color: string; accent?: string; accentWords?: string[]; font: string; weight?: number; style?: React.CSSProperties; align?: "left" | "center"; out?: number; lineHeight?: number; letterSpacing?: number }> = ({ text, at, every = 0.09, size, color, accent, accentWords = [], font, weight = 700, style, align = "left", out, lineHeight = 1.05, letterSpacing = 0 }) => {
  const { s, frame, fps } = useT();
  const gone = out !== undefined ? ramp(s, out, out + 0.25, 0, 1) : 0;
  const words = text.split(" ");
  return (
    <div style={{ fontFamily: `'${font}'`, fontWeight: weight, fontSize: size, color, lineHeight, letterSpacing, textAlign: align, opacity: 1 - gone, transform: `translateY(${-gone * 30}px)`, ...style }}>
      {words.map((w, i) => {
        const p = spring({ frame: frame - Math.round((at + i * every) * fps), fps, config: { damping: 12, stiffness: 220, mass: 0.6 } });
        const hit = accent && accentWords.includes(w.replace(/[.,!?]/g, ""));
        return (
          <span key={i} style={{ display: "inline-block", marginRight: "0.24em", opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 40}px) scale(${0.8 + 0.2 * p})`, color: hit ? accent : undefined }}>
            {w === "\n" ? <br /> : w}
          </span>
        );
      })}
    </div>
  );
};

/** Fixed full-frame layer. */
export const Layer: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => <div style={{ position: "absolute", inset: 0, ...style }}>{children}</div>;
