'use client';

import Snowfall from "react-snowfall";

type SnowfallLayerProps = {
  zIndex?: number;
};

export default function SnowfallLayer({ zIndex = 50 }: SnowfallLayerProps) {
  return (
    <Snowfall
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "200%",
        pointerEvents: "none",
        zIndex,
      }}
      radius={[1,2]}
    />
  );
}
