import { useEffect, useRef, useState } from "react";

import type { ProgressEvent } from "../types";

const TICK_INTERVAL_MS = 400;
const INCREMENT_PER_TICK = 1;
const CEILING_DURING_INSTALL = 65;

/**
 * Smoothly interpolates displayed progress between real backend events.
 *
 * When the backend emits sparse progress updates (e.g. 10% -> 70%),
 * the displayed progress gradually creeps forward so the user sees
 * continuous movement instead of a frozen bar.
 *
 * The display value never exceeds CEILING_DURING_INSTALL until a real
 * event arrives above that threshold, preventing the bar from appearing
 * to finish before the work is actually done.
 */
export function useSmoothedProgress(
  realProgress: Record<string, ProgressEvent>,
): Record<string, { percent: number; stage: string }> {
  const [display, setDisplay] = useState<Record<string, { percent: number; stage: string }>>({});
  const realRef = useRef(realProgress);
  realRef.current = realProgress;

  // When a real event arrives, immediately update display if real >= display
  useEffect(() => {
    setDisplay((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const [toolName, event] of Object.entries(realProgress)) {
        const current = prev[toolName];
        if (!current || event.percent >= current.percent) {
          next[toolName] = { percent: event.percent, stage: event.stage };
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [realProgress]);

  // Timer that gradually increments display toward ceiling
  useEffect(() => {
    const timer = setInterval(() => {
      setDisplay((prev) => {
        const next = { ...prev };
        let changed = false;

        for (const [toolName, entry] of Object.entries(prev)) {
          const real = realRef.current[toolName];
          if (!real) continue;

          // Don't animate completed/failed tools
          if (real.percent >= 100) continue;

          // Don't animate if display already caught up to real
          if (entry.percent >= real.percent) {
            // But we can creep forward toward the ceiling during install
            const ceiling = real.stage === "installing" ? CEILING_DURING_INSTALL : real.percent;
            if (entry.percent < ceiling) {
              next[toolName] = {
                percent: Math.min(entry.percent + INCREMENT_PER_TICK, ceiling),
                stage: entry.stage,
              };
              changed = true;
            }
            continue;
          }

          // Real is ahead, jump to it
          next[toolName] = { percent: real.percent, stage: real.stage };
          changed = true;
        }

        return changed ? next : prev;
      });
    }, TICK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  return display;
}
