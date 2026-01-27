'use client';

import Snowfall from "react-snowfall";

type SnowfallLayerProps = {
  zIndex?: number;
};

export default function SnowfallLayer({ zIndex = 50 }: SnowfallLayerProps) {
  return (
    <Snowfall
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex,
      }}
    />
  );
}
