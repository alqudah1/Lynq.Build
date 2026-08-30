import "server-only";

import React from "react";
import { ImageResponse } from "next/og";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { put } from "@vercel/blob";
import ffmpegPath from "ffmpeg-static";
import { marketingContentStudioDrafts } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireMarketingManageContentAuthority, resolveMarketingAuthContext } from "./authz";
import { getStudioDraftForUser, listBrandProfiles, type ContentStudioDraft, type MarketingBrandProfile } from "./content-studio";
import { contentStudioPackageSchema, type ContentStudioPackage } from "./validation";
import { generateRunwayMotionClip, isRunwayPremiumRendererConfigured } from "./providers/runway";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export const CONTENT_STUDIO_VIDEO_MODEL = "lynq-office-motion-renderer-v4";
export const CONTENT_STUDIO_DESIGN_RENDERER = "lynq-office-brand-renderer-v4";

type CodeItScene = "mascot" | "logo" | "home" | "builder" | "builtGame" | "gamePlay" | "lessons" | "playground" | "output" | "explore" | "cta";

type CodeItAssets = {
  mascot: string;
  logo: string;
  home: string;
  builder: string;
  builtGame: string;
  gamePlay: string;
  lessons: string;
  playground: string;
  output: string;
  explore: string;
};

type LynqScene = "brand" | "website" | "portfolio" | "systems" | "office" | "automation" | "cta";
type LynqAssets = { logo: string; brandCard: string; website: string; portfolio: string };

let codeItAssetsPromise: Promise<CodeItAssets> | null = null;
let lynqAssetsPromise: Promise<LynqAssets> | null = null;

