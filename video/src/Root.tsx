import React from "react";
import { Composition } from "remotion";
import { LynqHouseDeals } from "./LynqCase";
import { LynqAB } from "./LynqAB";
import { LynqOffice } from "./LynqOffice";
import { KC1, KC2, KC3, KC4, KC5, KC6, KC7 } from "./KidsCodingCase";
import { PipEp1, PipEp1Ar, PipEp2, PipEp2Ar, PipEp3, PipEp3Ar, PipEp4, PipEp4Ar, PipEp5, PipEp5Ar } from "./PipSeries";
import { LYNQ_STORY, LYNQ_STORY_SECONDS } from "./LynqStory";
import { PipHook1 } from "./PipHook";
import { ShowcaseBarber, ShowcaseCafe, ShowcaseGym } from "./Showcase";

const C = (id: string, component: React.FC, seconds: number) => <Composition id={id} component={component} durationInFrames={Math.round(seconds * 30)} fps={30} width={1080} height={1920} />;

export const Root: React.FC = () => (
  <>
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
