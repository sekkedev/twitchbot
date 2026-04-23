import { useEffect, useState } from 'react';

/**
 * Re-renders at the given interval, returning a fresh Date.now() each tick.
 * Use for live countdowns and uptimes.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