function dataUri(bytes: Buffer, contentType: string) {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

function loadCodeItAssets() {
  codeItAssetsPromise ??= (async () => {
    const base = join(process.cwd(), "public", "content-studio", "codeitlearn");
    const [mascot, logo, home, builder, builtGame, gamePlay, lessons, playground, output, explore] = await Promise.all([
      readFile(join(base, "pixel-mascot-hero.png")),
      readFile(join(base, "codeit-logo.png")),
      readFile(join(base, "home.jpg")),
      readFile(join(base, "project-builder.png")),
      readFile(join(base, "built-game.png")),
      readFile(join(base, "game-playing.png")),
      readFile(join(base, "lessons.jpg")),
      readFile(join(base, "playground.jpg")),
      readFile(join(base, "playground-output.jpg")),
      readFile(join(base, "explore.jpg")),
    ]);
    return {
      mascot: dataUri(mascot, "image/png"),
      logo: dataUri(logo, "image/png"),
      home: dataUri(home, "image/jpeg"),
      builder: dataUri(builder, "image/png"),
      builtGame: dataUri(builtGame, "image/png"),
      gamePlay: dataUri(gamePlay, "image/png"),
      lessons: dataUri(lessons, "image/jpeg"),
      playground: dataUri(playground, "image/jpeg"),
      output: dataUri(output, "image/jpeg"),
      explore: dataUri(explore, "image/jpeg"),
    };
  })();
  return codeItAssetsPromise;
}

function loadLynqAssets() {
  lynqAssetsPromise ??= (async () => {
    const base = join(process.cwd(), "public", "content-studio", "lynq");
    const [logo, brandCard, website, portfolio] = await Promise.all([
      readFile(join(base, "logo.svg")), readFile(join(base, "brand-card.png")), readFile(join(base, "website.jpg")), readFile(join(base, "portfolio.jpg")),
    ]);
    return { logo: dataUri(logo, "image/svg+xml"), brandCard: dataUri(brandCard, "image/png"), website: dataUri(website, "image/png"), portfolio: dataUri(portfolio, "image/png") };
  })();
  return lynqAssetsPromise;
}

function classifyLynqScene(input: { visual: string; onScreenText: string }, index: number, count: number): LynqScene {
  const value = `${input.visual} ${input.onScreenText}`.toLowerCase();
  if (index === count - 1 || /cta|lynq\.build|book|start.*project|let.s build/.test(value)) return "cta";
  if (/portfolio|case study|client|kingsbridge|before.*after/.test(value)) return "portfolio";
  if (/landing page|website|homepage|web design|site/.test(value)) return "website";
  if (/office|content studio|operating system|command center/.test(value)) return "office";
  if (/automat|workflow|agent|ai /.test(value)) return "automation";
  if (/system|digital transformation|connected/.test(value)) return "systems";
  return index === 0 ? "brand" : "website";
}

function lynqFrame(input: { assets: LynqAssets; scene: LynqScene; headline: string; supportingText: string; index: number; count: number; callToAction: string; square: boolean }) {
  const { assets, scene, headline, supportingText, index, count, callToAction, square } = input;
  const showsProduct = scene === "website" || scene === "portfolio";
  const screen = scene === "portfolio" ? assets.portfolio : assets.website;
  const label = scene === "website" ? "WEBSITES & LANDING PAGES" : scene === "portfolio" ? "SELECTED WORK" : scene === "office" ? "LYNQ OFFICE" : scene === "automation" ? "AI & AUTOMATION" : scene === "systems" ? "CONNECTED SYSTEMS" : "LYNQ";
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: square ? "62px" : "44px", background: "#050505", color: "#f7f7f2", fontFamily: "Arial, sans-serif", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", position: "absolute", width: square ? "520px" : "390px", height: square ? "520px" : "390px", borderRadius: "999px", border: "1px solid #c8ff00", opacity: 0.18, right: "-180px", top: "-170px" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: square ? "92px" : "72px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assets.logo} alt="LYNQ" style={{ width: square ? "170px" : "135px", height: square ? "70px" : "56px", objectFit: "contain", filter: "brightness(0) invert(1)" }} />
        <span style={{ color: "#c8ff00", fontWeight: 800, fontSize: square ? "24px" : "19px", letterSpacing: "0.12em" }}>{String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}</span>
      </div>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: square ? "30px" : "22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: square ? "19px" : "16px", letterSpacing: "0.18em", color: "#c8ff00", fontWeight: 800 }}><span style={{ width: "54px", height: "3px", background: "#c8ff00" }} />{label}</div>
        <div style={{ display: "flex", maxWidth: square ? "900px" : "620px", fontSize: headline.length > 78 ? (square ? "62px" : "46px") : (square ? "78px" : "58px"), lineHeight: 0.98, fontWeight: 800, letterSpacing: "-0.045em" }}>{scene === "cta" ? callToAction : headline}</div>
        {showsProduct ? (
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid #333", borderRadius: "12px", background: "#111", boxShadow: "0 28px 80px rgba(0,0,0,.6)" }}>
            <div style={{ display: "flex", height: square ? "42px" : "32px", alignItems: "center", gap: "8px", padding: "0 15px", background: "#171717", borderBottom: "1px solid #2b2b2b" }}><span style={{ width: "9px", height: "9px", borderRadius: "99px", background: "#c8ff00" }} /><span style={{ color: "#777", fontSize: square ? "15px" : "12px", marginLeft: "8px" }}>lynq.build / selected work</span></div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={screen} alt="Real LYNQ website work" style={{ width: square ? "930px" : "620px", height: square ? "510px" : "360px", objectFit: "cover", objectPosition: "top" }} />
          </div>
        ) : (
          <div style={{ display: "flex", minHeight: square ? "430px" : "330px", alignItems: "center", justifyContent: "center", border: "1px solid #242424", background: "linear-gradient(145deg,#0b0b0b,#151515)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assets.brandCard} alt="LYNQ premium brand" style={{ width: "92%", height: "92%", objectFit: "contain", opacity: scene === "cta" ? 0.72 : 0.9 }} />
          </div>
        )}
        <div style={{ display: "flex", maxWidth: "820px", fontSize: square ? "27px" : "20px", lineHeight: 1.35, color: "#a5a5a0" }}>{supportingText}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: square ? "68px" : "54px", borderTop: "1px solid #282828", fontSize: square ? "22px" : "17px" }}><span>Build better. Work smarter.</span><span style={{ color: "#c8ff00", fontWeight: 800 }}>LYNQ.BUILD</span></div>
    </div>
  );
}

