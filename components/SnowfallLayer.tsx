'use client';

import { useEffect, useMemo, useState } from 'react';
import Snowfall from 'react-snowfall';

type SnowfallLayerProps = {
  zIndex?: number;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

export default function SnowfallLayer({ zIndex = 50 }: SnowfallLayerProps) {
  // Start somewhere in-range; adjust if you want a fixed start.
  const [count, setCount] = useState<number>(randomInt(200, 500));

  // Heavier weight on -100 to balance larger + increments.
  // Tune these if you want it even “slower” or “faster”.
  const weights = useMemo(() => ({ minus: 0.65, plus: 0.35 }), []);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      const delayMs = randomInt(1_000, 10_000);

      timeoutId = setTimeout(() => {
        setCount((prev) => {
          // If we're near bounds, nudge direction to avoid getting stuck.
          if (prev <= 450) return clamp(prev + randomInt(200, 500), 200, 1500);
          if (prev >= 1050) return clamp(prev - 100, 200, 1500);

          const roll = Math.random();
          const delta =
            roll < weights.minus ? -100 : randomInt(200, 500);

          return clamp(prev + delta, 200, 1500);
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
      wind={[1,5]}
      speed={[1,3]}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '200%',
        pointerEvents: 'none',
        zIndex,
      }}
      radius={[1, .5]}
    />
  );
}
