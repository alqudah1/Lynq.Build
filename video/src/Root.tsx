import React from "react";
import { Composition } from "remotion";
import { LynqHouseDeals } from "./LynqCase";
import { LynqAB } from "./LynqAB";
import { LynqOffice } from "./LynqOffice";
import { KC1, KC2, KC3, KC4, KC5, KC6, KC7 } from "./KidsCodingCase";
import { PipEp1, PipEp1Ar, PipEp2, PipEp2Ar, PipEp3, PipEp3Ar, PipEp4, PipEp4Ar, PipEp5, PipEp5Ar } from "./PipSeries";
import { LYNQ_STORY, LYNQ_STORY_SECONDS } from "./LynqStory";
import { PipHook1 } from "./PipHook";
import { AdamEp1 } from "./AdamStory";
import { LynqCrm, LynqMenu } from "./LynqServices";
import { GuessOutput1, PovFirstTry, PythonCan, Speedrun } from "./CodeItFun";
import { PovClosed, PovHungry, RateReply, RedFlags } from "./LynqFun";
import { LynqSocialWeek, LynqTextBack, LynqTextBackTrades } from "./LynqDemos";
import { JumpQuiz, OneSentence } from "./CodeItDemos";
import { AdamFilm } from "./AdamFilm";
import { LynqSamFilm } from "./LynqSamFilm";
import { CodeItEveryone, LynqIdea } from "./PhoneAds";
import { PostAiQuestion, PostFirstProgram, PostFree, PostLessons, PostNoInstall, PostOneNumber, PostParentSentence, PostPrivate, PostSayAGame, PostTeachers, PostThreeGames, PostWhatTheyBuild } from "./CodeItPosts";
import { PostAchievements, PostArcade, PostRecipe, PostSearch, PostThread, PostWanted } from "./CodeItPosts2";
import { CodeItBuilt } from "./CodeItBuilt";
import { FRAMES, HlCover, Story } from "./LynqStories";
import { LynqMoneyAr } from "./PhoneStoryAr";
import { LynqMoney, LynqMoneyCover, LynqGridCover, LynqMoneyFeedCover, LynqMoneyPhotoCover } from "./PhoneStory";
import { D3Controller, D3Dial, D3Dinner, D3Fridge, D3Ladybug, D3Remote, D3Snake, D3Trophy, LuxDial, LuxNumbers, LuxOneNumber, LuxOneNumberDark, LuxPhoto } from "./CodeItPosts3";
import { LynqAorB, LynqBeforeHire, LynqGridBasket, LynqGridBottle, LynqGridCups, LynqGridHourglass, LynqGridPadlock, LynqObjSign, LynqObjStopwatch, LynqWkBasket, LynqWkBottle, LynqWkChair, LynqWkCups, LynqWkHourglass, LynqWkPadlock, LynqOneSentence, LynqSignV2, LynqPhoneFirst, LynqSendLink, LynqSixScreens } from "./LynqPosts";
import { ShowcaseBarber, ShowcaseCafe, ShowcaseGym } from "./Showcase";

const C = (id: string, component: React.FC, seconds: number) => <Composition id={id} component={component} durationInFrames={Math.round(seconds * 30)} fps={30} width={1080} height={1920} />;