export function classifyCodeItScene(input: { visual: string; onScreenText: string }, index: number, count: number, forceFinalCta = true): CodeItScene {
  const value = `${input.visual} ${input.onScreenText}`.toLowerCase();
  if ((forceFinalCta && index === count - 1) || /cta|codeitlearn\.com|start building|build today/.test(value)) return "cta";
  if (/built_game|playable result|finished game|working game|real game/.test(value)) return "builtGame";
  if (/game_play|gameplay|live game|score.*timer|timer.*target/.test(value)) return "gamePlay";
  if (/project_builder|project studio|builder|describe.*build|game prompt/.test(value)) return "builder";
  if (/lesson|learning map|lessons map/.test(value)) return "lessons";
  if (/output|hello,? world|see it work|click.*run|runs immediately/.test(value)) return "output";
  if (/playground|python|editor|print\(|code close|type.*code/.test(value)) return "playground";
  if (/explore|discover|community|trending|remix/.test(value)) return "explore";
  if (/logo|meet codeit|brand reveal/.test(value)) return "logo";
  if (/mascot|pixel|character/.test(value)) return "mascot";
  return "home";
}

function codeItSceneFrame(input: {
  assets: CodeItAssets;
  scene: CodeItScene;
  headline: string;
  index: number;
  count: number;
  callToAction: string;
}) {
  const { assets, scene, headline, index, count, callToAction } = input;
  const screen = scene === "builder" ? assets.builder : scene === "builtGame" ? assets.builtGame : scene === "gamePlay" ? assets.gamePlay : scene === "lessons" ? assets.lessons : scene === "playground" ? assets.playground : scene === "output" ? assets.output : scene === "explore" ? assets.explore : assets.home;
  const isBrandScene = scene === "mascot" || scene === "logo" || scene === "cta";

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "42px", background: "#fff7ee", color: "#17234a", fontFamily: "Arial, sans-serif", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", position: "absolute", width: "340px", height: "340px", borderRadius: "999px", background: "#ffd34f", opacity: 0.28, right: "-120px", top: "-110px" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "84px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assets.logo} alt="CodeIt" style={{ width: "150px", height: "84px", objectFit: "contain" }} />
        <span style={{ color: "#ff6547", fontWeight: 900, fontSize: "22px" }}>{String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}</span>
      </div>

      {isBrandScene ? (
        <div style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: "22px" }}>
          {scene === "logo" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={assets.logo} alt="CodeIt" style={{ width: "430px", height: "260px", objectFit: "contain" }} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={assets.mascot} alt="Pixel mascot" style={{ width: "620px", height: "650px", objectFit: "contain", objectPosition: "center bottom", marginBottom: "-20px" }} />
          )}
          <div style={{ display: "flex", maxWidth: "620px", fontSize: headline.length > 64 ? "46px" : "58px", lineHeight: 1.02, fontWeight: 900, letterSpacing: "-0.035em" }}>{scene === "cta" ? callToAction : headline}</div>
          {scene === "cta" ? <div style={{ display: "flex", background: "#ff6547", color: "white", borderRadius: "999px", padding: "18px 32px", fontSize: "28px", fontWeight: 900 }}>codeitlearn.com</div> : null}
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: "28px" }}>
          <div style={{ display: "flex", fontSize: headline.length > 72 ? "43px" : "54px", lineHeight: 1.03, fontWeight: 900, letterSpacing: "-0.035em", maxWidth: "620px" }}>{headline}</div>
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: "24px", border: "4px solid #17234a", boxShadow: "0 24px 55px rgba(23,35,74,0.18)", background: "white" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", height: "42px", padding: "0 16px", background: "#fff0df", borderBottom: "2px solid #ead8c5" }}>
              <span style={{ width: "12px", height: "12px", borderRadius: "99px", background: "#ff6547" }} />
              <span style={{ width: "12px", height: "12px", borderRadius: "99px", background: "#ffd34f" }} />
              <span style={{ width: "12px", height: "12px", borderRadius: "99px", background: "#8b6cf6" }} />
              <span style={{ marginLeft: "12px", fontSize: "17px", color: "#775f53" }}>codeitlearn.com</span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={screen} alt="Real CodeItLearn product screen" style={{ width: "636px", height: "398px", objectFit: "cover" }} />
          </div>
          <div style={{ display: "flex", position: "absolute", right: "-18px", bottom: "74px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assets.mascot} alt="Pixel mascot" style={{ width: "250px", height: "260px", objectFit: "contain", objectPosition: "right bottom" }} />
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "60px", borderTop: "2px solid #f0d7bd", fontSize: "21px" }}>
        <span style={{ fontWeight: 700 }}>Imagine it. Build it. See it work.</span>
        <span style={{ color: "#ff6547", fontWeight: 900 }}>CODEITLEARN.COM</span>
      </div>
    </div>
  );
}

