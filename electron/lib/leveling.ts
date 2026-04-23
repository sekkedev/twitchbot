/**
 * EXP / level math. Pure functions — no side effects, no runtime deps.
 */

const LEVEL_CAP = 1000;

/**
 * `floor(base * level^exponent)`.
 *
 * Note: the original design doc's worked example lists "Level 2 > 3: 283 EXP",
 * but `floor(100 * 2^1.5) = 282`. The 283 value matches `round()`, not
 * `floor()`. We follow the formula text literally — the off-by-one is a
 * rounding artifact in the spec sample, not in the implementation.
 */
export function expForNextLevel(
  level: number,
  base: number,
  exponent: number,
): number {
  return Math.floor(base * Math.pow(level, exponent));
}

/**
 * Given a total EXP amount plus the level curve params, returns the level the
 * user is at. Caps at LEVEL_CAP for safety against degenerate inputs.
 */
export function computeLevel(
  totalExp: number,
  base: number,
  exponent: number,
): number {
  if (totalExp <= 0) return 1;
  let level = 1;
  let cumulative = 0;
  while (level < LEVEL_CAP) {
    const need = expForNextLevel(level, base, exponent);
    if (cumulative + need > totalExp) break;
    cumulative += need;
    level += 1;
  }
  return level;
}

/**
 * EXP remaining until the next level and the cumulative threshold to reach it.
 * Useful for progress bars.
 */
export function levelProgress(
  totalExp: number,
  base: number,
  exponent: number,
): { level: number; currentLevelStart: number; nextLevelAt: number; progress: number } {
  const level = computeLevel(totalExp, base, exponent);
  let cumulative = 0;
  for (let i = 1; i < level; i += 1) {
    cumulative += expForNextLevel(i, base, exponent);
  }
  const need = expForNextLevel(level, base, exponent);
  const currentLevelStart = cumulative;
  const nextLevelAt = cumulative + need;
  const progress = need === 0 ? 0 : (totalExp - currentLevelStart) / need;
  return { level, currentLevelStart, nextLevelAt, progress };
}
