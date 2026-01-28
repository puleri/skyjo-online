'use client';

import { useEffect, useMemo, useState } from 'react';
import Snowfall from 'react-snowfall';

type SnowfallLayerProps = {
  zIndex?: number;
  height?: string | number;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

export default function SnowfallLayer({ zIndex = -1, height = "100%" }: SnowfallLayerProps) {
  // Start somewhere in-range; adjust if you want a fixed start.
  const [count, setCount] = useState<number>(randomInt(100, 300));

  // Heavier weight on -100 to balance larger + increments.
  // Tune these if you want it even “slower” or “faster”.
  const weights = useMemo(() => ({ minus: 0.75, plus: 0.25 }), []);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      const delayMs = randomInt(1_000, 10_000);

      timeoutId = setTimeout(() => {
        setCount((prev) => {
          // If we're near bounds, nudge direction to avoid getting stuck.
          if (prev <= 450) return clamp(prev + randomInt(100, 300), 200, 800);
          if (prev >= 1050) return clamp(prev - 100, 200, 1800);

          const roll = Math.random();
          const delta =
            roll < weights.minus ? -100 : randomInt(200, 500);

          return clamp(prev + delta, 200, 800);
        });

        tick(); // schedule next update
      }, delayMs);
    };

    tick();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [weights.minus]);

  return (
    <Snowfall
      snowflakeCount={count}
      wind={[0,.5]}
      speed={[.5,.5]}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: height,
        overflowY: 'hidden',
        pointerEvents: 'none',
        zIndex,
      }}
      radius={[.5, .5]}
    />
  );
}