function codeItPostFrame(input: {
  assets: CodeItAssets;
  scene: CodeItScene;
  headline: string;
  supportingText: string;
  index: number;
  count: number;
  callToAction: string;
}) {
  const { assets, scene, headline, supportingText, index, count, callToAction } = input;
  const screen = scene === "builder" ? assets.builder : scene === "builtGame" ? assets.builtGame : scene === "gamePlay" ? assets.gamePlay : scene === "lessons" ? assets.lessons : scene === "playground" ? assets.playground : scene === "output" ? assets.output : scene === "explore" ? assets.explore : assets.home;
  const isBrandScene = scene === "mascot" || scene === "logo" || scene === "cta";
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "64px", background: "#fff7ee", color: "#17234a", fontFamily: "Arial, sans-serif", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", position: "absolute", width: "440px", height: "440px", borderRadius: "999px", background: "#ffd34f", opacity: 0.24, right: "-160px", top: "-160px" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "110px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assets.logo} alt="CodeIt" style={{ width: "210px", height: "110px", objectFit: "contain" }} />
        <span style={{ color: "#ff6547", fontWeight: 900, fontSize: "28px" }}>{String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}</span>
      </div>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: "32px" }}>
        <div style={{ display: "flex", maxWidth: "930px", fontSize: headline.length > 82 ? "64px" : "80px", lineHeight: 1.02, fontWeight: 900, letterSpacing: "-0.04em" }}>{headline}</div>
        {isBrandScene ? (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", minHeight: "660px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={scene === "logo" ? assets.logo : assets.mascot} alt={scene === "logo" ? "CodeIt" : "Pixel mascot"} style={{ width: scene === "logo" ? "650px" : "820px", height: "650px", objectFit: "contain" }} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: "28px", border: "4px solid #17234a", boxShadow: "0 28px 60px rgba(23,35,74,0.18)", background: "white" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", height: "54px", padding: "0 20px", background: "#fff0df", borderBottom: "2px solid #ead8c5" }}>
              <span style={{ width: "15px", height: "15px", borderRadius: "99px", background: "#ff6547" }} /><span style={{ width: "15px", height: "15px", borderRadius: "99px", background: "#ffd34f" }} /><span style={{ width: "15px", height: "15px", borderRadius: "99px", background: "#8b6cf6" }} />
              <span style={{ marginLeft: "14px", fontSize: "21px", color: "#775f53" }}>codeitlearn.com</span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={screen} alt="Real CodeItLearn product screen" style={{ width: "944px", height: "590px", objectFit: "cover" }} />
          </div>
        )}
        <div style={{ display: "flex", maxWidth: "820px", fontSize: "30px", lineHeight: 1.3, color: "#625852" }}>{scene === "cta" ? callToAction : supportingText}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "74px", borderTop: "2px solid #f0d7bd", fontSize: "26px" }}><span style={{ fontWeight: 700 }}>Imagine it. Build it. See it work.</span><span style={{ color: "#ff6547", fontWeight: 900 }}>CODEITLEARN.COM</span></div>
    </div>
  );
}

type StoredAsset = ContentStudioPackage["renderedAssets"][number];

type MediaProductionDependencies = {
  renderPostPanel?: (input: { brand: MarketingBrandProfile; pkg: Extract<ContentStudioPackage, { contentKind: "single_image_post" | "carousel_post" }>; panelIndex: number }) => Promise<{ bytes: Uint8Array; contentType: string; model: string }>;
  renderVideo?: (input: { brand: MarketingBrandProfile; pkg: Extract<ContentStudioPackage, { contentKind: "short_video" }> }) => Promise<{ bytes: Uint8Array; contentType: string; model: string }>;
  renderPremiumVideo?: (input: { brand: MarketingBrandProfile; pkg: Extract<ContentStudioPackage, { contentKind: "short_video" }> }) => Promise<{ bytes: Uint8Array; contentType: string; model: string }>;
  store?: (input: { pathname: string; bytes: Uint8Array; contentType: string }) => Promise<{ pathname: string }>;
};

function palette(brand: MarketingBrandProfile) {
  return brand.brandKey === "lynq"
    ? { background: "#050505", foreground: "#f7f7f2", accent: "#c8ff00", soft: "#202020" }
    : { background: "#fff7ee", foreground: "#17234a", accent: "#ff6547", soft: "#ffd34f" };
}

