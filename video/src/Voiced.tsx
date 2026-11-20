import React from "react";
import { AbsoluteFill, Audio, Freeze, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Sfx, SfxOff } from "./kit";
import { LynqElevenPmRF } from "./LynqElevenPm";
import { CodeItTablet, CodeItMoon, CodeItDay1 } from "./CodeItReels";
import { LynqNotes } from "./LynqNotes";
import { LynqOffer } from "./LynqOffer";
import { LynqSketch } from "./LynqSketch";

/*
 * Voiced cuts. The picture is retimed to the voice: `map` pairs output seconds with the
 * silent reel's own seconds, and the reel is frozen on the matching frame. The reel's own
 * sound effects are switched off; a few are placed again here under the voice.
 */
const Retimed: React.FC<{ map: [number, number][]; vo: string; voAt: number; sfx?: [number, string, number][]; children: React.ReactNode }> = ({ map, vo, voAt, sfx = [], children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bt = interpolate(frame / fps, map.map((m) => m[0]), map.map((m) => m[1]), { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <SfxOff.Provider value={true}>
        <Freeze frame={Math.round(bt * fps)}>{children}</Freeze>
      </SfxOff.Provider>
      <Sequence from={Math.round(voAt * fps)} layout="none"><Audio src={staticFile(`vo/${vo}`)} /></Sequence>
      {sfx.map(([at, src, v]) => <Sfx key={`${at}${src}`} at={at} src={src} volume={v} />)}
    </AbsoluteFill>
  );
};

export const LYNQ11_VO_DUR = 30.4;
export const LynqElevenPmVO: React.FC = () => (
  <Retimed vo="lynq-11pm.mp3" voAt={0.15}
    map={[[0, 0], [2.9, 2.6], [6.4, 5.35], [8.45, 8.15], [10.65, 10.95], [13.4, 13.35], [16.6, 15.65], [18.9, 17.45], [21.1, 19.05], [23.3, 22.05], [30.4, 25.5]]}
    sfx={[[0.1, "ding.wav", 0.35], [9.4, "ding.wav", 0.3], [12.0, "ding.wav", 0.3], [21.5, "ding.wav", 0.25], [21.9, "ding.wav", 0.25], [22.3, "ding.wav", 0.25]]}>
    <LynqElevenPmRF />
  </Retimed>
);

export const TABLET_VO_DUR = 16.6;
export const CodeItTabletVO: React.FC = () => (
  <Retimed vo="codeit-tablet.mp3" voAt={0.1}
    map={[[0, 0], [2.25, 2.65], [4.3, 5.25], [7.0, 9.55], [9.4, 11.85], [11.75, 13.75], [16.6, 17.5]]}
    sfx={[[0.45, "whoosh.wav", 0.3], [6.2, "click.wav", 0.4], [9.4, "pop.wav", 0.4]]}>
    <CodeItTablet />
  </Retimed>
);

export const LynqSketchVO: React.FC = () => (
  <Retimed vo="lynq-sketch.mp3" voAt={0.3}
    map={[[0, 0], [2.3, 3.5], [4.4, 7.3], [6.6, 10.9], [6.75, 11.05], [12.3, 14]]}
    sfx={[[2.35, "whoosh.wav", 0.35], [3.2, "ding.wav", 0.3], [4.6, "pop.wav", 0.3], [5.2, "pop.wav", 0.3], [5.8, "pop.wav", 0.3]]}>
    <LynqSketch />
  </Retimed>
);

export const CodeItMoonVO: React.FC = () => (
  <Retimed vo="codeit-moon.mp3" voAt={0.1}
    map={[[0, 0], [1.9, 2.3], [2.4, 2.8], [4.4, 5.0], [4.7, 5.3], [6.3, 7.0], [7.6, 8.3], [7.9, 8.5], [11.05, 11.05], [12.7, 12.85], [17.5, 16.5]]}
    sfx={[[0.0, "whoosh.wav", 0.35], [1.9, "whoosh.wav", 0.3], [6.3, "click.wav", 0.4], [7.6, "whoosh.wav", 0.45]]}>
    <CodeItMoon />
  </Retimed>
);

export const LynqNotesVO: React.FC = () => (
  <Retimed vo="lynq-notes.mp3" voAt={0.15}
    map={[[0, 0], [2.75, 2.85], [5.55, 5.85], [8.1, 8.6], [10.45, 11.45], [11.9, 13.4], [13.5, 15.2], [20, 18]]}
    sfx={[[6.2, "thump.wav", 0.4], [8.1, "whoosh.wav", 0.3], [12.7, "ding.wav", 0.35]]}>
    <LynqNotes />
  </Retimed>
);

export const LynqOfferVO: React.FC = () => (
  <Retimed vo="lynq-offer.mp3" voAt={0.1}
    map={[[0, 0.1], [2.6, 2.4], [4.25, 3.3], [5.8, 4.5], [7.1, 5.7], [8.5, 7.4], [8.7, 7.75], [10.6, 8.15], [12.1, 8.95], [13.95, 9.55], [15.5, 10.6], [15.75, 11.0], [21, 13]]}
    sfx={[[4.25, "pop.wav", 0.3], [5.8, "pop.wav", 0.3], [7.1, "pop.wav", 0.3], [10.6, "thump.wav", 0.3], [12.1, "thump.wav", 0.3]]}>
    <LynqOffer />
  </Retimed>
);

export const CodeItDay1VO: React.FC = () => (
  <Retimed vo="codeit-day1.mp3" voAt={0.1}
    map={[[0, 0], [2.3, 2.3], [3.1, 2.9], [3.3, 3.1], [5.3, 5.65], [6.5, 6.55], [7.7, 8.6], [9.05, 10.85], [10.2, 11.6], [12.2, 13.25], [16.8, 16.5]]}
    sfx={[[3.3, "crash.wav", 0.35], [6.55, "pop.wav", 0.4], [9.1, "ding.wav", 0.45]]}>
    <CodeItDay1 />
  </Retimed>
);
