import React from "react";
import { Composition } from "remotion";
import { LynqHouseDeals } from "./LynqCase";
import { LynqAB } from "./LynqAB";
import { PipEp1, PipEp2, PipEp3, PipEp4, PipEp5 } from "./PipSeries";

const C = (id: string, component: React.FC, seconds: number) => <Composition id={id} component={component} durationInFrames={Math.round(seconds * 30)} fps={30} width={1080} height={1920} />;

export const Root: React.FC = () => (
  <>
    {C("lynq-housedeals", LynqHouseDeals, 17)}
    {C("lynq-ab-button", LynqAB, 14)}
    {C("pip-ep1", PipEp1, 15)}
    {C("pip-ep2", PipEp2, 15.5)}
    {C("pip-ep3", PipEp3, 15)}
    {C("pip-ep4", PipEp4, 14.5)}
    {C("pip-ep5", PipEp5, 15)}
  </>
);