export async function renderPostPanel({ brand, pkg, panelIndex }: Parameters<NonNullable<MediaProductionDependencies["renderPostPanel"]>>[0]) {
  const panel = pkg.panels[panelIndex];
  const colors = palette(brand);
  const count = pkg.panels.length;
  if (brand.brandKey === "codeitlearn") {
    const assets = await loadCodeItAssets();
    const response = new ImageResponse(
      codeItPostFrame({
        assets,
        scene: classifyCodeItScene({ visual: panel.visual, onScreenText: panel.overlayText }, panelIndex, count, count > 1),
        headline: panel.overlayText || pkg.coverText,
        supportingText: panel.purpose,
        index: panelIndex,
        count,
        callToAction: pkg.callToAction,
      }),
      { width: 1080, height: 1350 },
    );
    return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: "image/png", model: `${CONTENT_STUDIO_DESIGN_RENDERER}-codeit-real-product-v3` };
  }
  if (brand.brandKey === "lynq") {
    const assets = await loadLynqAssets();
    const response = new ImageResponse(lynqFrame({ assets, scene: classifyLynqScene({ visual: panel.visual, onScreenText: panel.overlayText }, panelIndex, count), headline: panel.overlayText || pkg.coverText, supportingText: panel.purpose, index: panelIndex, count, callToAction: pkg.callToAction, square: true }), { width: 1080, height: 1350 });
    return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: "image/png", model: `${CONTENT_STUDIO_DESIGN_RENDERER}-lynq-premium-v2` };
  }
  const response = new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "76px", background: colors.background, color: colors.foreground, fontFamily: "Arial, sans-serif", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", position: "absolute", width: "430px", height: "430px", borderRadius: "999px", background: colors.accent, opacity: brand.brandKey === "lynq" ? 0.16 : 0.2, right: "-150px", top: "-120px" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "30px", fontWeight: 800, letterSpacing: "0.06em" }}>
        <span>{brand.name.toUpperCase()}</span>
        <span style={{ color: colors.accent }}>{String(panelIndex + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "36px", maxWidth: "900px" }}>
        <div style={{ width: "110px", height: "12px", display: "flex", background: colors.accent, borderRadius: "12px" }} />
        <div style={{ display: "flex", fontSize: panel.overlayText.length > 92 ? "66px" : "82px", lineHeight: 1.04, fontWeight: 800, letterSpacing: "-0.035em" }}>{panel.overlayText || pkg.coverText}</div>
        <div style={{ display: "flex", fontSize: "31px", lineHeight: 1.35, opacity: 0.76, maxWidth: "820px" }}>{panel.purpose}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `2px solid ${colors.soft}`, paddingTop: "34px", fontSize: "28px" }}>
        <span>{panelIndex === count - 1 ? pkg.callToAction : "Build something real."}</span>
        <span style={{ color: colors.accent, fontWeight: 800 }}>{brand.brandKey === "lynq" ? "LYNQ.BUILD" : "CODEITLEARN.COM"}</span>
      </div>
    </div>,
    { width: 1080, height: 1350 },
  );
  return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: "image/png", model: CONTENT_STUDIO_DESIGN_RENDERER };
}