export const Root: React.FC = () => (
  <>
    {[PostOneNumber, PostThreeGames, PostParentSentence, PostLessons, PostAiQuestion, PostFree, PostSayAGame, PostNoInstall, PostWhatTheyBuild, PostTeachers, PostFirstProgram, PostPrivate].map((P, i) => <Composition key={`cp${i}`} id={`codeit-post-${i + 1}`} component={P} durationInFrames={1} fps={30} width={1080} height={1350} />)}
    {[PostThread, PostArcade, PostAchievements, PostWanted, PostSearch, PostRecipe].map((P, i) => <Composition key={`cq${i}`} id={`codeit-idea-${i + 1}`} component={P} durationInFrames={1} fps={30} width={1080} height={1350} />)}
    {[LuxOneNumber, LuxOneNumberDark, LuxPhoto, LuxNumbers, LuxDial].map((P, i) => <Composition key={`lx${i}`} id={`codeit-lux-${i + 1}`} component={P} durationInFrames={1} fps={30} width={1080} height={1350} />)}
    {[D3Dial, D3Trophy, D3Controller, D3Snake, D3Dinner, D3Fridge, D3Ladybug, D3Remote].map((P, i) => <Composition key={`d3${i}`} id={`codeit-3d-${i + 1}`} component={P} durationInFrames={1} fps={30} width={1080} height={1350} />)}
    {[LynqOneSentence, LynqSixScreens, LynqBeforeHire, LynqSendLink, LynqPhoneFirst, LynqAorB].map((P, i) => <Composition key={`lp${i}`} id={`lynq-post-${i + 1}`} component={P} durationInFrames={1} fps={30} width={1080} height={1350} />)}
    {[LynqWkPadlock, LynqWkChair, LynqWkHourglass, LynqWkBottle, LynqWkCups, LynqWkBasket].map((P, i) => <Composition key={`lw${i}`} id={`lynq-wk-${i + 1}`} component={P} durationInFrames={1} fps={30} width={1080} height={1350} />)}
    {[LynqGridPadlock, LynqGridHourglass, LynqGridBottle, LynqGridCups, LynqGridBasket].map((P, i) => <Composition key={`lg${i}`} id={`lynq-grid-${i + 1}`} component={P} durationInFrames={1} fps={30} width={1080} height={1350} />)}
    {[LynqObjStopwatch, LynqObjSign, LynqSignV2].map((P, i) => <Composition key={`lo${i}`} id={`lynq-obj-${i + 1}`} component={P} durationInFrames={1} fps={30} width={1080} height={1350} />)}
    {C("lynq-housedeals", LynqHouseDeals, 17)}
    {C("lynq-ab-button", LynqAB, 14)}
    {C("lynq-office", LynqOffice, 16)}
    {[KC1, KC2, KC3, KC4, KC5, KC6, KC7].map((K, i) => <Composition key={i} id={`kidscoding-0${i + 1}`} component={K} durationInFrames={1} fps={30} width={1080} height={1920} />)}
    {C("pip-ep1", PipEp1, 15)}
    {C("pip-ep2", PipEp2, 14)}
    {C("pip-ep3", PipEp3, 15)}
    {C("pip-ep4", PipEp4, 15)}
    {C("pip-ep5", PipEp5, 13)}
    {C("pip-ep1-ar", PipEp1Ar, 14)}
    {C("pip-ep2-ar", PipEp2Ar, 14)}
    {C("pip-ep3-ar", PipEp3Ar, 15)}
    {C("pip-ep4-ar", PipEp4Ar, 15)}
    {C("pip-ep5-ar", PipEp5Ar, 13)}
    {C("pip-hook-1", PipHook1, 10)}
    {C("lynq-textback", LynqTextBack, 14.5)}
    {C("lynq-social-week", LynqSocialWeek, 14)}
    {C("lynq-textback-trades", LynqTextBackTrades, 16.5)}
    {C("codeit-one-sentence", OneSentence, 16)}
    {C("codeit-jump-quiz", JumpQuiz, 12.5)}
    {C("codeit-adam-film", AdamFilm, 16)}
    {C("lynq-sam-film", LynqSamFilm, 25.5)}
    {C("lynq-idea", LynqIdea, 14)}
    {FRAMES.map((f, k) => { const g = FRAMES.filter((x) => x.hl === f.hl); const i = g.indexOf(f); const P: React.FC = () => <Story f={f} i={i} n={g.length} />; return <Composition key={`st${k}`} id={`lynq-story-${f.hl}-${i + 1}`} component={P} durationInFrames={1} fps={30} width={1080} height={1920} />; })}
    {["start", "websites", "systems", "ai", "booking", "reels"].map((h) => { const P: React.FC = () => <HlCover hl={h} />; return <Composition key={`hc${h}`} id={`lynq-hl-${h}`} component={P} durationInFrames={1} fps={30} width={1080} height={1920} />; })}
    {C("lynq-money", LynqMoney, 18.5)}
    {C("codeit-built", CodeItBuilt, 17.5)}
    {C("lynq-money-ar", LynqMoneyAr, 18.5)}
    <Composition id="lynq-money-feed-cover" component={LynqMoneyFeedCover} durationInFrames={300} fps={30} width={1080} height={1920} />
    <Composition id="lynq-money-photo-cover" component={LynqMoneyPhotoCover} durationInFrames={1} fps={30} width={1080} height={1920} />
    <Composition id="lynq-grid-cover" component={LynqGridCover} durationInFrames={1} fps={30} width={1080} height={1920} />
    <Composition id="lynq-money-cover" component={LynqMoneyCover} durationInFrames={1} fps={30} width={1080} height={1920} />
    {C("codeit-everyone", CodeItEveryone, 18.6)}
    {C("adam-ep1", AdamEp1, 16)}
    {C("lynq-crm", LynqCrm, 13)}
    {C("lynq-menu", LynqMenu, 16.5)}
    {C("codeit-guess-1", GuessOutput1, 11)}
    {C("codeit-python-can", PythonCan, 10)}
    {C("codeit-pov-first-try", PovFirstTry, 9)}
    {C("codeit-speedrun", Speedrun, 11)}
    {C("lynq-red-flags", RedFlags, 12)}
    {C("lynq-pov-closed", PovClosed, 10.5)}
    {C("lynq-pov-hungry", PovHungry, 9.5)}
    {C("lynq-rate-reply", RateReply, 11)}
    {C("showcase-barber", ShowcaseBarber, 11)}
    {C("showcase-gym", ShowcaseGym, 11)}
    {C("showcase-cafe", ShowcaseCafe, 11)}
    {LYNQ_STORY.map((K, i) => (
      <React.Fragment key={i}>
        <Composition id={`lynq-story-${i + 1}`} component={K} defaultProps={{ lang: "en" as const }} durationInFrames={LYNQ_STORY_SECONDS[i] * 30} fps={30} width={1080} height={1920} />
        <Composition id={`lynq-story-${i + 1}-ar`} component={K} defaultProps={{ lang: "ar" as const }} durationInFrames={LYNQ_STORY_SECONDS[i] * 30} fps={30} width={1080} height={1920} />
      </React.Fragment>
    ))}
  </>
);
