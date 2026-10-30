import React from "react";
import { Composition } from "remotion";
import { LynqHouseDeals } from "./LynqCase";
import { LynqAB } from "./LynqAB";
import { LynqOffice } from "./LynqOffice";
import { KC1, KC2, KC3, KC4, KC5, KC6, KC7 } from "./KidsCodingCase";
import { PipEp1, PipEp2, PipEp3, PipEp4, PipEp5 } from "./PipSeries";

const C = (id: string, component: React.FC, seconds: number) => <Composition id={id} component={component} durationInFrames={Math.round(seconds * 30)} fps={30} width={1080} height={1920} />;

export const Root: React.FC = () => (
  <>
    {C("lynq-housedeals", LynqHouseDeals, 17)}
    {C("lynq-ab-button", LynqAB, 14)}
    {C("lynq-office", LynqOffice, 16)}
    {[KC1, KC2, KC3, KC4, KC5, KC6, KC7].map((K, i) => <Composition key={i} id={`kidscoding-0${i + 1}`} component={K} durationInFrames={1} fps={30} width={1080} height={1920} />)}
    {C("pip-ep1", PipEp1, 15)}
    {C("pip-ep2", PipEp2, 15.5)}
    {C("pip-ep3", PipEp3, 15)}
    {C("pip-ep4", PipEp4, 14.5)}
    {C("pip-ep5", PipEp5, 15)}
  </>
);