async function renderVideo({ brand, pkg }: Parameters<NonNullable<MediaProductionDependencies["renderVideo"]>>[0]) {
  if (!ffmpegPath) throw new Error("The video renderer is unavailable on this runtime");
  const run = promisify(execFile);
  const workdir = await mkdtemp(join(tmpdir(), "lynq-content-video-"));
  const colors = palette(brand);
  const shots = pkg.shots.slice(0, brand.brandKey === "codeitlearn" ? 8 : 5);
  const codeItAssets = brand.brandKey === "codeitlearn" ? await loadCodeItAssets() : null;
  const lynqAssets = brand.brandKey === "lynq" ? await loadLynqAssets() : null;
  try {
    const segments: string[] = [];
    const durations: number[] = [];
    for (let index = 0; index < shots.length; index += 1) {
      const shot = shots[index];
      const timeValues = shot.timing.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      const inferredDuration = timeValues.length >= 2 ? timeValues[timeValues.length - 1] - timeValues[timeValues.length - 2] : 3;
      const duration = Math.min(5, Math.max(1.5, inferredDuration || 3));
      durations.push(duration);
      const frame = new ImageResponse(
        codeItAssets ? codeItSceneFrame({
          assets: codeItAssets,
          scene: classifyCodeItScene(shot, index, shots.length),
          headline: shot.onScreenText || (index === 0 ? pkg.selectedHook : pkg.coverText),
          index,
          count: shots.length,
          callToAction: pkg.callToAction,
        }) : lynqAssets ? lynqFrame({
          assets: lynqAssets,
          scene: classifyLynqScene(shot, index, shots.length),
          headline: shot.onScreenText || (index === 0 ? pkg.selectedHook : pkg.coverText),
          supportingText: shot.visual,
          index,
          count: shots.length,
          callToAction: pkg.callToAction,
          square: false,
        }) : (
          <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "58px", background: colors.background, color: colors.foreground, fontFamily: "Arial, sans-serif", position: "relative", overflow: "hidden" }}>
            <div style={{ display: "flex", position: "absolute", width: "390px", height: "390px", borderRadius: "999px", background: colors.accent, opacity: 0.18, right: "-140px", top: "-100px" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "25px", fontWeight: 800, letterSpacing: "0.06em" }}><span>{brand.name.toUpperCase()}</span><span style={{ color: colors.accent }}>{String(index + 1).padStart(2, "0")}</span></div>
            <div style={{ display: "flex", flexDirection: "column", gap: "30px" }}>
              <div style={{ width: "90px", height: "10px", display: "flex", background: colors.accent, borderRadius: "10px" }} />
              <div style={{ display: "flex", fontSize: shot.onScreenText.length > 82 ? "50px" : "64px", lineHeight: 1.04, fontWeight: 800, letterSpacing: "-0.035em" }}>{shot.onScreenText || (index === 0 ? pkg.selectedHook : pkg.coverText)}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: `2px solid ${colors.soft}`, paddingTop: "26px", fontSize: "23px" }}><span>{index === shots.length - 1 ? pkg.callToAction : "Make the result visible."}</span><span style={{ color: colors.accent, fontWeight: 800 }}>LYNQ.BUILD</span></div>
          </div>
        ),
        { width: 720, height: 1280 },
      );
      const framePath = join(workdir, `frame-${index}.png`);
      const segmentPath = join(workdir, `segment-${index}.mp4`);
      await writeFile(framePath, Buffer.from(await frame.arrayBuffer()));
      const frames = Math.ceil(duration * 30);
      const motion = index % 2 === 0
        ? `scale=1080:1920,zoompan=z='min(zoom+0.00018,1.022)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30`
        : `scale=1080:1920,zoompan=z='if(lte(on,1),1.022,max(1.001,zoom-0.00018))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30`;
      await run(ffmpegPath, ["-y", "-loop", "1", "-framerate", "30", "-i", framePath, "-vf", `${motion},format=yuv420p`, "-t", String(duration), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", segmentPath], { maxBuffer: 8 * 1024 * 1024 });
      segments.push(segmentPath);
    }
    const outputPath = join(workdir, "rendered.mp4");
    const transitionDuration = 0.28;
    const inputs = segments.flatMap((path) => ["-i", path]);
    let cumulative = durations[0] ?? 3;
    const filters: string[] = [];
    for (let index = 1; index < segments.length; index += 1) {
      const left = index === 1 ? "[0:v]" : `[v${index - 1}]`;
      const transition = index % 3 === 1 ? "fade" : index % 3 === 2 ? "smoothleft" : "smoothup";
      const offset = Math.max(0, cumulative - transitionDuration * index).toFixed(2);
      filters.push(`${left}[${index}:v]xfade=transition=${transition}:duration=${transitionDuration}:offset=${offset}[v${index}]`);
      cumulative += durations[index] ?? 3;
    }
    const videoMap = segments.length > 1 ? `[v${segments.length - 1}]` : "0:v";
    const renderArgs = segments.length > 1
      ? ["-y", ...inputs, "-filter_complex", filters.join(";"), "-map", videoMap, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", outputPath]
      : ["-y", ...inputs, "-map", videoMap, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", outputPath];
    await run(ffmpegPath, renderArgs, { maxBuffer: 8 * 1024 * 1024 });
    return { bytes: new Uint8Array(await readFile(outputPath)), contentType: "video/mp4", model: brand.brandKey === "codeitlearn" ? "lynq-office-codeit-director-cut-v4" : brand.brandKey === "lynq" ? "lynq-office-lynq-director-cut-v4" : CONTENT_STUDIO_VIDEO_MODEL };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

async function renderPremiumMotionPlate(brand: MarketingBrandProfile) {
  if (brand.brandKey === "codeitlearn") {
    const assets = await loadCodeItAssets();
    const response = new ImageResponse(
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", padding: "58px 42px 38px", background: "#fff7ee", position: "relative", overflow: "hidden" }}>
        <div style={{ display: "flex", position: "absolute", width: "410px", height: "410px", borderRadius: "999px", background: "#ffd34f", opacity: 0.32, right: "-140px", top: "-120px" }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assets.logo} alt="CodeIt" style={{ width: "220px", height: "120px", objectFit: "contain", zIndex: 2 }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assets.mascot} alt="Pixel mascot" style={{ width: "690px", height: "850px", objectFit: "contain", objectPosition: "center bottom", zIndex: 2 }} />
        <div style={{ display: "flex", color: "#17234a", fontSize: "31px", fontWeight: 900, fontFamily: "Arial, sans-serif", zIndex: 2 }}>Imagine it. Build it. See it work.</div>
      </div>,
      { width: 720, height: 1280 },
    );
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      prompt: "Premium vertical commercial motion. Preserve the exact orange Pixel mascot, yellow hoodie, CodeIt logo, colors, proportions and all typography. Pixel looks up, smiles, gives a small excited wave, and the camera makes a subtle professional push-in. Gentle dimensional lighting and restrained background parallax. No new objects, no extra limbs, no text changes, no logo changes, no morphing, no camera shake.",
    };
  }
  const assets = await loadLynqAssets();
  const response = new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "54px", background: "#050505", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", position: "absolute", width: "520px", height: "520px", borderRadius: "999px", border: "2px solid #c8ff00", opacity: 0.22, right: "-220px", top: "-180px" }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={assets.brandCard} alt="LYNQ premium identity" style={{ width: "660px", height: "920px", objectFit: "contain", zIndex: 2 }} />
    </div>,
    { width: 720, height: 1280 },
  );
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    prompt: "Premium vertical technology brand film. Preserve the exact LYNQ identity, black and white composition, controlled neon-lime details, typography and logo. Add a slow editorial camera push, subtle layered depth, refined light sweep and restrained lime glow. No new words, no text changes, no logo changes, no morphing, no generic sci-fi elements, no camera shake.",
  };
}

async function renderPremiumVideo({ brand, pkg }: Parameters<NonNullable<MediaProductionDependencies["renderPremiumVideo"]>>[0]) {
  if (!ffmpegPath) throw new Error("The video renderer is unavailable on this runtime");
  if (!isRunwayPremiumRendererConfigured()) throw new Error("Runway premium motion is not connected. Add RUNWAYML_API_SECRET to the isolated LYNQ Office Vercel project.");
  const [base, plate] = await Promise.all([renderVideo({ brand, pkg }), renderPremiumMotionPlate(brand)]);
  const hero = await generateRunwayMotionClip({ promptImage: plate.bytes, imageContentType: "image/png", promptText: plate.prompt });
  const run = promisify(execFile);
  const workdir = await mkdtemp(join(tmpdir(), "lynq-content-premium-video-"));
  try {
    const heroPath = join(workdir, `hero.${extensionFor(hero.contentType)}`);
    const basePath = join(workdir, "director-cut.mp4");
    const outputPath = join(workdir, "premium-director-cut.mp4");
    await Promise.all([writeFile(heroPath, Buffer.from(hero.bytes)), writeFile(basePath, Buffer.from(base.bytes))]);
    await run(ffmpegPath, [
      "-y", "-i", heroPath, "-i", basePath,
      "-filter_complex", "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p,setpts=PTS-STARTPTS[hero];[1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p,setpts=PTS-STARTPTS[proof];[hero][proof]concat=n=2:v=1:a=0[v]",
      "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", outputPath,
    ], { maxBuffer: 8 * 1024 * 1024 });
    return { bytes: new Uint8Array(await readFile(outputPath)), contentType: "video/mp4", model: `${hero.model}+${base.model}` };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

async function storeAsset({ pathname, bytes, contentType }: Parameters<NonNullable<MediaProductionDependencies["store"]>>[0]) {
  const blob = await put(pathname, Buffer.from(bytes), { access: "private", contentType, addRandomSuffix: true });
  return { pathname: blob.pathname };
}

function extensionFor(contentType: string) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webm")) return "webm";
  return "mp4";
}

export async function renderContentStudioMedia(
  db: Db,
  input: { organizationId: string; studioId: string; expectedRevision: number; actorUserId: string; renderMode?: "standard" | "premium" },
  dependencies: MediaProductionDependencies = {},
): Promise<ContentStudioDraft> {
  const studio = await getStudioDraftForUser(db, input);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_content_studio", studio.id);
  if (!studio.productionPackage) throw new Error("Generate a production package before rendering media");
  if (studio.revision !== input.expectedRevision) throw new Error("This Content Studio draft changed; refresh and try again");
  const brands = await listBrandProfiles(db, { organizationId: input.organizationId, workspaceId: studio.workspaceId, actorUserId: input.actorUserId });
  const brand = brands.find((item) => item.id === studio.brandProfileId);
  if (!brand) throw new Error("The Content Studio brand profile is unavailable");

  const renderPanel = dependencies.renderPostPanel ?? renderPostPanel;
  const renderClip = input.renderMode === "premium" ? (dependencies.renderPremiumVideo ?? renderPremiumVideo) : (dependencies.renderVideo ?? renderVideo);
  const store = dependencies.store ?? storeAsset;
  const generatedAt = new Date().toISOString();
  const assets: StoredAsset[] = [];

  try {
    if (studio.productionPackage.contentKind === "short_video") {
      const media = await renderClip({ brand, pkg: studio.productionPackage });
      const stored = await store({ pathname: `content-studio/${input.organizationId}/${studio.id}/video.${extensionFor(media.contentType)}`, bytes: media.bytes, contentType: media.contentType });
      assets.push({ pathname: stored.pathname, contentType: media.contentType, size: media.bytes.byteLength, model: media.model, label: input.renderMode === "premium" ? "Premium motion director cut" : "Rendered social video", generatedAt });
    } else {
      for (let index = 0; index < studio.productionPackage.panels.length; index += 1) {
        const media = await renderPanel({ brand, pkg: studio.productionPackage, panelIndex: index });
        const stored = await store({ pathname: `content-studio/${input.organizationId}/${studio.id}/panel-${index + 1}.png`, bytes: media.bytes, contentType: media.contentType });
        assets.push({ pathname: stored.pathname, contentType: media.contentType, size: media.bytes.byteLength, model: media.model, label: studio.productionPackage.contentKind === "carousel_post" ? `Carousel panel ${index + 1}` : "Rendered social post", generatedAt });
      }
    }

    const productionPackage = contentStudioPackageSchema.parse({ ...studio.productionPackage, renderingStatus: "ready", renderedAssets: assets, renderingError: null });
    const [row] = await db.update(marketingContentStudioDrafts).set({ productionPackage, revision: studio.revision + 1, updatedAt: new Date() }).where(and(eq(marketingContentStudioDrafts.id, studio.id), eq(marketingContentStudioDrafts.organizationId, input.organizationId), eq(marketingContentStudioDrafts.revision, studio.revision))).returning();
    if (!row) throw new Error("This Content Studio draft changed while media was rendering; refresh and try again");
    await recordAuditEvent(db, { eventType: "marketing_content_studio_media_rendered", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_content_studio", targetId: studio.id, metadata: { contentKind: productionPackage.contentKind, renderMode: input.renderMode ?? "standard", assetCount: assets.length, models: [...new Set(assets.map((asset) => asset.model))] } });
    return getStudioDraftForUser(db, { organizationId: input.organizationId, studioId: row.id, actorUserId: input.actorUserId });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Media generation failed";
    const failedPackage = contentStudioPackageSchema.parse({ ...studio.productionPackage, renderingStatus: "failed", renderingError: message });
    await db.update(marketingContentStudioDrafts).set({ productionPackage: failedPackage, revision: studio.revision + 1, updatedAt: new Date() }).where(and(eq(marketingContentStudioDrafts.id, studio.id), eq(marketingContentStudioDrafts.organizationId, input.organizationId), eq(marketingContentStudioDrafts.revision, studio.revision)));
    throw error;
  }
}
